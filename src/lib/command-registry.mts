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
    commandText: string
  ): RegisteredCommand[] {
    return Array.from(this.commands.values()).filter((cmd) => {
      return (
        cmd.platformRegex.test(platform) &&
        cmd.networkRegex.test(network) &&
        cmd.instanceRegex.test(instance) &&
        cmd.channelRegex.test(channel) &&
        cmd.userRegex.test(user) &&
        cmd.commandRegex.test(commandText)
      );
    });
  }
}
