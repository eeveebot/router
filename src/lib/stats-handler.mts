import { log } from '@eeveebot/libeevee';
import { register } from 'prom-client';

// Record module startup time for uptime tracking
const moduleStartTime = Date.now();

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

    // Send stats back via the ephemeral reply channel
    const statsResponse = {
      module: 'router',
      stats: {
        uptime_seconds: Math.floor(uptime / 1000),
        uptime_formatted: `${Math.floor(uptime / 86400000)}d ${Math.floor((uptime % 86400000) / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`,
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
      uptime: uptime,
      uptimeFormatted: `${Math.floor(uptime / 86400000)}d ${Math.floor((uptime % 86400000) / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`,
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
