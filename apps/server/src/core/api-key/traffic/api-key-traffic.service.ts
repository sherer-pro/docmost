import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

export interface ApiKeyTrafficLimits {
  ratePerMinute: number;
  maxConcurrent: number;
  maxBulkConcurrent?: number;
}

export interface ApiKeyTrafficLease {
  allowed: boolean;
  reason?: 'rate' | 'concurrency';
  retryAfterMs: number;
  leaseId?: string;
  keys?: string[];
  renewAfterMs?: number;
}

type TrafficProfile = 'rag' | 'mcp';
type RequestOutcome = 'completed' | 'aborted' | 'error';

type TrafficSummary = {
  admission: Record<
    | 'allowed'
    | 'rateLimited'
    | 'concurrencyLimited'
    | 'backendError'
    | 'leaseLost',
    number
  >;
  requests: Record<RequestOutcome, number> & {
    totalMs: number;
    maxMs: number;
    responseBytes: number;
  };
  tools: Record<'success' | 'error', number> & {
    totalMs: number;
    maxMs: number;
    resultBytes: number;
  };
};

function trafficSummary(): TrafficSummary {
  return {
    admission: {
      allowed: 0,
      rateLimited: 0,
      concurrencyLimited: 0,
      backendError: 0,
      leaseLost: 0,
    },
    requests: {
      completed: 0,
      aborted: 0,
      error: 0,
      totalMs: 0,
      maxMs: 0,
      responseBytes: 0,
    },
    tools: {
      success: 0,
      error: 0,
      totalMs: 0,
      maxMs: 0,
      resultBytes: 0,
    },
  };
}

