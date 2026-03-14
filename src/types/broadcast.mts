export interface BroadcastRegistration {
  type: 'broadcast.register';
  broadcastUUID: string;
  broadcastDisplayName?: string; // Optional display name for logs and UI
  platform: string; // regex pattern
  network: string; // regex pattern
  instance: string; // regex pattern
  channel: string; // regex pattern
  user: string; // regex pattern
  messageFilterRegex?: string; // Optional regex pattern to filter messages
  ttl?: number; // Time-to-live in milliseconds (optional)
}

interface BroadcastTimers {
  cleanupTimer: NodeJS.Timeout;
  reRegistrationTimer: NodeJS.Timeout;
}

export interface RegisteredBroadcast {
  broadcastUUID: string;
  broadcastDisplayName?: string; // Optional display name for logs and UI
  platformRegex: RegExp;
  networkRegex: RegExp;
  instanceRegex: RegExp;
  channelRegex: RegExp;
  userRegex: RegExp;
  messageFilterRegex?: RegExp; // Optional regex pattern to filter messages
  ttl: number; // Time-to-live in milliseconds
  registeredAt: number; // Timestamp when the broadcast was registered
  expiresAt: number; // Timestamp when the broadcast expires
  timers?: BroadcastTimers; // Timers for cleanup and re-registration
}
