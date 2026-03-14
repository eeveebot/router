import { log } from '@eeveebot/libeevee';
import { CommandRegistry } from './command-registry.mjs';
import { BroadcastRegistry } from './broadcast-registry.mjs';
import { RateLimiter } from './rate-limiter.mjs';
import { RouterConfig } from '../types/config.mjs';
import {
  messageCounter,
  messageProcessingTime,
  commandCounter,
  commandProcessingTime,
  broadcastCounter,
  rateLimitCounter,
  natsPublishCounter,
} from './metrics/index.mjs';

interface MessageData {
  platform: string;
  network: string;
  instance: string;
  channel: string;
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
      // Process the command text to extract args
      // Since we already know this command matches from the registry, we just need to extract the args
      let processedText = msgData.text;
      let matchedCommand = '';

      // Find the command match in the original text to properly extract args
      const commandMatch = msgData.text.match(command.commandRegex);
      if (commandMatch) {
        matchedCommand = commandMatch[0];
        // Remove the matched command from the text, leaving only args
        const textAfterCommand = msgData.text
          .slice((commandMatch.index || 0) + commandMatch[0].length)
          .trimStart();
        // Update processedText with the remaining text (args)
        processedText = textAfterCommand;
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
  } finally {
    // Record message processing time
    messageTimer();
  }
}
