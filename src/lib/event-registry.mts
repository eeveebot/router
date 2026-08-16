import { NatsClient, log } from '@eeveebot/libeevee';
import {
  EventRegistration,
  RegisteredEvent,
} from '../types/event.mjs';
import { compileRegex } from './compile-regex.mjs';

export class EventRegistry {
  private events: Map<string, RegisteredEvent> = new Map();
  private natsClient: InstanceType<typeof NatsClient> | null = null;

  constructor(natsClient?: InstanceType<typeof NatsClient>) {
    this.natsClient = natsClient || null;
  }

  public destroy(): void {
    this.events.clear();
  }

  /**
   * Prompt modules to re-register a specific event
   */
  public promptReRegistration(eventUUID: string): void {
    const event = this.events.get(eventUUID);
    if (!event || !this.natsClient) {
      return;
    }

    // Emit to the general re-registration channel
    void this.natsClient.publish(
      'control.registerEvents',
      JSON.stringify({})
    );

    // Emit to the event-specific re-registration channel if displayName exists
    if (event.eventDisplayName) {
      const subject = `control.registerEvents.${event.eventDisplayName}`;
      void this.natsClient.publish(
        subject,
        JSON.stringify({
          eventUUID: event.eventUUID,
          eventDisplayName: event.eventDisplayName,
        })
      );
    }

    log.debug('Prompted re-registration for event', {
      producer: 'router',
      eventUUID: event.eventUUID,
      eventDisplayName: event.eventDisplayName,
    });
  }

  registerEvent(registration: EventRegistration): void {
    const ctx = `event ${registration.eventDisplayName ?? registration.eventUUID}`;

    const registeredEvent: RegisteredEvent = {
      eventUUID: registration.eventUUID,
      eventDisplayName: registration.eventDisplayName,
      eventTypeRegex: compileRegex(registration.eventType || '.*', `${ctx} eventType`),
      platformRegex: compileRegex(registration.platform || '.*', `${ctx} platform`),
      networkRegex: compileRegex(registration.network || '.*', `${ctx} network`),
      instanceRegex: compileRegex(registration.instance || '.*', `${ctx} instance`),
      channelRegex: compileRegex(registration.channel || '.*', `${ctx} channel`),
      userRegex: compileRegex(registration.user || '.*', `${ctx} user`),
      nickRegex: compileRegex(registration.nick || '.*', `${ctx} nick`),
    };

    this.events.set(registration.eventUUID, registeredEvent);

    log.info('Registered event', {
      producer: 'router',
      eventUUID: registration.eventUUID,
      eventDisplayName: registration.eventDisplayName,
    });
  }

  unregisterEvent(eventUUID: string): boolean {
    const result = this.events.delete(eventUUID);

    if (result) {
      log.info('Unregistered event', {
        producer: 'router',
        eventUUID: eventUUID,
      });
    }
    return result;
  }

  getEvent(eventUUID: string): RegisteredEvent | undefined {
    return this.events.get(eventUUID);
  }

  getAllEvents(): RegisteredEvent[] {
    return Array.from(this.events.values());
  }

  getEventDisplayName(eventUUID: string): string | undefined {
    const event = this.events.get(eventUUID);
    return event?.eventDisplayName;
  }

  findMatchingEvents(
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string,
    nick: string,
    eventType: string
  ): RegisteredEvent[] {
    return Array.from(this.events.values()).filter((event) => {
      if (
        !event.eventTypeRegex.test(eventType) ||
        !event.platformRegex.test(platform) ||
        !event.networkRegex.test(network) ||
        !event.instanceRegex.test(instance) ||
        !event.channelRegex.test(channel) ||
        !event.userRegex.test(user) ||
        !event.nickRegex.test(nick)
      ) {
        return false;
      }

      return true;
    });
  }
}
