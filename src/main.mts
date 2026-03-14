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
import { loadRouterConfig } from './lib/router-config.mjs';
import { RouterConfig } from './types/config.mjs';

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

interface MessageData {
  platform: string;
  network: string;
  instance: string;
  channel: string;
  user: string;
  text: string;
}

/**
 * Check if a message should be blocked based on the blocklist configuration
 * @param msgData The message data to check
 * @param config The router configuration
 * @returns true if the message should be blocked, false otherwise
 */
function shouldBlockMessage(
  msgData: MessageData,
  config: RouterConfig
): boolean {
  // If no blocklist is configured, don't block anything
  if (!config.blocklist || config.blocklist.length === 0) {
    return false;
  }

  // Check each blocklist entry
  for (const entry of config.blocklist) {
    // Skip disabled entries
    if (entry.enabled === false) {
      continue;
    }

    // Check if the entry applies to this message context
    // Platform check
    if (entry.platform) {
      try {
        const platformRegex = new RegExp(entry.platform);
        if (!platformRegex.test(msgData.platform)) {
          continue;
        }
      } catch (error) {
        // If regex is invalid, skip this entry
        log.warn('Invalid platform regex in blocklist entry', {
          producer: 'router',
          pattern: entry.platform,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // Network check
    if (entry.network) {
      try {
        const networkRegex = new RegExp(entry.network);
        if (!networkRegex.test(msgData.network)) {
          continue;
        }
      } catch (error) {
        // If regex is invalid, skip this entry
        log.warn('Invalid network regex in blocklist entry', {
          producer: 'router',
          pattern: entry.network,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // Instance check
    if (entry.instance) {
      try {
        const instanceRegex = new RegExp(entry.instance);
        if (!instanceRegex.test(msgData.instance)) {
          continue;
        }
      } catch (error) {
        // If regex is invalid, skip this entry
        log.warn('Invalid instance regex in blocklist entry', {
          producer: 'router',
          pattern: entry.instance,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // Channel check
    if (entry.channel) {
      try {
        const channelRegex = new RegExp(entry.channel);
        if (!channelRegex.test(msgData.channel)) {
          continue;
        }
      } catch (error) {
        // If regex is invalid, skip this entry
        log.warn('Invalid channel regex in blocklist entry', {
          producer: 'router',
          pattern: entry.channel,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // User check
    if (entry.user) {
      try {
        const userRegex = new RegExp(entry.user);
        if (!userRegex.test(msgData.user)) {
          continue;
        }
      } catch (error) {
        // If regex is invalid, skip this entry
        log.warn('Invalid user regex in blocklist entry', {
          producer: 'router',
          pattern: entry.user,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // Check if the message text matches the blocklist pattern
    try {
      const patternRegex = new RegExp(entry.pattern);
      if (patternRegex.test(msgData.text)) {
        log.info('Blocked message due to blocklist match', {
          producer: 'router',
          pattern: entry.pattern,
          text: msgData.text,
          platform: msgData.platform,
          network: msgData.network,
          instance: msgData.instance,
          channel: msgData.channel,
          user: msgData.user,
        });
        return true;
      }
    } catch (error) {
      // If regex is invalid, log warning but don't block the message
      log.warn('Invalid pattern regex in blocklist entry', {
        producer: 'router',
        pattern: entry.pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // No blocklist entries matched
  return false;
}

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

// Load router configuration
let routerConfig: RouterConfig;
try {
  routerConfig = await loadRouterConfig();
  log.info('Router module initialized successfully with config', {
    producer: 'router',
    hasBlocklist: !!routerConfig.blocklist,
    blocklistCount: routerConfig.blocklist?.length || 0,
  });
} catch (error) {
  log.error('Failed to initialize router module config', {
    producer: 'router',
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}

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

      // Check if message should be blocked based on blocklist
      if (shouldBlockMessage(msgData, routerConfig)) {
        log.info('Dropped message due to blocklist match', {
          producer: 'router',
          platform: msgData.platform,
          network: msgData.network,
          channel: msgData.channel,
          user: msgData.user,
        });

        // Increment message counter for blocked messages
        messageCounter.inc({
          platform: msgData.platform,
          network: msgData.network,
          result: 'blocked',
        });

        return;
      }

      // Increment message counter for processed messages
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
        msgData.commonPrefixRegex,
        msgData.botNick
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

        // Check for platform prefix first
        if (command.platformPrefixAllowed && msgData.commonPrefixRegex) {
          try {
            const prefixRegex = new RegExp(msgData.commonPrefixRegex);
            const prefixMatch = msgData.text.match(prefixRegex);
            if (prefixMatch) {
              // Extract the matched prefix
              const matchedPrefix = prefixMatch[0];
              // Remove the prefix from the command text
              const textWithoutPrefix = msgData.text
                .slice(prefixMatch[0].length)
                .trimStart();

              // Now use the command regex to match the actual command and extract args
              const commandMatch = textWithoutPrefix.match(
                command.commandRegex
              );
              if (commandMatch) {
                // Update matchedCommand with the actual command that was matched plus the prefix
                matchedCommand = matchedPrefix + commandMatch[0];
                // Remove the matched command (prefix + command) from the original text, leaving only args
                const textAfterCommand = msgData.text
                  .slice(matchedCommand.length)
                  .trimStart();
                // Update processedText with the remaining text (args)
                processedText = textAfterCommand;
              } else {
                // If command doesn't match, use the text without prefix
                processedText = textWithoutPrefix;
                // Set matchedCommand to just the prefix since no command matched
                matchedCommand = matchedPrefix;
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
        // Check for nick prefix if platform prefix wasn't matched
        else if (command.nickPrefixAllowed && msgData.botNick) {
          // Create a regex pattern to match the bot's nick followed by common separators
          const nickPrefixPattern = new RegExp(
            `^${msgData.botNick}[:;, ]+`,
            'i'
          );
          const nickMatch = msgData.text.match(nickPrefixPattern);
          if (nickMatch) {
            // Extract the matched nick prefix
            const matchedNickPrefix = nickMatch[0];
            // Remove the nick prefix from the command text
            const textWithoutNickPrefix = msgData.text
              .slice(nickMatch[0].length)
              .trimStart();

            // Now use the command regex to match the actual command and extract args
            const commandMatch = textWithoutNickPrefix.match(
              command.commandRegex
            );
            if (commandMatch) {
              // Update matchedCommand with the actual command that was matched plus the nick prefix
              matchedCommand = matchedNickPrefix + commandMatch[0];
              // Remove the matched command (nick prefix + command) from the original text, leaving only args
              const textAfterCommand = msgData.text
                .slice(matchedCommand.length)
                .trimStart();
              // Update processedText with the remaining text (args)
              processedText = textAfterCommand;
            } else {
              // If command doesn't match, use the text without nick prefix
              processedText = textWithoutNickPrefix;
              // Set matchedCommand to just the nick prefix since no command matched
              matchedCommand = matchedNickPrefix;
            }
          } else {
            // If no nick prefix is used, check if the command regex matches the full text
            const commandMatch = msgData.text.match(command.commandRegex);
            if (commandMatch) {
              matchedCommand = commandMatch[0];
              // Remove the matched command from the text, leaving only args
              const textAfterCommand = msgData.text
                .slice(commandMatch[0].length)
                .trimStart();
              // Update processedText with the remaining text (args)
              processedText = textAfterCommand;
            }
          }
        } else {
          // If no prefix is used, check if the command regex matches the full text
          const commandMatch = msgData.text.match(command.commandRegex);
          if (commandMatch) {
            matchedCommand = commandMatch[0];
            // Remove the matched command from the text, leaving only args
            const textAfterCommand = msgData.text
              .slice(commandMatch[0].length)
              .trimStart();
            // Update processedText with the remaining text (args)
            processedText = textAfterCommand;
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
