import { log } from '@eeveebot/libeevee';
import { CommandRegistry } from './command-registry.mjs';
import { RateLimiter } from './rate-limiter.mjs';

/**
 * Handle admin requests
 * @param subject The NATS subject
 * @param message The message content
 * @param nats The NATS client instance
 * @param commandRegistry The command registry
 * @param rateLimiter The rate limiter
 */
export function handleAdminRequest(
  subject: string,
  message: { string: () => string },
  nats: { publish: (subject: string, data: string) => Promise<boolean> },
  commandRegistry: CommandRegistry,
  rateLimiter: RateLimiter
): void {
  try {
    const data = JSON.parse(message.string());

    if (data.action === 'get-ratelimit-stats') {
      log.info('Received admin request for rate limit statistics', {
        producer: 'router',
        trace: data.trace,
      });

      // Get rate limit statistics
      const stats = rateLimiter.getStats();

      // Send response back to admin module
      const responseMessage = {
        action: 'ratelimit-stats',
        stats: stats,
        requester: data.requester,
        trace: data.trace,
      };

      void nats.publish(
        'admin.response.router.ratelimit-stats',
        JSON.stringify(responseMessage)
      );

      log.info('Sent rate limit statistics to admin module', {
        producer: 'router',
        trace: data.trace,
        entryCount: Object.keys(stats).length,
      });
    } else if (data.action === 'get-command-registry') {
      log.info('Received admin request for command registry', {
        producer: 'router',
        trace: data.trace,
      });

      try {
        // Get command registry information
        const registry = commandRegistry.getAllCommands();

        // Sanitize the registry data to remove circular references and non-serializable objects
        const sanitizedRegistry = registry.map((command) => ({
          commandUUID: command.commandUUID,
          commandDisplayName: command.commandDisplayName,
          platformRegex: {
            source: command.platformRegex.source,
          },
          networkRegex: {
            source: command.networkRegex.source,
          },
          instanceRegex: {
            source: command.instanceRegex.source,
          },
          channelRegex: {
            source: command.channelRegex.source,
          },
          userRegex: {
            source: command.userRegex.source,
          },
          commandRegex: {
            source: command.commandRegex.source,
          },
          platformPrefixAllowed: command.platformPrefixAllowed,
          nickPrefixAllowed: command.nickPrefixAllowed,
          ratelimit: command.ratelimit,
          ttl: command.ttl,
          registeredAt: command.registeredAt,
          expiresAt: command.expiresAt,
          // Exclude timers and other non-serializable properties
        }));

        // Send response back to admin module
        const responseMessage = {
          action: 'command-registry',
          registry: sanitizedRegistry,
          requester: data.requester,
          trace: data.trace,
        };

        void nats.publish(
          'admin.response.router.command-registry',
          JSON.stringify(responseMessage)
        );

        log.info('Sent command registry to admin module', {
          producer: 'router',
          trace: data.trace,
          entryCount: sanitizedRegistry.length,
        });
      } catch (registryError) {
        log.error('Failed to generate command registry', {
          producer: 'router',
          trace: data.trace,
          error:
            registryError instanceof Error
              ? registryError.message
              : String(registryError),
          stack:
            registryError instanceof Error ? registryError.stack : undefined,
        });

        // Send error response back to admin module
        const errorMessage = {
          action: 'command-registry-error',
          error: 'Failed to retrieve command registry',
          requester: data.requester,
          trace: data.trace,
        };

        try {
          void nats.publish(
            'admin.response.router.command-registry',
            JSON.stringify(errorMessage)
          );
        } catch (publishError) {
          log.error('Failed to publish command registry error response', {
            producer: 'router',
            trace: data.trace,
            error:
              publishError instanceof Error
                ? publishError.message
                : String(publishError),
            stack:
              publishError instanceof Error ? publishError.stack : undefined,
          });
        }
      }
    }
  } catch (error) {
    log.error('Failed to process admin request', {
      producer: 'router',
      message: message.string(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
