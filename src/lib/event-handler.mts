import { log } from '@eeveebot/libeevee';
import { EventRegistry } from './event-registry.mjs';
import { RouterConfig } from '../types/config.mjs';
import {
  messageCounter,
  natsPublishCounter,
} from '@eeveebot/libeevee';

interface EventData {
  eventType: string;
  platform: string;
  network: string;
  instance: string;
  channel: string | null;
  nick: string;
  user: string;
  userHost?: string;
  reason?: string;
  kickedBy?: string;
  timestamp: string;
}

/**
 * Check if an event should be blocked based on the blocklist configuration.
 *
 * Events have no `text` field, so the blocklist `pattern` (which matches
 * against message text) is not applied. Only `nick` and `user` (ident)
 * are checked. Blocklist entries with a specific `pattern` that doesn't
 * match anything in events are effectively ignored for event routing —
 * the entry still applies to chat messages via `shouldBlockMessage`.
 *
 * If a blocklist entry has no `pattern` (or pattern is `.*`), it matches
 * all events from that user. Entries with a specific pattern are skipped
 * for events (no text to test against).
 */
function shouldBlockEvent(
  eventData: EventData,
  config: RouterConfig
): boolean {
  if (!config.blocklist || config.blocklist.length === 0) {
    return false;
  }

  for (const entry of config.blocklist) {
    if (entry.enabled === false) {
      continue;
    }

    // Check context filters
    if (entry.platform && !entry.platform.test(eventData.platform)) {
      continue;
    }

    if (entry.network && !entry.network.test(eventData.network)) {
      continue;
    }

    if (entry.instance && !entry.instance.test(eventData.instance)) {
      continue;
    }

    // Events can have null channel (quit). Use empty string for matching.
    const channelForMatch = eventData.channel ?? '';
    if (entry.channel && !entry.channel.test(channelForMatch)) {
      continue;
    }

    if (entry.user && !entry.user.test(eventData.user)) {
      continue;
    }

    // Events have no text field. If the blocklist entry has a specific
    // pattern (not .*), skip it — it's meant for message text filtering.
    // If the pattern is .* (match everything), it applies to events too.
    if (entry.pattern && entry.pattern.source !== '.*') {
      continue;
    }

    // At this point, all context filters matched and the pattern is
    // either absent or .* — block this event.
    log.info('Blocked event due to blocklist match', {
      producer: 'router',
      platform: eventData.platform,
      network: eventData.network,
      instance: eventData.instance,
      channel: eventData.channel,
      user: eventData.user,
      nick: eventData.nick,
      eventType: eventData.eventType,
    });
    return true;
  }

  return false;
}

/**
 * Handle incoming chat events (part/quit/kick) from connectors.
 *
 * Events are simpler than chat messages — no command matching, no rate
 * limiting. Just blocklist filtering and forward to registered modules.
 *
 * @param subject The NATS subject
 * @param message The message content
 * @param nats The NATS client instance
 * @param eventRegistry The event registry
 * @param routerConfig The router configuration
 */
export function handleChatEvent(
  subject: string,
  message: { string: () => string },
  nats: { publish: (subject: string, data: string) => Promise<boolean> },
  eventRegistry: EventRegistry,
  routerConfig: RouterConfig
): void {
  try {
    const eventData: EventData = JSON.parse(message.string());

    log.info('Received chat event', {
      producer: 'router',
      subject: subject,
      eventType: eventData.eventType,
      platform: eventData.platform,
      network: eventData.network,
      instance: eventData.instance,
      channel: eventData.channel,
      nick: eventData.nick,
    });

    // Check blocklist before forwarding
    if (shouldBlockEvent(eventData, routerConfig)) {
      log.info('Dropped event due to blocklist match', {
        producer: 'router',
        eventType: eventData.eventType,
        platform: eventData.platform,
        network: eventData.network,
        channel: eventData.channel,
        user: eventData.user,
      });

      messageCounter.inc({
        module: 'router',
        direction: 'incoming',
        result: 'blocked',
      });

      return;
    }

    // For quit events, channel is null — pass empty string for regex matching
    const channelForMatching = eventData.channel ?? '';

    const matchingEvents = eventRegistry.findMatchingEvents(
      eventData.platform,
      eventData.network,
      eventData.instance,
      channelForMatching,
      eventData.user || eventData.nick,
      eventData.nick,
      eventData.eventType
    );

    if (matchingEvents.length === 0) {
      log.info('Dropped event with no matching registrations', {
        producer: 'router',
        eventType: eventData.eventType,
        platform: eventData.platform,
        network: eventData.network,
        channel: eventData.channel,
        nick: eventData.nick,
      });

      messageCounter.inc({
        module: 'router',
        direction: 'incoming',
        result: 'dropped',
      });

      return;
    }

    messageCounter.inc({
      module: 'router',
      direction: 'incoming',
      result: 'processed',
    });

    // Forward the event to each matching registered module
    matchingEvents.forEach((event) => {
      const forwardSubject = `event.message.${event.eventUUID}`;
      void nats.publish(forwardSubject, JSON.stringify(eventData));

      log.info('Published event to module', {
        producer: 'router',
        eventUUID: event.eventUUID,
        eventDisplayName: event.eventDisplayName,
        eventType: eventData.eventType,
        nick: eventData.nick,
        subject: forwardSubject,
      });

      natsPublishCounter.inc({ module: 'router', type: 'event' });
    });
  } catch (err: unknown) {
    const error = err as Error;
    log.error('Failed to process chat event', {
      producer: 'router',
      subject: subject,
      errorMessage: error.message,
    });

    messageCounter.inc({
      module: 'router',
      direction: 'incoming',
      result: 'error',
    });
  }
}
