import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthRateLimitService } from './auth-rate-limit.service';

type StorageMode = 'memory' | 'redis';

class FakeRedisClient {
  private readonly store = new Map<string, { count: number; expiresAt: number }>();

  async eval(_script: string, _numKeys: number, key: string, windowMs: number) {
    const now = Date.now();
    this.evictExpired(now);

    const current = this.store.get(key);
    if (!current) {
      this.store.set(key, { count: 1, expiresAt: now + Number(windowMs) });
      return 1;
    }

    current.count += 1;
    return current.count;
  }

  async pttl(key: string) {
    const now = Date.now();
    this.evictExpired(now);

    const value = this.store.get(key);
    if (!value) {
      return -2;
    }

    return Math.max(0, value.expiresAt - now);
  }

  async scan(_cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    const now = Date.now();
    this.evictExpired(now);

    const matchIndex = args.findIndex((arg) => arg === 'MATCH');
    const matchPattern = matchIndex >= 0 ? String(args[matchIndex + 1]) : '*';
    const prefix = matchPattern.replace('*', '');

    const keys = [...this.store.keys()].filter((key) => key.startsWith(prefix));
    return ['0', keys];
  }

  async del(...keys: string[]) {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        deleted += 1;
      }
    }

    return deleted;
  }

  async quit() {
    return 'OK';
  }

  private evictExpired(now: number) {
    for (const [key, value] of this.store.entries()) {
      if (value.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }
}

describe('AuthRateLimitService', () => {
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    eventEmitter = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createService(storage: StorageMode, redisClient?: FakeRedisClient) {
    const environmentService = {
      getAuthRateLimitStorage: () => storage,
      getRedisUrl: () => 'redis://127.0.0.1:6379',
    } as any;

    return new AuthRateLimitService(eventEmitter, environmentService, redisClient as any);
  }

  it('блокирует запросы после превышения лимита и публикует telemetry событие', async () => {
    const service = createService('memory');

    const first = await service.consume({
      endpoint: 'login',
      scope: 'ip',
      key: '127.0.0.1',
      limit: 1,
      windowMs: 1_000,
      now: 10,
    });

    const second = await service.consume({
      endpoint: 'login',
      scope: 'ip',
      key: '127.0.0.1',
      limit: 1,
      windowMs: 1_000,
      now: 11,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'auth.rate_limit.exceeded',
      expect.objectContaining({ endpoint: 'login', scope: 'ip', limit: 1 }),
    );

    expect(service.getTelemetryCounters().get('login')).toEqual({
      ip: 1,
      account: 0,
    });
  });

  it.each<StorageMode>(['memory', 'redis'])(
    'сбрасывает окно после TTL-истечения в режиме %s',
    async (storage) => {
      const redisClient = storage === 'redis' ? new FakeRedisClient() : undefined;
      const service = createService(storage, redisClient);

      const first = await service.consume({
        endpoint: 'forgotPassword',
        scope: 'account',
        key: 'user@example.com',
        limit: 1,
        windowMs: 1_000,
      });

      const second = await service.consume({
        endpoint: 'forgotPassword',
        scope: 'account',
        key: 'user@example.com',
        limit: 1,
        windowMs: 1_000,
      });

      jest.advanceTimersByTime(1_001);

      const third = await service.consume({
        endpoint: 'forgotPassword',
        scope: 'account',
        key: 'user@example.com',
        limit: 1,
        windowMs: 1_000,
      });

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(false);
      expect(third.allowed).toBe(true);
    },
  );

  it.each<StorageMode>(['memory', 'redis'])(
    'корректно обрабатывает конкурентные запросы в режиме %s',
    async (storage) => {
      const redisClient = storage === 'redis' ? new FakeRedisClient() : undefined;
      const service = createService(storage, redisClient);

      const responses = await Promise.all(
        Array.from({ length: 10 }).map(() =>
          service.consume({
            endpoint: 'login',
            scope: 'ip',
            key: '192.168.1.1',
            limit: 5,
            windowMs: 10_000,
          }),
        ),
      );

      const allowedCount = responses.filter((response) => response.allowed).length;
      const blockedCount = responses.length - allowedCount;

      expect(allowedCount).toBe(5);
      expect(blockedCount).toBe(5);
    },
  );

  it('дает одинаковый результат в memory и redis режимах', async () => {
    const memoryService = createService('memory');
    const redisService = createService('redis', new FakeRedisClient());

    const testInputs = [
      { endpoint: 'login', scope: 'ip' as const, key: '10.0.0.1', limit: 2, windowMs: 1_000 },
      { endpoint: 'login', scope: 'ip' as const, key: '10.0.0.1', limit: 2, windowMs: 1_000 },
      { endpoint: 'login', scope: 'ip' as const, key: '10.0.0.1', limit: 2, windowMs: 1_000 },
    ];

    const memoryResults = [] as Array<{ allowed: boolean; retryAfterMs: number }>;
    const redisResults = [] as Array<{ allowed: boolean; retryAfterMs: number }>;

    for (const input of testInputs) {
      memoryResults.push(await memoryService.consume(input));
      redisResults.push(await redisService.consume(input));
    }

    expect(memoryResults.map((result) => result.allowed)).toEqual(
      redisResults.map((result) => result.allowed),
    );

    const memoryMetrics = await memoryService.getOperationalMetrics();
    const redisMetrics = await redisService.getOperationalMetrics();

    expect(memoryMetrics.rejectRate).toBe(redisMetrics.rejectRate);
    expect(memoryMetrics.rejectedRequests).toBe(redisMetrics.rejectedRequests);
  });

  it('возвращает операционные метрики для мониторинга', async () => {
    const service = createService('memory');

    await service.consume({
      endpoint: 'mfa',
      scope: 'account',
      key: 'user@example.com',
      limit: 1,
      windowMs: 60_000,
      now: 1,
    });

    await service.consume({
      endpoint: 'mfa',
      scope: 'account',
      key: 'user@example.com',
      limit: 1,
      windowMs: 60_000,
      now: 2,
    });

    const metrics = await service.getOperationalMetrics();

    expect(metrics.storage).toBe('memory');
    expect(metrics.activeKeys).toBe(1);
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.rejectedRequests).toBe(1);
    expect(metrics.rejectRate).toBe(0.5);
  });
});
