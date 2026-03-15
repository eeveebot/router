import { 
  messageCounter,
  messageProcessingTime,
  commandCounter,
  commandProcessingTime,
  natsPublishCounter,
  natsSubscribeCounter,
  errorCounter,
  initializeSystemMetrics,
  register
} from '@eeveebot/libeevee';

// Additional router-specific metrics that aren't in libeevee
import { Counter } from 'prom-client';

// Broadcast metrics
export const broadcastCounter = new Counter({
  name: 'broadcasts_total',
  help: 'Total number of broadcasts processed',
  labelNames: ['module', 'broadcast_uuid', 'platform', 'network', 'channel'],
});

// Registration metrics
export const registrationCounter = new Counter({
  name: 'registrations_total',
  help: 'Total number of registrations processed',
  labelNames: ['module', 'type', 'result'],
});

// Rate limiting metrics
export const rateLimitCounter = new Counter({
  name: 'rate_limits_total',
  help: 'Total number of rate limit events',
  labelNames: ['module', 'command_uuid', 'action', 'mode'],
});

// Export common metrics from libeevee
export { 
  messageCounter,
  messageProcessingTime,
  commandCounter,
  commandProcessingTime,
  natsPublishCounter,
  natsSubscribeCounter,
  errorCounter,
  initializeSystemMetrics,
  register
};
