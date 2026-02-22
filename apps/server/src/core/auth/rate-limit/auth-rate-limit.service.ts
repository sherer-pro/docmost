import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Событие для telemetry/alert hook при превышении лимита.
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

/**
 * Внутренний сервис лимитирования auth endpoint'ов.
 *
 * Хранит состояние в памяти процесса, чего достаточно для unit/integration сценариев
 * и single-instance deployment. Для multi-instance может быть расширен на Redis.
 */
@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);

  /**
   * Бакеты попыток по ключу.
   */
  private readonly buckets = new Map<string, BucketState>();

  /**
   * Простейшие счётчики для telemetry.
   */
  private readonly telemetryCounters = new Map<string, TelemetryCounter>();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  consume(input: {
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

  /**
   * Возвращает снимок счётчиков для мониторинга/тестов.
   */
  getTelemetryCounters() {
    return new Map(this.telemetryCounters);
  }

  /**
   * Очистка состояния нужна для тестов.
   */
  reset() {
    this.buckets.clear();
    this.telemetryCounters.clear();
  }

  private incrementTelemetryCounter(endpoint: string, scope: 'ip' | 'account') {
    const prev = this.telemetryCounters.get(endpoint) ?? { ip: 0, account: 0 };
    prev[scope] += 1;
    this.telemetryCounters.set(endpoint, prev);
  }

  private hashIdentifier(value: string): string {
    return createHash('sha256')
      .update(value.trim().toLowerCase())
      .digest('hex');
  }
}
