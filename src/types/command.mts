export interface RateLimitConfig {
  mode: 'enqueue' | 'drop';
  level: 'channel' | 'user' | 'global';
  limit: number;
  interval: string; // e.g., "30s", "1m", "5m"
}

export interface CommandRegistration {
  type: 'command.register';
  commandUUID: string;
  platform: string; // regex pattern
  network: string; // regex pattern
  instance: string; // regex pattern
  channel: string; // regex pattern
  user: string; // regex pattern
  regex: string; // regex pattern for the command itself
  platformPrefixAllowed: boolean;
  ratelimit: RateLimitConfig;
}

export interface RegisteredCommand {
  commandUUID: string;
  platformRegex: RegExp;
  networkRegex: RegExp;
  instanceRegex: RegExp;
  channelRegex: RegExp;
  userRegex: RegExp;
  commandRegex: RegExp;
  platformPrefixAllowed: boolean;
  ratelimit: RateLimitConfig;
}
