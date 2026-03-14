import { NatsClient } from '@eeveebot/libeevee';
import { log } from '@eeveebot/libeevee';

export interface NotificationService {
  notifyUser(
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string,
    message: string
  ): Promise<void>;
}

export class PlatformNotifier implements NotificationService {
  private natsClient: InstanceType<typeof NatsClient> | null = null;

  constructor(natsClient?: InstanceType<typeof NatsClient>) {
    if (natsClient) {
      this.natsClient = natsClient;
    }
  }

  public setNatsClient(nats: InstanceType<typeof NatsClient>): void {
    this.natsClient = nats;
  }

  public async notifyUser(
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string,
    message: string
  ): Promise<void> {
    if (!this.natsClient) {
      log.warn('NATS client not available for sending notification', {
        producer: 'router',
        platform: platform,
        user: user,
      });
      return;
    }

    try {
      switch (platform) {
        case 'irc': {
          // Send IRC NOTICE to user
          const noticeMessage = {
            target: user,
            text: message,
          };

          await this.natsClient.publish(
            `chat.notice.outgoing.irc.${instance}`,
            JSON.stringify(noticeMessage)
          );

          log.info('Sent notice to user', {
            producer: 'router',
            platform: platform,
            user: user,
            instance: instance,
            message: message,
          });
          break;
        }

        // Case for other platforms can be added here
        default:
          log.debug('No notification handler for platform', {
            producer: 'router',
            platform: platform,
          });
          break;
      }
    } catch (error) {
      log.error('Failed to send notification', {
        producer: 'router',
        platform: platform,
        user: user,
        error: (error as Error).message,
      });
    }
  }
}
