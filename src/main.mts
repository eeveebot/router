'use strict';

// Router module
// List for messages and routes them appropriately
// Also handles command registration

import { NatsClient, log } from '@eeveebot/libeevee';
import { CommandRegistry } from './lib/command-registry.mjs';
import { CommandRegistration } from './types/command.mjs';

const natsClients: InstanceType<typeof NatsClient>[] = [];
const natsSubscriptions: Array<Promise<string | boolean>> = [];
const commandRegistry = new CommandRegistry();

//
// Do whatever teardown is necessary before calling common handler
process.on('SIGINT', () => {
  commandRegistry.destroy();
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
});

process.on('SIGTERM', () => {
  commandRegistry.destroy();
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
});

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

// Subscribe to chat.message.incoming.* messages
const chatMessageSubscription = nats.subscribe(
  'chat.message.incoming.>',
  (subject, message) => {
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

      // For each matching command, publish a command execution message
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

        const commandSubject = `command.execute.${command.commandUUID}`;
        const commandMessage = {
          platform: msgData.platform,
          network: msgData.network,
          instance: msgData.instance,
          channel: msgData.channel,
          user: msgData.user,
          text: processedText,
          originalText: msgData.text,
          matchedCommand: matchedCommand,
          timestamp: msgData.timestamp,
        };

        void nats.publish(commandSubject, JSON.stringify(commandMessage));
        log.info('Published command execution', {
          producer: 'router',
          commandUUID: command.commandUUID,
          user: msgData.user,
          subject: commandSubject,
          originalText: msgData.text,
          matchedCommand: matchedCommand,
        });
      });
    } catch (err: unknown) {
      const error = err as Error;
      log.error('Failed to parse chat message', {
        producer: 'router',
        subject: subject,
        errorMessage: error.message,
        rawMessage: message.string(),
      });
    }
  }
);
natsSubscriptions.push(chatMessageSubscription);

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
    } catch (err: unknown) {
      const error = err as Error;
      log.error('Failed to process command registration', {
        producer: 'router',
        subject: subject,
        errorMessage: error.message,
        rawMessage: message.string(),
      });
    }
  }
);
natsSubscriptions.push(commandRegisterSubscription);

// Ask all modules to publish their commands
void nats.publish('control.registercommands', JSON.stringify({}));
