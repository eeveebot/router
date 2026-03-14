'use strict';

// Router module
// List for messages and routes them appropriately
// Also handles command registration

import { NatsClient, log } from '@eeveebot/libeevee';
import { CommandRegistry } from './lib/command-registry.mjs';
import { CommandRegistration } from './types/command.mjs';
import { RateLimiter } from './lib/rate-limiter.mjs';
import { BroadcastRegistry } from './lib/broadcast-registry.mjs';
import { BroadcastRegistration } from './types/broadcast.mjs';

// HTTP server imports
import express, { Application, Request, Response } from 'express';
import apiRoutes from './api/routes.mjs';

// Metrics imports
import {
  initializeSystemMetrics,
  messageCounter,
  messageProcessingTime,
  commandCounter,
  commandProcessingTime,
  broadcastCounter,
  rateLimitCounter,
  natsPublishCounter,
  natsSubscribeCounter,
  errorCounter,
  registrationCounter,
} from './lib/metrics/index.mjs';

// Record module startup time for uptime tracking
const moduleStartTime = Date.now();

export { rateLimiter };

const natsClients: InstanceType<typeof NatsClient>[] = [];
const natsSubscriptions: Array<Promise<string | boolean>> = [];

//
// Setup NATS connection

// Get host and token
const natsHost = process.env.NATS_HOST || false;
if (!natsHost) {
  const msg = 'environment variable NATS_HOST is not set.';
  throw new Error(msg);
}

const natsToken = process.env.NATS_TOKEN || false;
if (!natsToken) {
  const msg = 'environment variable NATS_TOKEN is not set.';
  throw new Error(msg);
}

const nats = new NatsClient({
  natsHost: natsHost as string,
  natsToken: natsToken as string,
});
natsClients.push(nats);
await nats.connect();

const commandRegistry = new CommandRegistry(nats);
const broadcastRegistry = new BroadcastRegistry(nats);

const rateLimiter = new RateLimiter(commandRegistry);

// Set the NATS client for the rate limiter
rateLimiter.setNatsClient(nats);

// Periodically process the command queue
setInterval(() => {
  if (nats && nats.nats) {
    void rateLimiter.processQueue(nats);
  }

  // Clean up old rate limit entries
  rateLimiter.cleanup();
}, 1000); // Check every second

// Initialize system metrics
initializeSystemMetrics();

// Setup HTTP API server
setupHttpServer();

//
// Do whatever teardown is necessary before calling common handler
process.on('SIGINT', () => {
  commandRegistry.destroy();
  broadcastRegistry.destroy();
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
});

process.on('SIGTERM', () => {
  commandRegistry.destroy();
  broadcastRegistry.destroy();
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
});

