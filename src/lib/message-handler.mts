import { log } from '@eeveebot/libeevee';
import { CommandRegistry } from './command-registry.mjs';
import { BroadcastRegistry } from './broadcast-registry.mjs';
import { RateLimiter } from './rate-limiter.mjs';
import { RouterConfig } from '../types/config.mjs';
import { broadcastCounter, rateLimitCounter } from './metrics/index.mjs';
import {
  messageCounter,
  messageProcessingTime,
  commandCounter,
  commandProcessingTime,
  natsPublishCounter,
} from '@eeveebot/libeevee';

interface MessageData {
  platform: string;
  network: string;
  instance: string;
  channel: string;
  nick: string;
  user: string;
  userHost?: string;
  text: string;
  timestamp: number;
  commonPrefixRegex?: string;
  botNick?: string;
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

  // Check each blocklist entry (regexes are pre-compiled at config load time)
  for (const entry of config.blocklist) {
    // Skip disabled entries
    if (entry.enabled === false) {
      continue;
    }

    // Check if the entry applies to this message context
    if (entry.platform && !entry.platform.test(msgData.platform)) {
      continue;
    }

    if (entry.network && !entry.network.test(msgData.network)) {
      continue;
    }

    if (entry.instance && !entry.instance.test(msgData.instance)) {
      continue;
    }

    if (entry.channel && !entry.channel.test(msgData.channel)) {
      continue;
    }

    if (entry.user && !entry.user.test(msgData.user)) {
      continue;
    }

    // Check if the message text matches the blocklist pattern
    if (entry.pattern.test(msgData.text)) {
      log.info('Blocked message due to blocklist match', {
        producer: 'router',
        platform: msgData.platform,
        network: msgData.network,
        instance: msgData.instance,
        channel: msgData.channel,
        user: msgData.user,
      });
      return true;
    }
  }

  // No blocklist entries matched
  return false;
}

/**
 * Handle incoming chat messages
 * @param subject The NATS subject
 * @param message The message content
 * @param nats The NATS client instance
 * @param commandRegistry The command registry
 * @param broadcastRegistry The broadcast registry
 * @param rateLimiter The rate limiter
 * @param routerConfig The router configuration
 */
export function handleChatMessage(
  subject: string,
  message: { string: () => string },
  nats: { publish: (subject: string, data: string) => Promise<boolean> },
  commandRegistry: CommandRegistry,
  broadcastRegistry: BroadcastRegistry,
  rateLimiter: RateLimiter,
  routerConfig: RouterConfig
): void {
  const messageTimer = messageProcessingTime.startTimer();
  try {
    const msgData: MessageData = JSON.parse(message.string());
    log.info('Received chat message', {
      producer: 'router',
      subject: subject,
      platform: msgData.platform,
      network: msgData.network,
      channel: msgData.channel,
      user: msgData.user,
    });
    log.debug('Received chat message text', {
      producer: 'router',
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
        module: 'router',
        direction: 'incoming',
        result: 'blocked',
      });

      return;
    }

    // Check if this message matches any registered commands
    const matchingCommands = commandRegistry.findMatchingCommands(
      msgData.platform,
      msgData.network,
      msgData.instance,
      msgData.channel,
      msgData.user,
      msgData.nick,
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
      msgData.nick,
      msgData.text
    );

    // If no commands or broadcasts match, drop the message
    if (matchingCommands.length === 0 && matchingBroadcasts.length === 0) {
      log.info('Dropped message with no matching commands or broadcasts', {
        producer: 'router',
        platform: msgData.platform,
        network: msgData.network,
        channel: msgData.channel,
        user: msgData.user,
      });

      // Increment message counter for dropped messages
      messageCounter.inc({
        module: 'router',
        direction: 'incoming',
        result: 'dropped',
      });

      return;
    }

    // Increment message counter for processed messages
    messageCounter.inc({
      module: 'router',
      direction: 'incoming',
      result: 'processed',
    });

    // For each matching command, check rate limits and publish command execution message
    matchingCommands.forEach(
      ({ command, matchedText, argsText, matchedCommand }) => {
        // Use the pre-processed text and args from the command registry
        const processedText = argsText;
        const textToMatch = matchedText;

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
              module: 'router',
              command_uuid: command.commandUUID,
              action: 'dropped',
              mode: command.ratelimit.mode,
            });
            commandCounter.inc({
              module: 'router',
              result: 'rate_limited_dropped',
            });
            return;
          } else if (command.ratelimit.mode === 'enqueue') {
            // Enqueue the command for later execution
            rateLimitCounter.inc({
              module: 'router',
              command_uuid: command.commandUUID,
              action: 'enqueued',
              mode: command.ratelimit.mode,
            });
            commandCounter.inc({
              module: 'router',
              result: 'rate_limited_enqueued',
            });
            const commandSubject = `command.execute.${command.commandUUID}`;
            rateLimiter.enqueueCommand(
              command.commandUUID,
              msgData.platform,
              msgData.network,
              msgData.instance,
              msgData.channel,
              msgData.user,
              msgData.userHost || '',
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
          nick: msgData.nick,
          userHost: msgData.userHost,
          text: processedText,
          originalText: msgData.text,
          matchedCommand: matchedCommand,
          matchedText: textToMatch, // The text that was actually matched against the command regex
          timestamp: msgData.timestamp,
          botNick: msgData.botNick,
        };

        // Start command processing timer
        const commandTimer = commandProcessingTime.startTimer({
          module: 'router',
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
          module: 'router',
          result: 'success',
        });
        natsPublishCounter.inc({ module: 'router', type: 'command' });
        commandTimer();
      }
    );

    // For each matching broadcast, publish the message to the broadcast channel
    matchingBroadcasts.forEach((broadcast) => {
      const broadcastSubject = `broadcast.message.${broadcast.broadcastUUID}`;
      const broadcastMessage = {
        platform: msgData.platform,
        network: msgData.network,
        instance: msgData.instance,
        channel: msgData.channel,
        user: msgData.user,
        nick: msgData.nick,
        userHost: msgData.userHost,
        text: msgData.text,
        timestamp: msgData.timestamp,
        botNick: msgData.botNick,
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
        module: 'router',
        broadcast_uuid: broadcast.broadcastUUID,
        platform: msgData.platform,
        network: msgData.network,
        channel: msgData.channel,
      });
      natsPublishCounter.inc({ module: 'router', type: 'broadcast' });
    });
  } catch (err: unknown) {
    const error = err as Error;
    log.error('Failed to parse chat message', {
      producer: 'router',
      subject: subject,
      errorMessage: error.message,
    });

    // Increment error counter
    messageCounter.inc({
      module: 'router',
      direction: 'incoming',
      result: 'error',
    });
  } finally {
    // Record message processing time
    messageTimer();
  }
}
