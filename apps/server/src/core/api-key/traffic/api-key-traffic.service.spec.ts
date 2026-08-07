import { ApiKeyTrafficService } from './api-key-traffic.service';
import { Logger } from '@nestjs/common';

class SharedRedisFake {
  private readonly rates = new Map<string, number>();
  private readonly leases = new Map<string, Map<string, number>>();

  async eval(script: string, numKeys: number, ...args: any[]) {
    if (script.includes('ZSCORE')) {
      const keys = args.slice(0, numKeys) as string[];
      const expiresAt = Number(args[numKeys]);
      const leaseId = String(args[numKeys + 1]);
      if (
        keys.some((key) => !this.leases.get(key)?.has(leaseId))
      ) {
        return 0;
      }
      for (const key of keys) {
        this.leases.get(key)!.set(leaseId, expiresAt);
      }
      return 1;
    }
    const [
      rateKey,
      concurrentKey,
      bulkKey,
      _windowMs,
      rateLimit,
      now,
      expiresAt,
      concurrencyLimit,
      bulkLimit,
      leaseId,
    ] = args;
    const rate = (this.rates.get(rateKey) ?? 0) + 1;
    this.rates.set(rateKey, rate);
    if (rate > Number(rateLimit)) return [-1, 60_000];

    const concurrent = this.active(concurrentKey, Number(now));
    if (concurrent.size >= Number(concurrencyLimit)) return [-2, 1000];
    if (Number(bulkLimit) > 0) {
      const bulk = this.active(bulkKey, Number(now));
      if (bulk.size >= Number(bulkLimit)) return [-3, 1000];
      bulk.set(leaseId, Number(expiresAt));
    }
    concurrent.set(leaseId, Number(expiresAt));
    return [1, 0];
  }

  async zrem(key: string, leaseId: string) {
    return this.leases.get(key)?.delete(leaseId) ? 1 : 0;
  }

  private active(key: string, now: number) {
    const values = this.leases.get(key) ?? new Map<string, number>();
    for (const [id, expiry] of values) {
      if (expiry <= now) values.delete(id);
    }
    this.leases.set(key, values);
    return values;
  }
}

describe('ApiKeyTrafficService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces shared concurrency atomically across service instances', async () => {
    const redis = new SharedRedisFake();
    const redisService = { getOrThrow: () => redis } as any;
    const first = new ApiKeyTrafficService(redisService);
    const second = new ApiKeyTrafficService(redisService);
    const limits = { ratePerMinute: 100, maxConcurrent: 1 };

    const lease = await first.acquire({
      profile: 'mcp',
      apiKeyId: 'key-1',
      bulk: false,
      limits,
    });
    await expect(
      second.acquire({
        profile: 'mcp',
        apiKeyId: 'key-1',
        bulk: false,
        limits,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'concurrency',
    });

    await first.release(lease);
    await expect(
      second.acquire({
        profile: 'mcp',
        apiKeyId: 'key-1',
        bulk: false,
        limits,
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('enforces a per-key rate window independently from other keys', async () => {
    const redis = new SharedRedisFake();
    const service = new ApiKeyTrafficService({
      getOrThrow: () => redis,
    } as any);
    const limits = { ratePerMinute: 1, maxConcurrent: 10 };

    const first = await service.acquire({
      profile: 'rag',
      apiKeyId: 'key-1',
      bulk: false,
      limits,
    });
    await service.release(first);
    await expect(
      service.acquire({
        profile: 'rag',
        apiKeyId: 'key-1',
        bulk: false,
        limits,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: 'rate' });
    await expect(
      service.acquire({
        profile: 'rag',
        apiKeyId: 'key-2',
        bulk: false,
        limits,
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('applies the lower bulk concurrency limit', async () => {
    const redis = new SharedRedisFake();
    const service = new ApiKeyTrafficService({
      getOrThrow: () => redis,
    } as any);
    const limits = {
      ratePerMinute: 100,
      maxConcurrent: 8,
      maxBulkConcurrent: 1,
    };

    await service.acquire({
      profile: 'rag',
      apiKeyId: 'key-1',
      bulk: true,
      limits,
    });
    await expect(
      service.acquire({
        profile: 'rag',
        apiKeyId: 'key-1',
        bulk: true,
        limits,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'concurrency',
    });
  });

  it('renews a long-running concurrency lease before its original expiry', async () => {
    jest.useFakeTimers({ now: 0 });
    const redis = new SharedRedisFake();
    const service = new ApiKeyTrafficService({
      getOrThrow: () => redis,
    } as any);
    (service as any).concurrencyTtlMs = 90;
    const limits = { ratePerMinute: 100, maxConcurrent: 1 };
    const lease = await service.acquire({
      profile: 'mcp',
      apiKeyId: 'key-1',
      bulk: false,
      limits,
    });

    jest.advanceTimersByTime(60);
    await expect(service.renew(lease)).resolves.toBe(true);
    jest.advanceTimersByTime(60);
    await expect(
      service.acquire({
        profile: 'mcp',
        apiKeyId: 'key-1',
        bulk: false,
        limits,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: 'concurrency' });
  });

  it('lets only the random lease owner renew or release a concurrency slot', async () => {
    const redis = new SharedRedisFake();
    const service = new ApiKeyTrafficService({
      getOrThrow: () => redis,
    } as any);
    const limits = { ratePerMinute: 100, maxConcurrent: 1 };
    const lease = await service.acquire({
      profile: 'mcp',
      apiKeyId: 'key-1',
      bulk: false,
      limits,
    });
    const forgedLease = { ...lease, leaseId: 'not-the-owner' };

    await expect(service.renew(forgedLease)).resolves.toBe(false);
    await service.release(forgedLease);
    await expect(
      service.acquire({
        profile: 'mcp',
        apiKeyId: 'key-1',
        bulk: false,
        limits,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: 'concurrency' });

    await service.release(lease);
    await expect(
      service.acquire({
        profile: 'mcp',
        apiKeyId: 'key-1',
        bulk: false,
        limits,
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('logs low-cardinality edge summaries and resets the interval', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = new ApiKeyTrafficService({
      getOrThrow: () => new SharedRedisFake(),
    } as any);

    service.observeRequest('rag', 'completed', 12, 256);
    service.observeLeaseLoss('rag');
    service.observeMcpTool('success', 8, 128);
    expect(service.getOperationalSnapshot().rag.admission.leaseLost).toBe(1);
    service.flushSummary();

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map(([message]) => message).join('\n')).not.toMatch(
      /apiKeyId|token|userId/,
    );
    expect(service.getOperationalSnapshot().rag.requests.completed).toBe(0);
    expect(service.getOperationalSnapshot().rag.admission.leaseLost).toBe(0);
    expect(service.getOperationalSnapshot().mcp.tools.success).toBe(0);
    log.mockRestore();
  });
});