// Subscribe to chat.message.incoming.* messages
const chatMessageSubscription = nats.subscribe(
  'chat.message.incoming.>',
  (subject, message) => {
    const messageTimer = messageProcessingTime.startTimer();
    try {
      const msgData = JSON.parse(message.string());
      log.info('Received chat message', {
        producer: 'router',
        subject: subject,
        platform: msgData.platform,
        network: msgData.network,
        channel: msgData.channel,
        user: msgData.user,
        text: msgData.text,
      });

      // Increment message counter
      messageCounter.inc({
        platform: msgData.platform,
        network: msgData.network,
        result: 'success',
      });

      // Check if this message matches any registered commands
      const matchingCommands = commandRegistry.findMatchingCommands(
        msgData.platform,
        msgData.network,
        msgData.instance,
        msgData.channel,
        msgData.user,
        msgData.text,
        msgData.commonPrefixRegex
      );

      // Check if this message matches any registered broadcasts
      const matchingBroadcasts = broadcastRegistry.findMatchingBroadcasts(
        msgData.platform,
        msgData.network,
        msgData.instance,
        msgData.channel,
        msgData.user,
        msgData.text
      );

      // For each matching command, check rate limits and publish command execution message
      matchingCommands.forEach((command) => {
        // Process the command text to strip prefix if needed and extract matched command
        let processedText = msgData.text;
        let matchedCommand = '';

        if (command.platformPrefixAllowed && msgData.commonPrefixRegex) {
          try {
            const prefixRegex = new RegExp(msgData.commonPrefixRegex);
            const prefixMatch = msgData.text.match(prefixRegex);
            if (prefixMatch) {
              // Extract the matched prefix
              matchedCommand = prefixMatch[0].trim();
              // Remove the prefix from the command text
              const textWithoutPrefix = msgData.text
                .slice(prefixMatch[0].length)
                .trim();

              // Now use the command regex to match the actual command and extract args
              const commandMatch = textWithoutPrefix.match(
                command.commandRegex
              );
              if (commandMatch) {
                // Remove the matched command from the text, leaving only args
                const textAfterCommand = textWithoutPrefix
                  .slice(commandMatch[0].length)
                  .trim();
                // Only update processedText if there's actually text after the command
                if (textAfterCommand.length > 0) {
                  processedText = textAfterCommand;
                } else {
                  // If there's no text after the command, keep the original text without prefix
                  processedText = textWithoutPrefix;
                }
              } else {
                // If command doesn't match, use the text without prefix
                processedText = textWithoutPrefix;
              }
            }
          } catch (error) {
            // If the prefix regex is invalid, log an error but continue with original text
            log.error('Invalid commonPrefixRegex, using original text', {
              producer: 'router',
              commonPrefixRegex: msgData.commonPrefixRegex,
              error: (error as Error).message,
            });
          }
        }

        // Check rate limits
        const isAllowed = rateLimiter.isAllowed(
          command.commandUUID,
          command.ratelimit,
          msgData.platform,
          msgData.network,
          msgData.instance,
          msgData.channel,
          msgData.user
        );

        // Handle rate limiting based on mode
        if (!isAllowed) {
          if (command.ratelimit.mode === 'drop') {
            // Drop the command execution - do nothing
            rateLimitCounter.inc({
              command_uuid: command.commandUUID,
              action: 'dropped',
              mode: command.ratelimit.mode,
            });
            commandCounter.inc({
              command_uuid: command.commandUUID,
              platform: msgData.platform,
              network: msgData.network,
              channel: msgData.channel,
              rate_limit_action: 'dropped',
            });
            return;
          } else if (command.ratelimit.mode === 'enqueue') {
            // Enqueue the command for later execution
            rateLimitCounter.inc({
              command_uuid: command.commandUUID,
              action: 'enqueued',
              mode: command.ratelimit.mode,
            });
            commandCounter.inc({
              command_uuid: command.commandUUID,
              platform: msgData.platform,
              network: msgData.network,
              channel: msgData.channel,
              rate_limit_action: 'enqueued',
            });
            const commandSubject = `command.execute.${command.commandUUID}`;
            rateLimiter.enqueueCommand(
              command.commandUUID,
              msgData.platform,
              msgData.network,
              msgData.instance,
              msgData.channel,
              msgData.user,
              msgData.userHost,
              processedText,
              msgData.text,
              matchedCommand,
              msgData.timestamp,
              [commandSubject]
            );
            return;
          }
        }

        const commandSubject = `command.execute.${command.commandUUID}`;
        const commandMessage = {
          platform: msgData.platform,
          network: msgData.network,
          instance: msgData.instance,
          channel: msgData.channel,
          user: msgData.user,
          userHost: msgData.userHost,
          text: processedText,
          originalText: msgData.text,
          matchedCommand: matchedCommand,
          timestamp: msgData.timestamp,
        };

        // Start command processing timer
        const commandTimer = commandProcessingTime.startTimer({
          command_uuid: command.commandUUID,
        });

        void nats.publish(commandSubject, JSON.stringify(commandMessage));
        log.info('Published command execution', {
          producer: 'router',
          commandUUID: command.commandUUID,
          user: msgData.user,
          subject: commandSubject,
          originalText: msgData.text,
          matchedCommand: matchedCommand,
        });

        // Record successful command processing
        commandCounter.inc({
          command_uuid: command.commandUUID,
          platform: msgData.platform,
          network: msgData.network,
          channel: msgData.channel,
          rate_limit_action: 'allowed',
        });
        natsPublishCounter.inc({ type: 'command' });
        commandTimer();
      });

      // For each matching broadcast, publish the message to the broadcast channel
      matchingBroadcasts.forEach((broadcast) => {
        const broadcastSubject = `broadcast.message.${broadcast.broadcastUUID}`;
        const broadcastMessage = {
          platform: msgData.platform,
          network: msgData.network,
          instance: msgData.instance,
          channel: msgData.channel,
          user: msgData.user,
          userHost: msgData.userHost,
          text: msgData.text,
          timestamp: msgData.timestamp,
        };

        void nats.publish(broadcastSubject, JSON.stringify(broadcastMessage));
        log.info('Published message to broadcast', {
          producer: 'router',
          broadcastUUID: broadcast.broadcastUUID,
          user: msgData.user,
          subject: broadcastSubject,
        });

        // Record broadcast processing
        broadcastCounter.inc({
          broadcast_uuid: broadcast.broadcastUUID,
          platform: msgData.platform,
          network: msgData.network,
          channel: msgData.channel,
        });
        natsPublishCounter.inc({ type: 'broadcast' });
      });
    } catch (err: unknown) {
      const error = err as Error;
      log.error('Failed to parse chat message', {
        producer: 'router',
        subject: subject,
        errorMessage: error.message,
        rawMessage: message.string(),
      });
      
      // Increment error counter
      messageCounter.inc({
        platform: 'unknown',
        network: 'unknown',
        result: 'error',
      });
      errorCounter.inc({
        type: 'message_parse',
        operation: 'chat_message_processing',
      });
    } finally {
      // Record message processing time
      messageTimer();
    }
  }
);
natsSubscriptions.push(chatMessageSubscription);

