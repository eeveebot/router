import { log } from '@eeveebot/libeevee';
import { CommandRegistration, RegisteredCommand } from '../types/command.mjs';

export class CommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();

  registerCommand(registration: CommandRegistration): void {
    try {
      const registeredCommand: RegisteredCommand = {
        commandUUID: registration.commandUUID,
        platformRegex: new RegExp(registration.platform),
        networkRegex: new RegExp(registration.network),
        instanceRegex: new RegExp(registration.instance),
        channelRegex: new RegExp(registration.channel),
        userRegex: new RegExp(registration.user),
        commandRegex: new RegExp(registration.regex),
        platformPrefixAllowed: registration.platformPrefixAllowed,
        ratelimit: registration.ratelimit,
      };

      this.commands.set(registration.commandUUID, registeredCommand);
      log.info(`Registered command ${registration.commandUUID}`, {
        producer: 'router',
        commandUUID: registration.commandUUID,
      });
    } catch (error) {
      log.error(
        `Failed to register command ${registration.commandUUID}: ${(error as Error).message}`,
        {
          producer: 'router',
          commandUUID: registration.commandUUID,
        }
      );
    }
  }

  unregisterCommand(commandUUID: string): boolean {
    const result = this.commands.delete(commandUUID);
    if (result) {
      log.info(`Unregistered command ${commandUUID}`, {
        producer: 'router',
        commandUUID,
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
      // First check platform, network, instance, channel, and user regexes
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
          log.error(
            `Invalid commonPrefixRegex: ${commonPrefixRegex}, using original text`,
            {
              producer: 'router',
              error: (error as Error).message,
            }
          );
        }
      }

      // Finally, check if the command regex matches the (possibly modified) text
      return cmd.commandRegex.test(textToMatch);
    });
  }
}