@Injectable()
export class ApiKeyTrafficService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiKeyTrafficService.name);
  private readonly redis: Redis;
  private readonly ownsRedisConnection: boolean;
  private readonly prefix = 'api-key:traffic';
  private readonly concurrencyTtlMs = 10 * 60_000;
  private readonly concurrencyRenewMs = Math.floor(
    this.concurrencyTtlMs / 3,
  );
  private readonly summaries: Record<TrafficProfile, TrafficSummary> = {
    rag: trafficSummary(),
    mcp: trafficSummary(),
  };
  private summaryTimer?: NodeJS.Timeout;

  private readonly acquireScript = `
    local rate = redis.call('INCR', KEYS[1])
    if rate == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
    if rate > tonumber(ARGV[2]) then
      return {-1, redis.call('PTTL', KEYS[1])}
    end

    local now = tonumber(ARGV[3])
    local expires = tonumber(ARGV[4])
    redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now)
    if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then
      return {-2, 1000}
    end

    if tonumber(ARGV[6]) > 0 then
      redis.call('ZREMRANGEBYSCORE', KEYS[3], 0, now)
      if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[6]) then
        return {-3, 1000}
      end
    end

    redis.call('ZADD', KEYS[2], expires, ARGV[7])
    redis.call('PEXPIRE', KEYS[2], ARGV[8])
    if tonumber(ARGV[6]) > 0 then
      redis.call('ZADD', KEYS[3], expires, ARGV[7])
      redis.call('PEXPIRE', KEYS[3], ARGV[8])
    end
    return {1, 0}
  `;

  private readonly renewScript = `
    for index = 1, #KEYS do
      if not redis.call('ZSCORE', KEYS[index], ARGV[2]) then
        return 0
      end
    end
    for index = 1, #KEYS do
      redis.call('ZADD', KEYS[index], ARGV[1], ARGV[2])
      redis.call('PEXPIRE', KEYS[index], ARGV[3])
    end
    return 1
  `;

  constructor(redisService: RedisService) {
    const sharedRedis = redisService.getOrThrow();
    if (typeof sharedRedis.duplicate === 'function') {
      this.redis = sharedRedis.duplicate({
        autoResendUnfulfilledCommands: false,
        commandTimeout: 5_000,
        connectionName: 'docmost-api-key-traffic',
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
      });
      this.ownsRedisConnection = true;
    } else {
      // Lightweight test doubles do not need to implement connection cloning.
      this.redis = sharedRedis;
      this.ownsRedisConnection = false;
    }
  }

  onModuleInit(): void {
    this.summaryTimer = setInterval(() => this.flushSummary(), 60_000);
    this.summaryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.summaryTimer) clearInterval(this.summaryTimer);
    if (this.ownsRedisConnection) this.redis.disconnect();
  }

  async acquire(input: {
    profile: 'rag' | 'mcp';
    apiKeyId: string;
    bulk: boolean;
    limits: ApiKeyTrafficLimits;
  }): Promise<ApiKeyTrafficLease> {
    const leaseId = randomUUID();
    const now = Date.now();
    const expiresAt = now + this.concurrencyTtlMs;
    const base = `${this.prefix}:${input.profile}:${input.apiKeyId}`;
    const keys = [`${base}:concurrent`];
    if (input.bulk) keys.push(`${base}:bulk`);

    try {
      const result = (await this.redis.eval(
        this.acquireScript,
        3,
        `${base}:rate`,
        keys[0],
        input.bulk ? keys[1] : `${base}:unused`,
        60_000,
        input.limits.ratePerMinute,
        now,
        expiresAt,
        input.limits.maxConcurrent,
        input.bulk ? input.limits.maxBulkConcurrent ?? 0 : 0,
        leaseId,
        this.concurrencyTtlMs,
      )) as [number | string, number | string];
      const status = Number(result?.[0]);
      const retryAfterMs = Math.max(0, Number(result?.[1] ?? 0));
      if (status !== 1) {
        this.summaries[input.profile].admission[
          status === -1 ? 'rateLimited' : 'concurrencyLimited'
        ] += 1;
        return {
          allowed: false,
          reason: status === -1 ? 'rate' : 'concurrency',
          retryAfterMs,
        };
      }
      this.summaries[input.profile].admission.allowed += 1;
      return {
        allowed: true,
        retryAfterMs: 0,
        leaseId,
        keys,
        renewAfterMs: this.concurrencyRenewMs,
      };
    } catch (error) {
      this.summaries[input.profile].admission.backendError += 1;
      this.logger.error('Redis API key traffic limiter failed');
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'api_key_limit_unavailable',
        message: 'API key traffic controls are unavailable',
      });
    }
  }

  async release(lease: ApiKeyTrafficLease): Promise<void> {
    if (!lease.leaseId || !lease.keys?.length) return;
    try {
      await this.redis.zrem(lease.keys[0], lease.leaseId);
      if (lease.keys[1]) await this.redis.zrem(lease.keys[1], lease.leaseId);
    } catch {
      this.logger.warn('Failed to release API key concurrency lease');
    }
  }

  async renew(lease: ApiKeyTrafficLease): Promise<boolean> {
    if (!lease.leaseId || !lease.keys?.length) return false;
    try {
      const expiresAt = Date.now() + this.concurrencyTtlMs;
      const renewed = await this.redis.eval(
        this.renewScript,
        lease.keys.length,
        ...lease.keys,
        expiresAt,
        lease.leaseId,
        this.concurrencyTtlMs,
      );
      return Number(renewed) === 1;
    } catch {
      this.logger.warn('Failed to renew API key concurrency lease');
      return false;
    }
  }

  observeLeaseLoss(profile: TrafficProfile): void {
    this.summaries[profile].admission.leaseLost += 1;
  }

  observeRequest(
    profile: TrafficProfile,
    outcome: RequestOutcome,
    durationMs: number,
    responseBytes = 0,
  ): void {
    const summary = this.summaries[profile].requests;
    const duration = Math.max(0, Math.round(durationMs));
    summary[outcome] += 1;
    summary.totalMs += duration;
    summary.maxMs = Math.max(summary.maxMs, duration);
    summary.responseBytes += Math.max(0, Math.round(responseBytes));
  }

  observeMcpTool(
    outcome: 'success' | 'error',
    durationMs: number,
    resultBytes: number,
  ): void {
    const summary = this.summaries.mcp.tools;
    const duration = Math.max(0, Math.round(durationMs));
    summary[outcome] += 1;
    summary.totalMs += duration;
    summary.maxMs = Math.max(summary.maxMs, duration);
    summary.resultBytes += Math.max(0, Math.round(resultBytes));
  }

  getOperationalSnapshot(): Record<TrafficProfile, TrafficSummary> {
    return structuredClone(this.summaries);
  }

  flushSummary(): void {
    for (const profile of ['rag', 'mcp'] as const) {
      const summary = this.summaries[profile];
      const hasActivity =
        Object.values(summary.admission).some((value) => value > 0) ||
        summary.requests.completed +
          summary.requests.aborted +
          summary.requests.error >
          0 ||
        summary.tools.success + summary.tools.error > 0;
      if (!hasActivity) continue;
      this.logger.log(
        JSON.stringify({
          component: profile,
          event: 'edge.operational.summary',
          intervalSeconds: 60,
          ...structuredClone(summary),
        }),
      );
      this.summaries[profile] = trafficSummary();
    }
  }
}
