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
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
});

process.on('SIGTERM', () => {
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
      log.info(
        `Received chat message from ${msgData.user} in ${msgData.channel}: ${msgData.text}`,
        {
          producer: 'router',
          subject: subject,
          platform: msgData.platform,
          network: msgData.network,
          channel: msgData.channel,
          user: msgData.user,
          text: msgData.text,
        }
      );

      // Check if this message matches any registered commands
      const matchingCommands = commandRegistry.findMatchingCommands(
        msgData.platform,
        msgData.network,
        msgData.instance,
        msgData.channel,
        msgData.user,
        msgData.text
      );

      // For each matching command, publish a command execution message
      matchingCommands.forEach((command) => {
        const commandSubject = `command.execute.${command.commandUUID}`;
        const commandMessage = {
          platform: msgData.platform,
          network: msgData.network,
          instance: msgData.instance,
          channel: msgData.channel,
          user: msgData.user,
          text: msgData.text,
          timestamp: msgData.timestamp,
        };

        void nats.publish(commandSubject, JSON.stringify(commandMessage));
        log.info(`Published command execution for ${command.commandUUID}`, {
          producer: 'router',
          commandUUID: command.commandUUID,
          subject: commandSubject,
        });
      });
    } catch (err: unknown) {
      const error = err as Error;
      log.error(`Failed to parse chat message: ${error.message}`, {
        producer: 'router',
        subject: subject,
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
      log.info(
        `Processed command registration for ${registrationData.commandUUID}`,
        {
          producer: 'router',
          commandUUID: registrationData.commandUUID,
        }
      );
    } catch (err: unknown) {
      const error = err as Error;
      log.error(`Failed to process command registration: ${error.message}`, {
        producer: 'router',
        subject: subject,
        rawMessage: message.string(),
      });
    }
  }
);
natsSubscriptions.push(commandRegisterSubscription);
