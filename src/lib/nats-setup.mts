import { NatsClient, log } from '@eeveebot/libeevee';

/**
 * Setup NATS connection
 * @returns Promise resolving to the connected NatsClient instance
 */
export async function setupNatsConnection(): Promise<
  InstanceType<typeof NatsClient>
> {
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

  await nats.connect();

  log.info('NATS connection established', {
    producer: 'router',
    natsHost: natsHost as string,
  });

  return nats;
}