// Record subscription metric
natsSubscribeCounter.inc({ subject: 'chat.message.incoming.>' });

// Subscribe to command.register messages
const commandRegisterSubscription = nats.subscribe(
  'command.register',
  (subject, message) => {
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
        type: 'command',
        result: 'error',
      });
      errorCounter.inc({
        type: 'registration',
        operation: 'command_registration',
      });
    }
  }
);
natsSubscriptions.push(commandRegisterSubscription);

// Record subscription metric
natsSubscribeCounter.inc({ subject: 'command.register' });

// Subscribe to broadcast.register messages
const broadcastRegisterSubscription = nats.subscribe(
  'broadcast.register',
  (subject, message) => {
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
        type: 'broadcast',
        result: 'error',
      });
      errorCounter.inc({
        type: 'registration',
        operation: 'broadcast_registration',
      });
    }
  }
);
natsSubscriptions.push(broadcastRegisterSubscription);

// Record subscription metric
natsSubscribeCounter.inc({ subject: 'broadcast.register' });

// Subscribe to admin requests for rate limit statistics
const adminRequestSub = nats.subscribe(
  'admin.request.router',
  (subject, message) => {
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
      }
    } catch (error) {
      log.error('Failed to process admin request', {
        producer: 'router',
        message: message.string(),
        error: error,
      });
    }
  }
);
natsSubscriptions.push(adminRequestSub);

// Record subscription metric
natsSubscribeCounter.inc({ subject: 'admin.request.router' });

// Subscribe to stats.uptime messages and respond with module uptime
const statsUptimeSub = nats.subscribe('stats.uptime', (subject, message) => {
  try {
    const data = JSON.parse(message.string());
    log.info('Received stats.uptime request', {
      producer: 'router',
      replyChannel: data.replyChannel,
    });

    // Calculate uptime in milliseconds
    const uptime = Date.now() - moduleStartTime;

    // Send uptime back via the ephemeral reply channel
    const uptimeResponse = {
      module: 'router',
      uptime: uptime,
      uptimeFormatted: `${Math.floor(uptime / 86400000)}d ${Math.floor((uptime % 86400000) / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`,
    };

    if (data.replyChannel) {
      void nats.publish(data.replyChannel, JSON.stringify(uptimeResponse));
    }
  } catch (error) {
    log.error('Failed to process stats.uptime request', {
      producer: 'router',
      error: error,
    });
  }
});
natsSubscriptions.push(statsUptimeSub);

// Record subscription metric
natsSubscribeCounter.inc({ subject: 'stats.uptime' });

// Ask all modules to publish their commands
void nats.publish('control.registerCommands', JSON.stringify({}));

// Ask all modules to publish their broadcasts
void nats.publish('control.registerBroadcasts', JSON.stringify({}));

/**
 * Setup HTTP API server
 */
function setupHttpServer() {
  const app: Application = express();
  const port = process.env.HTTP_API_PORT || '9001';

  // Middleware
  app.use(express.json());

  // API routes
  app.use('/api', apiRoutes);

  // Root endpoint
  app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
      message: 'eevee.bot Router API',
      timestamp: new Date().toISOString(),
    });
  });

  // Start server
  const server = app.listen(port, () => {
    log.info(`HTTP API server listening on port ${port}`);
  });

  // Handle server errors
  server.on('error', (err: Error) => {
    log.error('HTTP API server error', err);
  });
}
