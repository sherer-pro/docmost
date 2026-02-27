import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Redis from 'ioredis';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

/**
 * Event for telemetry/alert hooks when the limit is exceeded.
 */
export interface AuthRateLimitExceededEvent {
  endpoint: string;
  scope: 'ip' | 'account';
  keyHash: string;
  limit: number;
  windowMs: number;
  retryAfterMs: number;
}

interface BucketState {
  count: number;
  resetAt: number;
}

interface TelemetryCounter {
  ip: number;
  account: number;
}

interface AuthRateLimitOperationMetrics {
  storage: 'memory' | 'redis';
  activeKeys: number;
  totalRequests: number;
  rejectedRequests: number;
  rejectRate: number;
}

interface RedisClientLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  pttl(key: string): Promise<number>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
  quit?(): Promise<'OK' | unknown>;
}

/**
 * Internal rate-limiting service for auth endpoints.
 *
 * Supports two storage backends:
 * 1) process memory (single-node);
 * 2) Redis keys with TTL (multi-node).
 */
@Injectable()
export class AuthRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthRateLimitService.name);

  /**
   * Attempt buckets by key.
   */
  private readonly buckets = new Map<string, BucketState>();

  /**
   * Simple telemetry counters.
   */
  private readonly telemetryCounters = new Map<string, TelemetryCounter>();

  /**
   * Operational counters for monitoring.
   */
  private totalRequests = 0;
  private rejectedRequests = 0;

  private readonly storageBackend: 'memory' | 'redis';

  private readonly redisPrefix = 'auth:rate-limit';

  private readonly cleanupIntervalMs = 30_000;

  private cleanupTimer?: NodeJS.Timeout;

  private readonly redisConsumeScript = `
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    return current
  `;

  private redisClient?: RedisClientLike;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly environmentService: EnvironmentService,
    /**
     * Optional Redis client is used only in tests,
     * while runtime creates its own client from environment configuration.
     */
    @Optional()
    redisClient?: RedisClientLike,
  ) {
    this.storageBackend = this.environmentService.getAuthRateLimitStorage();

    if (this.storageBackend === 'memory') {
      this.startCleanupScheduler();
      return;
    }

    this.redisClient = redisClient ?? this.createRedisClient();
  }

  async consume(input: {
    endpoint: string;
    scope: 'ip' | 'account';
    key: string;
    limit: number;
    windowMs: number;
    now?: number;
  }) {
    this.totalRequests += 1;

    if (this.storageBackend === 'redis' && this.redisClient) {
      return this.consumeRedis(input);
    }

    return this.consumeMemory(input);
  }

  /**
   * Returns a snapshot of counters for monitoring/tests.
   */
  getTelemetryCounters() {
    return new Map(this.telemetryCounters);
  }

  /**
   * Exposes operational rate-limit metrics for monitoring.
   */
  async getOperationalMetrics(): Promise<AuthRateLimitOperationMetrics> {
    const activeKeys =
      this.storageBackend === 'redis' ? await this.countRedisKeys() : this.buckets.size;

    return {
      storage: this.storageBackend,
      activeKeys,
      totalRequests: this.totalRequests,
      rejectedRequests: this.rejectedRequests,
      rejectRate:
        this.totalRequests === 0 ? 0 : this.rejectedRequests / this.totalRequests,
    };
  }

  /**
   * State reset is needed for tests.
   */
  async reset() {
    this.buckets.clear();
    this.telemetryCounters.clear();
    this.totalRequests = 0;
    this.rejectedRequests = 0;

    if (this.storageBackend === 'redis') {
      await this.deleteRedisKeysByPrefix();
    }
  }

  async onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    if (this.redisClient?.quit) {
      await this.redisClient.quit();
    }
  }

  private async consumeRedis(input: {
    endpoint: string;
    scope: 'ip' | 'account';
    key: string;
    limit: number;
    windowMs: number;
  }) {
    const bucketKey = this.getRedisBucketKey(input.endpoint, input.scope, input.key);

    try {
      const countResult = await this.redisClient!.eval(
        this.redisConsumeScript,
        1,
        bucketKey,
        input.windowMs,
      );

      const count = Number(countResult);

      if (count > input.limit) {
        const retryAfterMs = Math.max(0, await this.redisClient!.pttl(bucketKey));
        this.handleLimitExceeded(input, retryAfterMs);

        return {
          allowed: false,
          retryAfterMs,
        } as const;
      }

      return {
        allowed: true,
        retryAfterMs: 0,
      } as const;
    } catch (error) {
      this.logger.warn('Redis auth rate limiter failed, falling back to memory backend');
      return this.consumeMemory({ ...input, now: Date.now() });
    }
  }

  private consumeMemory(input: {
    endpoint: string;
    scope: 'ip' | 'account';
    key: string;
    limit: number;
    windowMs: number;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const bucketKey = `${input.endpoint}:${input.scope}:${this.hashIdentifier(input.key)}`;
    const current = this.buckets.get(bucketKey);

    const hasWindowExpired = !current || current.resetAt <= now;
    const state: BucketState = hasWindowExpired
      ? { count: 0, resetAt: now + input.windowMs }
      : current;

    state.count += 1;
    this.buckets.set(bucketKey, state);

    if (state.count > input.limit) {
      const retryAfterMs = Math.max(0, state.resetAt - now);
      this.handleLimitExceeded(input, retryAfterMs);

      return {
        allowed: false,
        retryAfterMs,
      } as const;
    }

    return {
      allowed: true,
      retryAfterMs: 0,
    } as const;
  }

  private handleLimitExceeded(
    input: { endpoint: string; scope: 'ip' | 'account'; key: string; limit: number; windowMs: number },
    retryAfterMs: number,
  ) {
    this.rejectedRequests += 1;
    this.incrementTelemetryCounter(input.endpoint, input.scope);

    const event: AuthRateLimitExceededEvent = {
      endpoint: input.endpoint,
      scope: input.scope,
      keyHash: this.hashIdentifier(input.key),
      limit: input.limit,
      windowMs: input.windowMs,
      retryAfterMs,
    };

    this.logger.warn(
      `Auth rate limit exceeded: endpoint=${event.endpoint}, scope=${event.scope}, retryAfterMs=${event.retryAfterMs}`,
    );
    this.eventEmitter.emit('auth.rate_limit.exceeded', event);
  }

  private incrementTelemetryCounter(endpoint: string, scope: 'ip' | 'account') {
    const prev = this.telemetryCounters.get(endpoint) ?? { ip: 0, account: 0 };
    prev[scope] += 1;
    this.telemetryCounters.set(endpoint, prev);
  }

  private startCleanupScheduler() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();

      for (const [key, state] of this.buckets.entries()) {
        if (state.resetAt <= now) {
          this.buckets.delete(key);
        }
      }
    }, this.cleanupIntervalMs);

    this.cleanupTimer.unref();
  }

  private createRedisClient(): RedisClientLike {
    return new Redis(this.environmentService.getRedisUrl(), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    }) as unknown as RedisClientLike;
  }

  private getRedisBucketKey(endpoint: string, scope: 'ip' | 'account', key: string) {
    return `${this.redisPrefix}:${endpoint}:${scope}:${this.hashIdentifier(key)}`;
  }

  private async deleteRedisKeysByPrefix() {
    if (!this.redisClient) {
      return;
    }

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redisClient.scan(cursor, 'MATCH', `${this.redisPrefix}:*`, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
    } while (cursor !== '0');
  }

  private async countRedisKeys() {
    if (!this.redisClient) {
      return 0;
    }

    let cursor = '0';
    let total = 0;

    do {
      const [nextCursor, keys] = await this.redisClient.scan(cursor, 'MATCH', `${this.redisPrefix}:*`, 'COUNT', 100);
      cursor = nextCursor;
      total += keys.length;
    } while (cursor !== '0');

    return total;
  }

  private hashIdentifier(value: string): string {
    return createHash('sha256')
      .update(value.trim().toLowerCase())
      .digest('hex');
  }
}
