import { NatsClient, log } from '@eeveebot/libeevee';
import { CommandRegistration, RegisteredCommand } from '../types/command.mjs';

interface CommandTimers {
  cleanupTimer: NodeJS.Timeout;
  reRegistrationTimer: NodeJS.Timeout;
}

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();
  private commandTimers: Map<string, CommandTimers> = new Map();
  private natsClient: InstanceType<typeof NatsClient> | null = null;

  constructor(natsClient?: InstanceType<typeof NatsClient>) {
    this.natsClient = natsClient || null;
  }

  // Cleanup-like method to clean up resources
  public destroy(): void {
    // Clear all command timers
    for (const {
      cleanupTimer,
      reRegistrationTimer,
    } of this.commandTimers.values()) {
      clearTimeout(cleanupTimer);
      clearTimeout(reRegistrationTimer);
    }
    this.commandTimers.clear();
  }

  /**
   * Prompt modules to re-register a specific command that is halfway through its TTL
   */
  private promptReRegistration(command: RegisteredCommand): void {
    if (!this.natsClient) {
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
      const now = Date.now();
      // Use provided TTL or default to 120000ms (2 minutes)
      const ttl = registration.ttl ?? 120000;
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
        ratelimit: registration.ratelimit,
        ttl: ttl,
        registeredAt: now,
        expiresAt: now + ttl,
      };

      this.commands.set(registration.commandUUID, registeredCommand);

      // Set up individual timers for this command
      const cleanupTimer = setTimeout(() => {
        this.commands.delete(registration.commandUUID);
        this.commandTimers.delete(registration.commandUUID);
        log.info('Expired command removed', {
          producer: 'router',
          commandUUID: registration.commandUUID,
          commandDisplayName: registration.commandDisplayName,
        });
      }, ttl);

      // Set up re-registration timer for halfway through TTL
      const reRegistrationTimer = setTimeout(() => {
        const command = this.commands.get(registration.commandUUID);
        if (command) {
          this.promptReRegistration(command);
        }
      }, ttl / 2);

      // Store timers so they can be cleared if needed
      this.commandTimers.set(registration.commandUUID, {
        cleanupTimer,
        reRegistrationTimer,
      });

      log.info('Registered command', {
        producer: 'router',
        commandUUID: registration.commandUUID,
        commandDisplayName: registration.commandDisplayName,
        ttl: ttl,
        expiresAt: registeredCommand.expiresAt,
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

    // Clear timers for this command
    const timers = this.commandTimers.get(commandUUID);
    if (timers) {
      clearTimeout(timers.cleanupTimer);
      clearTimeout(timers.reRegistrationTimer);
      this.commandTimers.delete(commandUUID);
    }

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
    return Array.from(this.commands.values());
  }

  findMatchingCommands(
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string,
    commandText: string,
    commonPrefixRegex?: string
  ): RegisteredCommand[] {
    return Array.from(this.commands.values()).filter((cmd) => {
      // First check if command has expired
      if (Date.now() > cmd.expiresAt) {
        return false;
      }

      // Then check platform, network, instance, channel, and user regexes
      if (
        !cmd.platformRegex.test(platform) ||
        !cmd.networkRegex.test(network) ||
        !cmd.instanceRegex.test(instance) ||
        !cmd.channelRegex.test(channel) ||
        !cmd.userRegex.test(user)
      ) {
        return false;
      }

      // If platformPrefixAllowed is true and a commonPrefixRegex is provided,
      // check if the command text matches it and extract the actual command part
      let textToMatch = commandText;
      if (cmd.platformPrefixAllowed && commonPrefixRegex) {
        try {
          const prefixRegex = new RegExp(commonPrefixRegex);
          const match = commandText.match(prefixRegex);
          if (match) {
            // Remove the prefix from the command text for matching
            textToMatch = commandText.slice(match[0].length).trim();
          } else {
            // If prefix is required but not found, this command doesn't match
            return false;
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

      // Finally, check if the command regex matches the (possibly modified) text
      return cmd.commandRegex.test(textToMatch);
    });
  }
}
