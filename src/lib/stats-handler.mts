import { log, register, formatUptime } from '@eeveebot/libeevee';
import fs from 'node:fs';

// Record module startup time for uptime tracking
const moduleStartTime = Date.now();
const moduleVersion = JSON.parse(fs.readFileSync(new URL('package.json', 'file://' + process.cwd() + '/'), 'utf8')).version as string;

/**
 * Handle stats emit requests
 * @param subject The NATS subject
 * @param message The message content
 * @param nats The NATS client instance
 */
export async function handleStatsEmitRequest(
  subject: string,
  message: { string: () => string },
  nats: { publish: (subject: string, data: string) => Promise<boolean> }
): Promise<void> {
  try {
    const data = JSON.parse(message.string());
    log.info('Received stats.emit.request', {
      producer: 'router',
      replyChannel: data.replyChannel,
    });

    // Calculate uptime in milliseconds
    const uptime = Date.now() - moduleStartTime;

    // Get all prom-client metrics
    const prometheusMetrics = await register.metrics();

    // Get memory usage information
    const memoryUsage = process.memoryUsage();
    
    // Send stats back via the ephemeral reply channel
    const statsResponse = {
      module: 'router',
      stats: {
        version: moduleVersion,
        uptime_seconds: Math.floor(uptime / 1000),
        uptime_formatted: formatUptime(uptime),
        memory_rss_mb: Math.round(memoryUsage.rss / (1024 * 1024)),
        memory_heap_used_mb: Math.round(memoryUsage.heapUsed / (1024 * 1024)),
        prometheus_metrics: prometheusMetrics,
      },
    };

    if (data.replyChannel) {
      void nats.publish(data.replyChannel, JSON.stringify(statsResponse));
    }
  } catch (error) {
    log.error('Failed to process stats.emit.request', {
      producer: 'router',
      error: error,
    });
  }
}

/**
 * Handle stats uptime requests
 * @param subject The NATS subject
 * @param message The message content
 * @param nats The NATS client instance
 */
export function handleStatsUptimeRequest(
  subject: string,
  message: { string: () => string },
  nats: { publish: (subject: string, data: string) => Promise<boolean> }
): void {
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
      version: moduleVersion,
      uptime: uptime,
      uptimeFormatted: formatUptime(uptime),
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
}
