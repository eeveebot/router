'use strict';

// Router module
// List for messages and routes them appropriately
// Also handles command registration

import { NatsClient, log } from '@eeveebot/libeevee';
import { CommandRegistry } from './lib/command-registry.mjs';
import { RateLimiter } from './lib/rate-limiter.mjs';
import { BroadcastRegistry } from './lib/broadcast-registry.mjs';
import { loadRouterConfig } from './lib/router-config.mjs';
import { RouterConfig } from './types/config.mjs';

// Component imports
import { setupNatsConnection } from './lib/nats-setup.mjs';
import { handleChatMessage } from './lib/message-handler.mjs';
import {
  handleCommandRegistration,
  handleBroadcastRegistration,
} from './lib/registration-handler.mjs';
import { handleAdminRequest } from './lib/admin-handler.mjs';
import {
  handleStatsEmitRequest,
  handleStatsUptimeRequest,
} from './lib/stats-handler.mjs';
import { setupHttpServer } from './lib/http-server.mjs';

// Metrics imports
import {
  initializeSystemMetrics,
  natsSubscribeCounter,
} from './lib/metrics/index.mjs';

const natsClients: InstanceType<typeof NatsClient>[] = [];
const natsSubscriptions: Array<Promise<string | boolean>> = [];

// Setup NATS connection
const nats = await setupNatsConnection();
natsClients.push(nats);

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
    handleChatMessage(
      subject,
      message,
      nats,
      commandRegistry,
      broadcastRegistry,
      rateLimiter,
      routerConfig
    );
  }
);
natsSubscriptions.push(chatMessageSubscription);

// Record subscription metric
natsSubscribeCounter.inc({ module: 'router', subject: 'chat.message.incoming.>' });

// Subscribe to command.register messages
const commandRegisterSubscription = nats.subscribe(
  'command.register',
  (subject, message) => {
    handleCommandRegistration(subject, message, commandRegistry);
  }
);
natsSubscriptions.push(commandRegisterSubscription);

// Record subscription metric
natsSubscribeCounter.inc({ module: 'router', subject: 'command.register' });

// Subscribe to broadcast.register messages
const broadcastRegisterSubscription = nats.subscribe(
  'broadcast.register',
  (subject, message) => {
    handleBroadcastRegistration(subject, message, broadcastRegistry);
  }
);
natsSubscriptions.push(broadcastRegisterSubscription);

// Record subscription metric
natsSubscribeCounter.inc({ module: 'router', subject: 'broadcast.register' });

// Subscribe to admin requests for rate limit statistics
const adminRequestSub = nats.subscribe(
  'admin.request.router',
  (subject, message) => {
    handleAdminRequest(subject, message, nats, commandRegistry, rateLimiter);
  }
);
natsSubscriptions.push(adminRequestSub);

// Record subscription metric
natsSubscribeCounter.inc({ module: 'router', subject: 'admin.request.router' });

// Subscribe to stats.emit.request messages and respond with module stats
const statsEmitRequestSub = nats.subscribe(
  'stats.emit.request',
  (subject, message) => {
    void handleStatsEmitRequest(subject, message, nats);
  }
);

// Subscribe to stats.uptime messages and respond with module uptime
const statsUptimeSub = nats.subscribe('stats.uptime', (subject, message) => {
  handleStatsUptimeRequest(subject, message, nats);
});
natsSubscriptions.push(statsEmitRequestSub, statsUptimeSub);

// Record subscription metrics
natsSubscribeCounter.inc({ module: 'router', subject: 'stats.emit.request' });
natsSubscribeCounter.inc({ module: 'router', subject: 'stats.uptime' });

// Ask all modules to publish their commands
void nats.publish('control.registerCommands', JSON.stringify({}));

// Ask all modules to publish their broadcasts
void nats.publish('control.registerBroadcasts', JSON.stringify({}));
