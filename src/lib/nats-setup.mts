import { NatsClient, log } from '@eeveebot/libeevee';

/**
 * Setup NATS connection
 * @returns Promise resolving to the connected NatsClient instance
 */
export async function setupNatsConnection(): Promise<
  InstanceType<typeof NatsClient>
> {
  // Get host and token
  const natsHost = process.env.NATS_HOST;
  if (!natsHost) {
    const msg = 'environment variable NATS_HOST is not set.';
    throw new Error(msg);
  }

  const natsToken = process.env.NATS_TOKEN;
  if (!natsToken) {
    const msg = 'environment variable NATS_TOKEN is not set.';
    throw new Error(msg);
  }

  const nats = new NatsClient({
    natsHost,
    natsToken,
  });

  await nats.connect();

  log.info('NATS connection established', {
    producer: 'router',
    natsHost,
  });

  return nats;
}
