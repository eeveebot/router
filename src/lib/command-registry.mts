import { NatsClient, log } from '@eeveebot/libeevee';
import { CommandRegistration, RegisteredCommand } from '../types/command.mjs';

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
    try {
      const registeredCommand: RegisteredCommand = {
        commandUUID: registration.commandUUID,
        commandDisplayName: registration.commandDisplayName,
        platformRegex: new RegExp(registration.platform),
        networkRegex: new RegExp(registration.network),
        instanceRegex: new RegExp(registration.instance),
        channelRegex: new RegExp(registration.channel),
        userRegex: new RegExp(registration.user),
        commandRegex: new RegExp(registration.regex),
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
    } catch (error) {
      log.error('Failed to register command', {
        producer: 'router',
        commandUUID: registration.commandUUID,
        commandDisplayName: registration.commandDisplayName,
        errorMessage: (error as Error).message,
      });
    }
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
      // Check platform, network, instance, channel, and user regexes
      if (
        !cmd.platformRegex.test(platform) ||
        !cmd.networkRegex.test(network) ||
        !cmd.instanceRegex.test(instance) ||
        !cmd.channelRegex.test(channel) ||
        !cmd.userRegex.test(user)
      ) {
        continue;
      }

      // Process text for prefix matching
      let textToMatch = commandText;

      // If platform prefix is allowed, it must be present
      if (cmd.platformPrefixAllowed && commonPrefixRegex) {
        let prefixFound = false;
        try {
          const prefixRegex = new RegExp(commonPrefixRegex);
          const match = textToMatch.match(prefixRegex);
          if (match) {
            // Remove the prefix from the command text for matching
            textToMatch = textToMatch.slice(match[0].length).trim();
            prefixFound = true;
          }
        } catch (error) {
          // If the prefix regex is invalid, log an error but continue with original text
          log.error('Invalid commonPrefixRegex, using original text', {
            producer: 'router',
            commonPrefixRegex: commonPrefixRegex,
            error: (error as Error).message,
          });
        }
        
        // If platform prefix is required but not found, skip this command
        if (!prefixFound) {
          continue;
        }
      }
      
      // If nick prefix is allowed, it must be present
      if (cmd.nickPrefixAllowed && botNick) {
        let nickPrefixFound = false;
        // Create a regex pattern to match the bot's nick followed by common separators
        const nickPrefixPattern = new RegExp(`^${botNick}[:;, ]+`, 'i');
        const nickMatch = textToMatch.match(nickPrefixPattern);
        if (nickMatch) {
          // Remove the nick prefix from the command text for matching
          textToMatch = textToMatch.slice(nickMatch[0].length).trim();
          nickPrefixFound = true;
        }
        
        // If nick prefix is required but not found, skip this command
        if (!nickPrefixFound) {
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
