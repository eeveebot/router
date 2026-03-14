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
      // Process the command text to strip prefix if needed and extract matched command
      let processedText = msgData.text;
      let matchedCommand = '';

      // Process prefixes in sequence - both can be applied
      let processedTextForMatching = msgData.text;
      let prefixText = '';

      // Apply platform prefix if allowed
      if (command.platformPrefixAllowed && msgData.commonPrefixRegex) {
        try {
          const prefixRegex = new RegExp(msgData.commonPrefixRegex);
          const prefixMatch = processedTextForMatching.match(prefixRegex);
          if (prefixMatch) {
            // Extract the matched prefix
            const matchedPrefix = prefixMatch[0];
            // Remove the prefix from the command text
            processedTextForMatching = processedTextForMatching
              .slice(prefixMatch[0].length)
              .trimStart();
            prefixText += matchedPrefix;
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

      // Apply nick prefix if allowed (can work in combination with platform prefix)
      if (command.nickPrefixAllowed && msgData.botNick) {
        // Create a regex pattern to match the bot's nick followed by common separators
        const nickPrefixPattern = new RegExp(`^${msgData.botNick}[:;, ]+`, 'i');
        const nickMatch = processedTextForMatching.match(nickPrefixPattern);
        if (nickMatch) {
          // Extract the matched nick prefix
          const matchedNickPrefix = nickMatch[0];
          // Remove the nick prefix from the command text
          processedTextForMatching = processedTextForMatching
            .slice(nickMatch[0].length)
            .trimStart();
          prefixText += matchedNickPrefix;
        }
      }

      // Now use the command regex to match the actual command and extract args
      const commandMatch = processedTextForMatching.match(command.commandRegex);
      if (commandMatch) {
        // Update matchedCommand with the actual command that was matched plus the prefixes
        matchedCommand = prefixText + commandMatch[0];
        // Remove the matched command (prefixes + command) from the original text, leaving only args
        const textAfterCommand = msgData.text
          .slice(matchedCommand.length)
          .trimStart();
        // Update processedText with the remaining text (args)
        processedText = textAfterCommand;
      } else if (prefixText) {
        // If prefixes were matched but command didn't match, use the text without prefixes
        processedText = processedTextForMatching;
        // Set matchedCommand to just the prefixes since no command matched
        matchedCommand = prefixText;
      } else {
        // If no prefixes were used, check if the command regex matches the full text
        const directCommandMatch = msgData.text.match(command.commandRegex);
        if (directCommandMatch) {
          matchedCommand = directCommandMatch[0];
          // Remove the matched command from the text, leaving only args
          const textAfterCommand = msgData.text
            .slice(
              (directCommandMatch.index || 0) + directCommandMatch[0].length
            )
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
