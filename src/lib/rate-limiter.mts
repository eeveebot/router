import { RateLimitConfig } from '../types/command.mjs';
import { log } from '@eeveebot/libeevee';
import { NatsClient } from '@eeveebot/libeevee';
import { PlatformNotifier } from './notifier.mjs';

interface RateLimitState {
  count: number;
  lastReset: number;
  limit: number;
  interval: string;
}

interface QueuedCommand {
  commandUUID: string;
  platform: string;
  network: string;
  instance: string;
  channel: string;
  user: string;
  userHost: string;
  text: string;
  originalText: string;
  matchedCommand: string;
  timestamp: number;
  subjects: string[];
}

export class RateLimiter {
  private limits: Map<string, RateLimitState> = new Map();
  private commandQueue: QueuedCommand[] = [];
  private processingQueue = false;
  private notifier: PlatformNotifier;
  private commandRegistry:
    | import('./command-registry.mjs').CommandRegistry
    | null = null;

  constructor(
    commandRegistry?: import('./command-registry.mjs').CommandRegistry
  ) {
    this.notifier = new PlatformNotifier();
    if (commandRegistry) {
      this.commandRegistry = commandRegistry;
    }
  }

  public setCommandRegistry(
    commandRegistry: import('./command-registry.mjs').CommandRegistry
  ): void {
    this.commandRegistry = commandRegistry;
  }

  public setNatsClient(nats: InstanceType<typeof NatsClient>): void {
    this.notifier.setNatsClient(nats);
  }

  public getStats(): Record<
    string,
    { count: number; limit: number; interval: string; commandName?: string }
  > {
    const stats: Record<
      string,
      { count: number; limit: number; interval: string; commandName?: string }
    > = {};

    for (const [key, state] of this.limits.entries()) {
      // Try to get the command display name from the registry
      const commandUUID = key.split(':')[0];
      const commandName =
        this.commandRegistry?.getCommandDisplayName(commandUUID) || commandUUID;

      stats[key] = {
        count: state.count,
        limit: state.limit,
        interval: state.interval,
        commandName: commandName,
      };
    }

    return stats;
  }

  private getKey(
    commandUUID: string,
    level: RateLimitConfig['level'],
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string
  ): string {
    let identifier: string;

    switch (level) {
      case 'platform':
        identifier = `${platform}`;
        break;
      case 'instance':
        identifier = `${platform}:${instance}`;
        break;
      case 'channel':
        identifier = `${platform}:${instance}:${channel}`;
        break;
      case 'user':
        identifier = `${platform}:${instance}:${user}`;
        break;
      case 'global':
        identifier = 'global';
        break;
    }

    return `${commandUUID}:${identifier}`;
  }

  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smh])$/);
    if (!match) {
      throw new Error(`Invalid interval format: ${interval}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      default:
        throw new Error(`Unknown time unit: ${unit}`);
    }
  }

  /**
   * Check if a command execution is allowed based on rate limiting rules
   * @returns true if allowed, false if rate limited
   */
  public isAllowed(
    commandUUID: string,
    ratelimit: RateLimitConfig,
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string
  ): boolean {
    // If limit is 0, rate limiting is disabled
    if (ratelimit.limit === 0) {
      return true;
    }

    const key = this.getKey(
      commandUUID,
      ratelimit.level,
      platform,
      network,
      instance,
      channel,
      user
    );
    const intervalMs = this.parseInterval(ratelimit.interval);
    const now = Date.now();

    let state = this.limits.get(key);

    // Initialize state if it doesn't exist
    if (!state) {
      state = {
        count: 0,
        lastReset: now,
        limit: ratelimit.limit,
        interval: ratelimit.interval,
      };
      this.limits.set(key, state);
    }

    // Reset counter if interval has passed
    if (now - state.lastReset >= intervalMs) {
      state.count = 0;
      state.lastReset = now;
    }

    // Check if we're under the limit
    if (state.count < ratelimit.limit) {
      state.count++;
      return true;
    }

    // Rate limited
    log.info('Rate limit exceeded', {
      producer: 'router',
      commandUUID: commandUUID,
      mode: ratelimit.mode,
      level: ratelimit.level,
      limit: ratelimit.limit,
      interval: ratelimit.interval,
      identifier: key.split(':')[1],
      platform: platform,
      network: network,
      instance: instance,
      channel: channel,
      user: user,
    });

    // Send a notification to the user informing them they are rate-limited
    void this.notifier.notifyUser(
      platform,
      network,
      instance,
      channel,
      user,
      'You are being rate-limited. Please wait before sending more commands.'
    );

    return false;
  }

  /**
   * Add a command to the queue for later execution
   */
  public enqueueCommand(
    commandUUID: string,
    platform: string,
    network: string,
    instance: string,
    channel: string,
    user: string,
    userHost: string,
    text: string,
    originalText: string,
    matchedCommand: string,
    timestamp: number,
    subjects: string[]
  ): void {
    this.commandQueue.push({
      commandUUID,
      platform,
      network,
      instance,
      channel,
      user,
      userHost,
      text,
      originalText,
      matchedCommand,
      timestamp,
      subjects,
    });

    log.info('Enqueued command due to rate limiting', {
      producer: 'router',
      commandUUID: commandUUID,
      queueSize: this.commandQueue.length,
    });
  }

  /**
   * Clean up old rate limit entries to prevent memory leaks
   */
  public cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    // Find entries that haven't been used in the last hour
    for (const [key, state] of this.limits.entries()) {
      if (now - state.lastReset > 60 * 60 * 1000) {
        keysToDelete.push(key);
      }
    }

    // Delete old entries
    for (const key of keysToDelete) {
      this.limits.delete(key);
    }

    // Clean up old queued commands (older than 1 hour)
    const oneHourAgo = now - 60 * 60 * 1000;
    this.commandQueue = this.commandQueue.filter(
      (cmd) => cmd.timestamp > oneHourAgo
    );
  }

  /**
   * Process queued commands when rate limits allow
   */
  public async processQueue(
    nats: InstanceType<typeof NatsClient>
  ): Promise<void> {
    if (this.processingQueue || this.commandQueue.length === 0) {
      return;
    }

    this.processingQueue = true;

    try {
      // Process one command at a time
      const queuedCommand = this.commandQueue.shift();
      if (!queuedCommand) {
        return;
      }

      // Publish the command execution message
      for (const subject of queuedCommand.subjects) {
        const commandMessage = {
          platform: queuedCommand.platform,
          network: queuedCommand.network,
          instance: queuedCommand.instance,
          channel: queuedCommand.channel,
          user: queuedCommand.user,
          userHost: queuedCommand.userHost,
          text: queuedCommand.text,
          originalText: queuedCommand.originalText,
          matchedCommand: queuedCommand.matchedCommand,
          timestamp: queuedCommand.timestamp,
        };

        await nats.publish(subject, JSON.stringify(commandMessage));
        log.info('Published enqueued command execution', {
          producer: 'router',
          commandUUID: queuedCommand.commandUUID,
          user: queuedCommand.user,
          subject: subject,
          originalText: queuedCommand.originalText,
          matchedCommand: queuedCommand.matchedCommand,
        });
      }
    } finally {
      this.processingQueue = false;

      // Continue processing if there are more queued commands
      if (this.commandQueue.length > 0) {
        setTimeout(() => {
          void this.processQueue(nats);
        }, 100); // Small delay to prevent blocking
      }
    }
  }
}
