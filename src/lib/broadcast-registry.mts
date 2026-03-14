import { NatsClient, log } from '@eeveebot/libeevee';
import {
  BroadcastRegistration,
  RegisteredBroadcast,
} from '../types/broadcast.mjs';

export class BroadcastRegistry {
  private broadcasts: Map<string, RegisteredBroadcast> = new Map();
  private natsClient: InstanceType<typeof NatsClient> | null = null;

  constructor(natsClient?: InstanceType<typeof NatsClient>) {
    this.natsClient = natsClient || null;
  }

  // Cleanup-like method to clean up resources
  public destroy(): void {
    // Clear all broadcast timers
    for (const broadcast of this.broadcasts.values()) {
      if (broadcast.timers) {
        clearTimeout(broadcast.timers.cleanupTimer);
        clearTimeout(broadcast.timers.reRegistrationTimer);
      }
    }
    this.broadcasts.clear();
  }

  /**
   * Prompt modules to re-register a specific broadcast that is halfway through its TTL
   */
  private promptReRegistration(broadcast: RegisteredBroadcast): void {
    if (!this.natsClient) {
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
    try {
      const now = Date.now();
      // Use provided TTL or default to 120000ms (2 minutes)
      const ttl = registration.ttl ?? 120000;

      // If broadcast already exists, clear its existing timers
      const existingBroadcast = this.broadcasts.get(registration.broadcastUUID);
      if (existingBroadcast && existingBroadcast.timers) {
        clearTimeout(existingBroadcast.timers.cleanupTimer);
        clearTimeout(existingBroadcast.timers.reRegistrationTimer);
      }

      const registeredBroadcast: RegisteredBroadcast = {
        broadcastUUID: registration.broadcastUUID,
        broadcastDisplayName: registration.broadcastDisplayName,
        platformRegex: new RegExp(registration.platform),
        networkRegex: new RegExp(registration.network),
        instanceRegex: new RegExp(registration.instance),
        channelRegex: new RegExp(registration.channel),
        userRegex: new RegExp(registration.user),
        messageFilterRegex: registration.messageFilterRegex
          ? new RegExp(registration.messageFilterRegex)
          : undefined,
        ttl: ttl,
        registeredAt: now,
        expiresAt: now + ttl,
      };

      // Set up individual timers for this broadcast
      const cleanupTimer = setTimeout(() => {
        this.broadcasts.delete(registration.broadcastUUID);
        log.info('Expired broadcast removed', {
          producer: 'router',
          broadcastUUID: registration.broadcastUUID,
          broadcastDisplayName: registration.broadcastDisplayName,
        });
      }, ttl);

      // Set up re-registration timer for halfway through TTL
      const reRegistrationTimer = setTimeout(() => {
        const broadcast = this.broadcasts.get(registration.broadcastUUID);
        if (broadcast) {
          this.promptReRegistration(broadcast);
        }
      }, ttl / 2);

      // Store timers in the broadcast object
      registeredBroadcast.timers = {
        cleanupTimer,
        reRegistrationTimer,
      };

      this.broadcasts.set(registration.broadcastUUID, registeredBroadcast);

      log.info('Registered broadcast', {
        producer: 'router',
        broadcastUUID: registration.broadcastUUID,
        broadcastDisplayName: registration.broadcastDisplayName,
        ttl: ttl,
        expiresAt: registeredBroadcast.expiresAt,
      });
    } catch (error) {
      log.error('Failed to register broadcast', {
        producer: 'router',
        broadcastUUID: registration.broadcastUUID,
        broadcastDisplayName: registration.broadcastDisplayName,
        errorMessage: (error as Error).message,
      });
    }
  }

  unregisterBroadcast(broadcastUUID: string): boolean {
    const broadcast = this.broadcasts.get(broadcastUUID);
    const result = this.broadcasts.delete(broadcastUUID);

    // Clear timers for this broadcast
    if (broadcast && broadcast.timers) {
      clearTimeout(broadcast.timers.cleanupTimer);
      clearTimeout(broadcast.timers.reRegistrationTimer);
    }

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
    messageText: string
  ): RegisteredBroadcast[] {
    return Array.from(this.broadcasts.values()).filter((broadcast) => {
      // First check if broadcast has expired
      if (Date.now() > broadcast.expiresAt) {
        return false;
      }

      // Then check platform, network, instance, channel, and user regexes
      if (
        !broadcast.platformRegex.test(platform) ||
        !broadcast.networkRegex.test(network) ||
        !broadcast.instanceRegex.test(instance) ||
        !broadcast.channelRegex.test(channel) ||
        !broadcast.userRegex.test(user)
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
