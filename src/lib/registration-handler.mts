import { log, RateLimitConfig } from '@eeveebot/libeevee';
import { CommandRegistry } from './command-registry.mjs';
import { BroadcastRegistry } from './broadcast-registry.mjs';
import { EventRegistry } from './event-registry.mjs';
import { CommandRegistration, CommandUnregistration } from '../types/command.mjs';
import { BroadcastRegistration, BroadcastUnregistration } from '../types/broadcast.mjs';
import { EventRegistration, EventUnregistration } from '../types/event.mjs';
import { registrationCounter } from './metrics/index.mjs';
import { errorCounter } from '@eeveebot/libeevee';

const VALID_RATELIMIT_MODES = new Set(['enqueue', 'drop']);
const VALID_RATELIMIT_LEVELS = new Set(['platform', 'instance', 'channel', 'user', 'global']);
const INTERVAL_REGEX = /^\d+[smh]$/;

/**
 * Validate a ratelimit config object. Returns true if valid.
 */
function isValidRateLimit(ratelimit: unknown): ratelimit is RateLimitConfig {
  if (!ratelimit || typeof ratelimit !== 'object') return false;
  const rl = ratelimit as Record<string, unknown>;
  if (typeof rl.mode !== 'string' || !VALID_RATELIMIT_MODES.has(rl.mode)) return false;
  if (typeof rl.level !== 'string' || !VALID_RATELIMIT_LEVELS.has(rl.level)) return false;
  if (typeof rl.limit !== 'number' || rl.limit < 0 || !Number.isInteger(rl.limit)) return false;
  if (typeof rl.interval !== 'string' || !INTERVAL_REGEX.test(rl.interval)) return false;
  return true;
}

/**
 * Handle command registration messages
 * @param subject The NATS subject
 * @param message The message content
 * @param commandRegistry The command registry
 */
export function handleCommandRegistration(
  subject: string,
  message: { string: () => string },
  commandRegistry: CommandRegistry
): void {
  try {
    const registrationData = JSON.parse(
      message.string()
    ) as CommandRegistration;

    if (registrationData.type !== 'command.register') {
      log.warn(
        'Received non-command.register message on command.register subject',
        {
          producer: 'router',
          subject: subject,
          messageType: registrationData.type,
        }
      );
      return;
    }

    // Validate ratelimit config
    if (!isValidRateLimit(registrationData.ratelimit)) {
      log.error('Rejected command registration with invalid ratelimit', {
        producer: 'router',
        commandUUID: registrationData.commandUUID,
        commandDisplayName: registrationData.commandDisplayName,
        ratelimit: registrationData.ratelimit,
      });
      registrationCounter.inc({ module: 'router', type: 'command', result: 'error' });
      errorCounter.inc({ module: 'router', type: 'registration', operation: 'invalid_ratelimit' });
      return;
    }

    commandRegistry.registerCommand(registrationData);
    log.info('Processed command registration', {
      producer: 'router',
      commandUUID: registrationData.commandUUID,
    });

    // Record successful registration
    registrationCounter.inc({
      module: 'router',
      type: 'command',
      result: 'success',
    });
  } catch (err: unknown) {
    const error = err as Error;
    log.error('Failed to process command registration', {
      producer: 'router',
      subject: subject,
      errorMessage: error.message,
    });

    // Record registration error
    registrationCounter.inc({
      module: 'router',
      type: 'command',
      result: 'error',
    });
    errorCounter.inc({
      module: 'router',
      type: 'registration',
      operation: 'command_registration',
    });
  }
}

/**
 * Handle broadcast registration messages
 * @param subject The NATS subject
 * @param message The message content
 * @param broadcastRegistry The broadcast registry
 */
export function handleBroadcastRegistration(
  subject: string,
  message: { string: () => string },
  broadcastRegistry: BroadcastRegistry
): void {
  try {
    const registrationData = JSON.parse(
      message.string()
    ) as BroadcastRegistration;

    if (registrationData.type !== 'broadcast.register') {
      log.warn(
        'Received non-broadcast.register message on broadcast.register subject',
        {
          producer: 'router',
          subject: subject,
          messageType: registrationData.type,
        }
      );
      return;
    }

    broadcastRegistry.registerBroadcast(registrationData);
    log.info('Processed broadcast registration', {
      producer: 'router',
      broadcastUUID: registrationData.broadcastUUID,
    });

    // Record successful registration
    registrationCounter.inc({
      module: 'router',
      type: 'broadcast',
      result: 'success',
    });
  } catch (err: unknown) {
    const error = err as Error;
    log.error('Failed to process broadcast registration', {
      producer: 'router',
      subject: subject,
      errorMessage: error.message,
    });

    // Record registration error
    registrationCounter.inc({
      module: 'router',
      type: 'broadcast',
      result: 'error',
    });
    errorCounter.inc({
      module: 'router',
      type: 'registration',
      operation: 'broadcast_registration',
    });
  }
}

/**
 * Handle command unregistration messages
 * @param subject The NATS subject
 * @param message The message content
 * @param commandRegistry The command registry
 */
