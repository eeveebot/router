export interface RateLimitConfig {
  mode: 'enqueue' | 'drop';
  level: 'channel' | 'user' | 'global';
  limit: number;
  interval: string; // e.g., "30s", "1m", "5m"
}

export interface CommandRegistration {
  type: 'command.register';
  commandUUID: string;
  commandDisplayName?: string; // Optional display name for logs and UI
  platform: string; // regex pattern
  network: string; // regex pattern
  instance: string; // regex pattern
  channel: string; // regex pattern
  user: string; // regex pattern
  regex: string; // regex pattern for the command itself
  platformPrefixAllowed: boolean;
  nickPrefixAllowed?: boolean; // Whether the bot's nick can be used as a prefix
  ratelimit: RateLimitConfig;
  ttl?: number; // Time-to-live in milliseconds (optional)
}

interface CommandTimers {
  cleanupTimer: NodeJS.Timeout;
  reRegistrationTimer: NodeJS.Timeout;
}

export interface RegisteredCommand {
  commandUUID: string;
  commandDisplayName?: string; // Optional display name for logs and UI
  platformRegex: RegExp;
  networkRegex: RegExp;
  instanceRegex: RegExp;
  channelRegex: RegExp;
  userRegex: RegExp;
  commandRegex: RegExp;
  platformPrefixAllowed: boolean;
  nickPrefixAllowed?: boolean; // Whether the bot's nick can be used as a prefix
  ratelimit: RateLimitConfig;
  ttl: number; // Time-to-live in milliseconds
  registeredAt: number; // Timestamp when the command was registered
  expiresAt: number; // Timestamp when the command expires
  timers?: CommandTimers; // Timers for cleanup and re-registration
}
