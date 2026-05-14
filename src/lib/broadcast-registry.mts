import { NatsClient, log } from '@eeveebot/libeevee';
import {
  BroadcastRegistration,
  RegisteredBroadcast,
} from '../types/broadcast.mjs';
import { compileRegex } from './compile-regex.mjs';

export class BroadcastRegistry {
  private broadcasts: Map<string, RegisteredBroadcast> = new Map();
  private natsClient: InstanceType<typeof NatsClient> | null = null;

  constructor(natsClient?: InstanceType<typeof NatsClient>) {
    this.natsClient = natsClient || null;
  }

  // Cleanup-like method to clean up resources
  public destroy(): void {
    this.broadcasts.clear();
  }

  /**
   * Prompt modules to re-register a specific broadcast
   */
  public promptReRegistration(broadcastUUID: string): void {
    const broadcast = this.broadcasts.get(broadcastUUID);
    if (!broadcast || !this.natsClient) {
      return;
    }

    // Emit to the general re-registration channel
    void this.natsClient.publish(
      'control.registerBroadcasts',
      JSON.stringify({})
    );

    // Emit to the broadcast-specific re-registration channel if displayName exists
    if (broadcast.broadcastDisplayName) {
      const subject = `control.registerBroadcasts.${broadcast.broadcastDisplayName}`;
      void this.natsClient.publish(
        subject,
        JSON.stringify({
          broadcastUUID: broadcast.broadcastUUID,
          broadcastDisplayName: broadcast.broadcastDisplayName,
        })
      );
    }

    log.debug('Prompted re-registration for broadcast', {
      producer: 'router',
      broadcastUUID: broadcast.broadcastUUID,
      broadcastDisplayName: broadcast.broadcastDisplayName,
    });
  }

  registerBroadcast(registration: BroadcastRegistration): void {
    const ctx = `broadcast ${registration.broadcastDisplayName ?? registration.broadcastUUID}`;

    const registeredBroadcast: RegisteredBroadcast = {
      broadcastUUID: registration.broadcastUUID,
      broadcastDisplayName: registration.broadcastDisplayName,
      platformRegex: compileRegex(registration.platform || '.*', `${ctx} platform`),
      networkRegex: compileRegex(registration.network || '.*', `${ctx} network`),
      instanceRegex: compileRegex(registration.instance || '.*', `${ctx} instance`),
      channelRegex: compileRegex(registration.channel || '.*', `${ctx} channel`),
      userRegex: compileRegex(registration.user || '.*', `${ctx} user`),
      nickRegex: compileRegex(registration.nick || '.*', `${ctx} nick`),
      messageFilterRegex: registration.messageFilterRegex
        ? compileRegex(registration.messageFilterRegex, `${ctx} messageFilter`)
        : undefined,
    };

    this.broadcasts.set(registration.broadcastUUID, registeredBroadcast);

    log.info('Registered broadcast', {
      producer: 'router',
      broadcastUUID: registration.broadcastUUID,
      broadcastDisplayName: registration.broadcastDisplayName,
    });
  }

  unregisterBroadcast(broadcastUUID: string): boolean {
    const result = this.broadcasts.delete(broadcastUUID);

    if (result) {
      log.info('Unregistered broadcast', {
        producer: 'router',
        broadcastUUID: broadcastUUID,
      });
    }
    return result;
  }

  getBroadcast(broadcastUUID: string): RegisteredBroadcast | undefined {
    return this.broadcasts.get(broadcastUUID);
  }

  getAllBroadcasts(): RegisteredBroadcast[] {
    return Array.from(this.broadcasts.values());
  }

  getBroadcastDisplayName(broadcastUUID: string): string | undefined {
    const broadcast = this.broadcasts.get(broadcastUUID);
    return broadcast?.broadcastDisplayName;
  }

  findMatchingBroadcasts(
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string,
    nick: string,
    messageText: string
  ): RegisteredBroadcast[] {
    return Array.from(this.broadcasts.values()).filter((broadcast) => {
      // Check platform, network, instance, channel, user, and nick regexes
      if (
        !broadcast.platformRegex.test(platform) ||
        !broadcast.networkRegex.test(network) ||
        !broadcast.instanceRegex.test(instance) ||
        !broadcast.channelRegex.test(channel) ||
        !broadcast.userRegex.test(user) ||
        !broadcast.nickRegex.test(nick)
      ) {
        return false;
      }

      // If messageFilterRegex is provided, check if the message matches it
      if (
        broadcast.messageFilterRegex &&
        !broadcast.messageFilterRegex.test(messageText)
      ) {
        return false;
      }

      return true;
    });
  }
}
