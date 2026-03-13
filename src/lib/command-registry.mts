import { NatsClient, log } from '@eeveebot/libeevee';
import { CommandRegistration, RegisteredCommand } from '../types/command.mjs';

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private reRegistrationInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60000; // 1 minute
  private readonly DEFAULT_TTL_MS = this.CLEANUP_INTERVAL_MS * 2; // 2 minutes
  private readonly REREGISTRATION_CHECK_INTERVAL_MS = this.DEFAULT_TTL_MS / 4; // Check every 30 seconds (1/4 of default TTL)
  private natsClient: InstanceType<typeof NatsClient> | null = null;

  constructor(natsClient?: InstanceType<typeof NatsClient>) {
    this.natsClient = natsClient || null;
    this.startPeriodicCleanup();
    this.startPeriodicReRegistrationCheck();
  }

  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCommands();
    }, this.CLEANUP_INTERVAL_MS);

    // Ensure the interval doesn't prevent the process from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  private startPeriodicReRegistrationCheck(): void {
    this.reRegistrationInterval = setInterval(() => {
      this.promptReRegistration();
    }, this.REREGISTRATION_CHECK_INTERVAL_MS);

    // Ensure the interval doesn't prevent the process from exiting
    if (this.reRegistrationInterval.unref) {
      this.reRegistrationInterval.unref();
    }
  }

  public stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.reRegistrationInterval) {
      clearInterval(this.reRegistrationInterval);
      this.reRegistrationInterval = null;
    }
  }

  // Cleanup-like method to clean up resources
  public destroy(): void {
    this.stopPeriodicCleanup();
  }

  /**
   * Prompt modules to re-register their commands that are halfway through their TTL
   */
  private promptReRegistration(): void {
    if (!this.natsClient) {
      return;
    }

    const now = Date.now();
    const commandsToRefresh: RegisteredCommand[] = [];

    // Find commands that are halfway through their TTL
    for (const command of this.commands.values()) {
      const halfLife = command.registeredAt + command.ttl / 2;
      if (
        now >= halfLife &&
        now < halfLife + this.REREGISTRATION_CHECK_INTERVAL_MS
      ) {
        commandsToRefresh.push(command);
      }
    }

    // Emit re-registration prompts for each command
    for (const command of commandsToRefresh) {
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
  }

  registerCommand(registration: CommandRegistration): void {
    try {
      const now = Date.now();
      // Use provided TTL or default to 2x cleanup interval
      const ttl = registration.ttl ?? this.DEFAULT_TTL_MS;
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
    // Clean up expired commands first
    this.cleanupExpiredCommands();

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

  /**
   * Remove expired commands from the registry
   */
  cleanupExpiredCommands(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [commandUUID, command] of this.commands.entries()) {
      if (now > command.expiresAt) {
        this.commands.delete(commandUUID);
        expiredCount++;
        log.info('Expired command removed', {
          producer: 'router',
          commandUUID: commandUUID,
          commandDisplayName: command.commandDisplayName,
        });
      }
    }

    if (expiredCount > 0) {
      log.info('Cleanup completed', {
        producer: 'router',
        expiredCount: expiredCount,
      });
    }
  }

  /**
   * Get count of expired commands without removing them
   */
  getExpiredCommandCount(): number {
    const now = Date.now();
    let count = 0;

    for (const command of this.commands.values()) {
      if (now > command.expiresAt) {
        count++;
      }
    }

    return count;
  }
}
