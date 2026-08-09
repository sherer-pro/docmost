jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import Redis from 'ioredis';
import { v7 as uuid7 } from 'uuid';
import { RedisSyncExtension } from '../src/collaboration/extensions/redis-sync/redis-sync.extension';

type TestEvents = {
  noop: (documentName: string, payload: unknown) => Promise<unknown>;
};

function createInstance() {
  return {
    documents: new Map<string, unknown>(),
    closeConnections: jest.fn(),
    unloadDocument: jest.fn(),
  };
}

function createExtension(
  redis: Redis,
  prefix: string,
  serverId: string,
): RedisSyncExtension<TestEvents> {
  return new RedisSyncExtension<TestEvents>({
    redis,
    prefix,
    serverId,
    lockTTL: 2_000,
    pack: (message) => Buffer.from(JSON.stringify(message)),
    unpack: (message) => JSON.parse(Buffer.from(message).toString('utf8')),
    customEvents: {
      noop: async () => undefined,
    },
  });
}

jest.setTimeout(30_000);

describe('RedisSyncExtension with Redis (e2e)', () => {
  let redis: Redis;
  let firstRedis: Redis;
  let secondRedis: Redis;
  let first: RedisSyncExtension<TestEvents>;
  let second: RedisSyncExtension<TestEvents>;
  let key: string;

  beforeEach(async () => {
    const prefix = `docmost-e2e:${uuid7()}:collab`;
    key = `${prefix}Lock:page-1`;
    redis = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
    });
    firstRedis = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
    });
    secondRedis = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
    });
    await Promise.all([redis.ping(), firstRedis.ping(), secondRedis.ping()]);
    first = createExtension(firstRedis, prefix, 'server-a');
    second = createExtension(secondRedis, prefix, 'server-b');
    await first.onConfigure({ instance: createInstance() } as any);
    await second.onConfigure({ instance: createInstance() } as any);
  });

  afterEach(async () => {
    await first?.onDestroy();
    await second?.onDestroy();
    if (redis) {
      await redis.del(key);
      await redis.quit();
    }
  });

  it('renews and releases a lease only for its current owner', async () => {
    const releaseFirst = await first.lockDocument('page-1');

    await expect(second.lockDocument('page-1')).rejects.toThrow(
      'Could not lock document',
    );
    expect(await second.releaseLock('page-1')).toBe(0);
    expect(await redis.get(key)).toBe('server-a');

    await redis.pexpire(key, 100);
    await first.maintainLock('page-1');
    expect(await redis.pttl(key)).toBeGreaterThan(1_000);

    expect(await releaseFirst()).toBe(1);
    expect(await redis.exists(key)).toBe(0);
  });
});
