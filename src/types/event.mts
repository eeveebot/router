export interface EventRegistration {
  type: 'event.register';
  eventUUID: string;
  eventDisplayName?: string;
  eventType: string;           // regex pattern (e.g. 'part|quit|kick', or '.*' for all)
  platform?: string;          // regex pattern (optional, defaults to '.*')
  network?: string;
  instance?: string;
  channel?: string;
  user?: string;
  nick?: string;
}

export interface EventUnregistration {
  type: 'event.unregister';
  eventUUID: string;
}

export interface RegisteredEvent {
  eventUUID: string;
  eventDisplayName?: string;
  eventTypeRegex: RegExp;
  platformRegex: RegExp;
  networkRegex: RegExp;
  instanceRegex: RegExp;
  channelRegex: RegExp;
  userRegex: RegExp;
  nickRegex: RegExp;
}
