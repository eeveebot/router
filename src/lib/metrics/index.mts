import { Counter, Gauge, Histogram } from 'prom-client';

// Message processing metrics
export const messageCounter = new Counter({
  name: 'router_messages_total',
  help: 'Total number of messages received by the router',
  labelNames: ['platform', 'network', 'result'],
});

export const messageProcessingTime = new Histogram({
  name: 'router_message_processing_seconds',
  help: 'Time spent processing messages',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Command metrics
export const commandCounter = new Counter({
  name: 'router_commands_total',
  help: 'Total number of commands processed',
  labelNames: ['command_uuid', 'platform', 'network', 'channel', 'rate_limit_action'],
});

export const commandProcessingTime = new Histogram({
  name: 'router_command_processing_seconds',
  help: 'Time spent processing individual commands',
  labelNames: ['command_uuid'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

// Broadcast metrics
export const broadcastCounter = new Counter({
  name: 'router_broadcasts_total',
  help: 'Total number of broadcasts processed',
  labelNames: ['broadcast_uuid', 'platform', 'network', 'channel'],
});

// Registration metrics
export const registrationCounter = new Counter({
  name: 'router_registrations_total',
  help: 'Total number of registrations processed',
  labelNames: ['type', 'result'],
});

// Rate limiting metrics
export const rateLimitCounter = new Counter({
  name: 'router_rate_limits_total',
  help: 'Total number of rate limit events',
  labelNames: ['command_uuid', 'action', 'mode'],
});

// NATS metrics
export const natsPublishCounter = new Counter({
  name: 'router_nats_publish_total',
  help: 'Total number of NATS messages published',
  labelNames: ['type'],
});

export const natsSubscribeCounter = new Counter({
  name: 'router_nats_subscribe_total',
  help: 'Total number of NATS subscriptions',
  labelNames: ['subject'],
});

// Error metrics
export const errorCounter = new Counter({
  name: 'router_errors_total',
  help: 'Total number of errors encountered',
  labelNames: ['type', 'operation'],
});

// System metrics
export const uptimeGauge = new Gauge({
  name: 'router_uptime_seconds',
  help: 'Router uptime in seconds',
});

export const memoryUsageGauge = new Gauge({
  name: 'router_memory_usage_bytes',
  help: 'Router memory usage in bytes',
  labelNames: ['type'],
});

// Initialize system metrics
export function initializeSystemMetrics(): void {
  // Update uptime gauge periodically
  setInterval(() => {
    uptimeGauge.set(process.uptime());
  }, 10000); // Update every 10 seconds

  // Update memory usage periodically
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    memoryUsageGauge.set({ type: 'heap_used' }, memoryUsage.heapUsed);
    memoryUsageGauge.set({ type: 'heap_total' }, memoryUsage.heapTotal);
    memoryUsageGauge.set({ type: 'rss' }, memoryUsage.rss);
    memoryUsageGauge.set({ type: 'external' }, memoryUsage.external);
  }, 10000); // Update every 10 seconds
}