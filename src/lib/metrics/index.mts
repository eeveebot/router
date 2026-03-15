import { Counter, Gauge, Histogram } from 'prom-client';

// Message processing metrics
export const messageCounter = new Counter({
  name: 'messages_total',
  help: 'Total number of messages processed',
  labelNames: ['module', 'platform', 'network', 'result'],
});

export const messageProcessingTime = new Histogram({
  name: 'message_processing_seconds',
  help: 'Time spent processing messages',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Command metrics
export const commandCounter = new Counter({
  name: 'commands_total',
  help: 'Total number of commands processed',
  labelNames: [
    'module',
    'command_uuid',
    'platform',
    'network',
    'channel',
    'rate_limit_action',
  ],
});

export const commandProcessingTime = new Histogram({
  name: 'command_processing_seconds',
  help: 'Time spent processing individual commands',
  labelNames: ['module', 'command_uuid'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

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

// NATS metrics
export const natsPublishCounter = new Counter({
  name: 'nats_publish_total',
  help: 'Total number of NATS messages published',
  labelNames: ['module', 'type'],
});

export const natsSubscribeCounter = new Counter({
  name: 'nats_subscribe_total',
  help: 'Total number of NATS subscriptions',
  labelNames: ['module', 'subject'],
});

// Error metrics
export const errorCounter = new Counter({
  name: 'errors_total',
  help: 'Total number of errors encountered',
  labelNames: ['module', 'type', 'operation'],
});

// System metrics
export const uptimeGauge = new Gauge({
  name: 'uptime_seconds',
  help: 'Service uptime in seconds',
  labelNames: ['module'],
});

export const memoryUsageGauge = new Gauge({
  name: 'memory_usage_bytes',
  help: 'Service memory usage in bytes',
  labelNames: ['module', 'type'],
});

// Initialize system metrics
export function initializeSystemMetrics(): void {
  // Update uptime gauge periodically
  setInterval(() => {
    uptimeGauge.set({ module: 'router' }, process.uptime());
  }, 10000); // Update every 10 seconds

  // Update memory usage periodically
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    memoryUsageGauge.set({ module: 'router', type: 'heap_used' }, memoryUsage.heapUsed);
    memoryUsageGauge.set({ module: 'router', type: 'heap_total' }, memoryUsage.heapTotal);
    memoryUsageGauge.set({ module: 'router', type: 'rss' }, memoryUsage.rss);
    memoryUsageGauge.set({ module: 'router', type: 'external' }, memoryUsage.external);
  }, 10000); // Update every 10 seconds
}
