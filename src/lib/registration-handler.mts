import { log } from '@eeveebot/libeevee';
import { CommandRegistry } from './command-registry.mjs';
import { BroadcastRegistry } from './broadcast-registry.mjs';
import { CommandRegistration } from '../types/command.mjs';
import { BroadcastRegistration } from '../types/broadcast.mjs';
import { registrationCounter } from './metrics/index.mjs';
import { errorCounter } from '@eeveebot/libeevee';

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
      rawMessage: message.string(),
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
      rawMessage: message.string(),
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