export function handleCommandUnregistration(
  subject: string,
  message: { string: () => string },
  commandRegistry: CommandRegistry
): void {
  try {
    const data = JSON.parse(message.string()) as CommandUnregistration;

    if (data.type !== 'command.unregister') {
      log.warn(
        'Received non-command.unregister message on command.unregister subject',
        {
          producer: 'router',
          subject: subject,
          messageType: data.type,
        }
      );
      return;
    }

    commandRegistry.unregisterCommand(data.commandUUID);
    log.info('Processed command unregistration', {
      producer: 'router',
      commandUUID: data.commandUUID,
    });

    registrationCounter.inc({
      module: 'router',
      type: 'command',
      result: 'success',
    });
  } catch (err: unknown) {
    const error = err as Error;
    log.error('Failed to process command unregistration', {
      producer: 'router',
      subject: subject,
      errorMessage: error.message,
    });

    registrationCounter.inc({
      module: 'router',
      type: 'command',
      result: 'error',
    });
    errorCounter.inc({
      module: 'router',
      type: 'registration',
      operation: 'command_unregistration',
    });
  }
}

/**
 * Handle broadcast unregistration messages
 * @param subject The NATS subject
 * @param message The message content
 * @param broadcastRegistry The broadcast registry
 */
export function handleBroadcastUnregistration(
  subject: string,
  message: { string: () => string },
  broadcastRegistry: BroadcastRegistry
): void {
  try {
    const data = JSON.parse(message.string()) as BroadcastUnregistration;

    if (data.type !== 'broadcast.unregister') {
      log.warn(
        'Received non-broadcast.unregister message on broadcast.unregister subject',
        {
          producer: 'router',
          subject: subject,
          messageType: data.type,
        }
      );
      return;
    }

    broadcastRegistry.unregisterBroadcast(data.broadcastUUID);
    log.info('Processed broadcast unregistration', {
      producer: 'router',
      broadcastUUID: data.broadcastUUID,
    });

    registrationCounter.inc({
      module: 'router',
      type: 'broadcast',
      result: 'success',
    });
  } catch (err: unknown) {
    const error = err as Error;
    log.error('Failed to process broadcast unregistration', {
      producer: 'router',
      subject: subject,
      errorMessage: error.message,
    });

    registrationCounter.inc({
      module: 'router',
      type: 'broadcast',
      result: 'error',
    });
    errorCounter.inc({
      module: 'router',
      type: 'registration',
      operation: 'broadcast_unregistration',
    });
  }
}

/**
 * Handle event registration messages
 * @param subject The NATS subject
 * @param message The message content
 * @param eventRegistry The event registry
 */
export function handleEventRegistration(
  subject: string,
  message: { string: () => string },
  eventRegistry: EventRegistry
): void {
  try {
    const registrationData = JSON.parse(
      message.string()
    ) as EventRegistration;

    if (registrationData.type !== 'event.register') {
      log.warn(
        'Received non-event.register message on event.register subject',
        {
          producer: 'router',
          subject: subject,
          messageType: registrationData.type,
        }
      );
      return;
    }

    eventRegistry.registerEvent(registrationData);
    log.info('Processed event registration', {
      producer: 'router',
      eventUUID: registrationData.eventUUID,
    });

    registrationCounter.inc({
      module: 'router',
      type: 'event',
      result: 'success',
    });
  } catch (err: unknown) {
    const error = err as Error;
    log.error('Failed to process event registration', {
      producer: 'router',
      subject: subject,
      errorMessage: error.message,
    });

    registrationCounter.inc({
      module: 'router',
      type: 'event',
      result: 'error',
    });
    errorCounter.inc({
      module: 'router',
      type: 'registration',
      operation: 'event_registration',
    });
  }
}

/**
 * Handle event unregistration messages
 * @param subject The NATS subject
 * @param message The message content
 * @param eventRegistry The event registry
 */
export function handleEventUnregistration(
  subject: string,
  message: { string: () => string },
  eventRegistry: EventRegistry
): void {
  try {
    const data = JSON.parse(message.string()) as EventUnregistration;

    if (data.type !== 'event.unregister') {
      log.warn(
        'Received non-event.unregister message on event.unregister subject',
        {
          producer: 'router',
          subject: subject,
          messageType: data.type,
        }
      );
      return;
    }

    eventRegistry.unregisterEvent(data.eventUUID);
    log.info('Processed event unregistration', {
      producer: 'router',
      eventUUID: data.eventUUID,
    });

    registrationCounter.inc({
      module: 'router',
      type: 'event',
      result: 'success',
    });
  } catch (err: unknown) {
    const error = err as Error;
    log.error('Failed to process event unregistration', {
      producer: 'router',
      subject: subject,
      errorMessage: error.message,
    });

    registrationCounter.inc({
      module: 'router',
      type: 'event',
      result: 'error',
    });
    errorCounter.inc({
      module: 'router',
      type: 'registration',
      operation: 'event_unregistration',
    });
  }
}
