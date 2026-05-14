import { RateLimitConfig } from '@eeveebot/libeevee';

export { RateLimitConfig };

export interface CommandRegistration {
  type: 'command.register';
  commandUUID: string;
  commandDisplayName?: string; // Optional display name for logs and UI
  platform?: string; // regex pattern (optional, defaults to '.*')
  network?: string; // regex pattern (optional, defaults to '.*')
  instance?: string; // regex pattern (optional, defaults to '.*')
  channel?: string; // regex pattern (optional, defaults to '.*')
  user?: string; // regex pattern (optional, defaults to '.*')
  nick?: string; // regex pattern for nick filtering (optional, defaults to '.*')
  regex: string; // regex pattern for the command itself
  platformPrefixAllowed: boolean;
  nickPrefixAllowed?: boolean; // Whether the bot's nick can be used as a prefix
  ratelimit: RateLimitConfig;
}

export interface CommandUnregistration {
  type: 'command.unregister';
  commandUUID: string;
}

export interface RegisteredCommand {
  commandUUID: string;
  commandDisplayName?: string; // Optional display name for logs and UI
  platformRegex: RegExp;
  networkRegex: RegExp;
  instanceRegex: RegExp;
  channelRegex: RegExp;
  userRegex: RegExp;
  nickRegex: RegExp;
  commandRegex: RegExp;
  platformPrefixAllowed: boolean;
  nickPrefixAllowed?: boolean; // Whether the bot's nick can be used as a prefix
  ratelimit: RateLimitConfig;
}
