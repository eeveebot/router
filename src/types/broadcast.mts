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
}
