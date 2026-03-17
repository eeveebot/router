export interface BroadcastRegistration {
  type: 'broadcast.register';
  broadcastUUID: string;
  broadcastDisplayName?: string; // Optional display name for logs and UI
  platform?: string; // regex pattern (optional, defaults to '.*')
  network?: string; // regex pattern (optional, defaults to '.*')
  instance?: string; // regex pattern (optional, defaults to '.*')
  channel?: string; // regex pattern (optional, defaults to '.*')
  user?: string; // regex pattern (optional, defaults to '.*')
  nick?: string; // regex pattern for nick filtering (optional, defaults to '.*')
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
  nickRegex: RegExp;
  messageFilterRegex?: RegExp; // Optional regex pattern to filter messages
}
