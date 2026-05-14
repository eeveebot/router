import { NatsClient, log } from '@eeveebot/libeevee';
import { CommandRegistration, RegisteredCommand } from '../types/command.mjs';
import { compileRegex } from './compile-regex.mjs';

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();
  private natsClient: InstanceType<typeof NatsClient> | null = null;

  constructor(natsClient?: InstanceType<typeof NatsClient>) {
    this.natsClient = natsClient || null;
  }

  // Cleanup-like method to clean up resources
  public destroy(): void {
    this.commands.clear();
  }

  /**
   * Prompt modules to re-register a specific command
   */
  public promptReRegistration(commandUUID: string): void {
    const command = this.commands.get(commandUUID);
    if (!command || !this.natsClient) {
      return;
    }

    // Emit to the general re-registration channel
    void this.natsClient.publish(
      'control.registerCommands',
      JSON.stringify({})
    );

    // Emit to the command-specific re-registration channel if displayName exists
    if (command.commandDisplayName) {
      const subject = `control.registerCommands.${command.commandDisplayName}`;
      void this.natsClient.publish(
        subject,
        JSON.stringify({
          commandUUID: command.commandUUID,
          commandDisplayName: command.commandDisplayName,
        })
      );
    }

    log.debug('Prompted re-registration for command', {
      producer: 'router',
      commandUUID: command.commandUUID,
      commandDisplayName: command.commandDisplayName,
    });
  }

  registerCommand(registration: CommandRegistration): void {
    const ctx = `command ${registration.commandDisplayName ?? registration.commandUUID}`;

    const registeredCommand: RegisteredCommand = {
      commandUUID: registration.commandUUID,
      commandDisplayName: registration.commandDisplayName,
      platformRegex: compileRegex(registration.platform || '.*', `${ctx} platform`),
      networkRegex: compileRegex(registration.network || '.*', `${ctx} network`),
      instanceRegex: compileRegex(registration.instance || '.*', `${ctx} instance`),
      channelRegex: compileRegex(registration.channel || '.*', `${ctx} channel`),
      userRegex: compileRegex(registration.user || '.*', `${ctx} user`),
      nickRegex: compileRegex(registration.nick || '.*', `${ctx} nick`),
      commandRegex: compileRegex(registration.regex, `${ctx} command`),
      platformPrefixAllowed: registration.platformPrefixAllowed,
      nickPrefixAllowed: registration.nickPrefixAllowed,
      ratelimit: registration.ratelimit,
    };

    this.commands.set(registration.commandUUID, registeredCommand);

    log.info('Registered command', {
      producer: 'router',
      commandUUID: registration.commandUUID,
      commandDisplayName: registration.commandDisplayName,
    });
  }

  unregisterCommand(commandUUID: string): boolean {
    const result = this.commands.delete(commandUUID);

    if (result) {
      log.info('Unregistered command', {
        producer: 'router',
        commandUUID: commandUUID,
      });
    }
    return result;
  }

  getCommand(commandUUID: string): RegisteredCommand | undefined {
    return this.commands.get(commandUUID);
  }

  getAllCommands(): RegisteredCommand[] {
    try {
      return Array.from(this.commands.values());
    } catch (error) {
      log.error('Failed to get all commands from registry', {
        producer: 'router',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return [];
    }
  }

  getCommandDisplayName(commandUUID: string): string | undefined {
    const command = this.commands.get(commandUUID);
    return command?.commandDisplayName;
  }

  findMatchingCommands(
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string,
    nick: string,
    commandText: string,
    commonPrefixRegex?: string,
    botNick?: string
  ): Array<{
    command: RegisteredCommand;
    matchedText: string;
    argsText: string;
    matchedCommand: string;
  }> {
    const results: Array<{
      command: RegisteredCommand;
      matchedText: string;
      argsText: string;
      matchedCommand: string;
    }> = [];

    for (const cmd of this.commands.values()) {
      // Check platform, network, instance, channel, user, and nick regexes
      if (
        !cmd.platformRegex.test(platform) ||
        !cmd.networkRegex.test(network) ||
        !cmd.instanceRegex.test(instance) ||
        !cmd.channelRegex.test(channel) ||
        !cmd.userRegex.test(user) ||
        !cmd.nickRegex.test(nick)
      ) {
        continue;
      }

      // Process text for prefix matching
      let textToMatch = commandText;

      // Track if we need to match prefixes
      const needsPlatformPrefix =
        cmd.platformPrefixAllowed && commonPrefixRegex;
      const needsNickPrefix = cmd.nickPrefixAllowed && botNick;

      // If either prefix is required, try to match one of them
      if (needsPlatformPrefix || needsNickPrefix) {
        let prefixMatched = false;

        // Try platform prefix first
        if (needsPlatformPrefix) {
          try {
            const prefixRegex = new RegExp(commonPrefixRegex);
            const match = textToMatch.match(prefixRegex);
            if (match) {
              // Remove the prefix from the command text for matching
              textToMatch = textToMatch.slice(match[0].length).trim();
              prefixMatched = true;
            }
          } catch (error) {
            // If the prefix regex is invalid, log an error but continue with original text
            log.error('Invalid commonPrefixRegex, using original text', {
              producer: 'router',
              commonPrefixRegex: commonPrefixRegex,
              error: (error as Error).message,
            });
          }
        }

        // Try nick prefix if platform prefix didn't match (or if only nick prefix is needed)
        if (needsNickPrefix && !prefixMatched) {
          try {
            // Escape regex special characters in botNick to prevent injection
            const escapedNick = botNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const nickPrefixPattern = new RegExp(`^${escapedNick}[:;, ]*`, 'i');
            const nickMatch = textToMatch.match(nickPrefixPattern);
            if (nickMatch) {
              // Remove the nick prefix from the command text for matching
              textToMatch = textToMatch.slice(nickMatch[0].length).trim();
              prefixMatched = true;
            }
          } catch (error) {
            // If the nick prefix regex is invalid, log an error but continue with original text
            log.error('Invalid nickPrefixPattern, using original text', {
              producer: 'router',
              botNick,
              error: (error as Error).message,
            });
          }
        }

        // If a prefix is required but none matched, skip this command
        if (!prefixMatched) {
          continue;
        }
      }

      // Check if the command regex matches the text and extract match details
      const commandMatch = textToMatch.match(cmd.commandRegex);
      if (commandMatch) {
        // Extract the args text (text after the matched command)
        const textAfterCommand = textToMatch
          .slice((commandMatch.index || 0) + commandMatch[0].length)
          .trimStart();

        results.push({
          command: cmd,
          matchedText: textToMatch,
          argsText: textAfterCommand,
          matchedCommand: commandMatch[0],
        });
      }
    }

    return results;
  }
}
