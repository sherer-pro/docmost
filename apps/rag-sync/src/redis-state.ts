import { Redis } from 'ioredis';
import type {
  FeedCheckpointKind,
  SourceMapping,
  SyncStateStore,
} from './types.js';

export class RedisSyncStateStore implements SyncStateStore {
  private readonly redis: Redis;

  constructor(
    redisUrl: string,
    private readonly prefix: string,
  ) {
    this.redis = new Redis(redisUrl, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  async acquireLock(
    bindingId: string,
    token: string,
    ttlMs: number,
  ): Promise<boolean> {
    await this.ensureConnected();
    return (
      (await this.redis.set(
        this.key(bindingId, 'lock'),
        token,
        'PX',
        ttlMs,
        'NX',
      )) === 'OK'
    );
  }

  async renewLock(
    bindingId: string,
    token: string,
    ttlMs: number,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("pexpire", KEYS[1], ARGV[2])
       end
       return 0`,
      1,
      this.key(bindingId, 'lock'),
      token,
      ttlMs,
    );
    return Number(result) === 1;
  }

  async releaseLock(bindingId: string, token: string): Promise<void> {
    await this.redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("del", KEYS[1])
       end
       return 0`,
      1,
      this.key(bindingId, 'lock'),
      token,
    );
  }

  async getCheckpoint(
    bindingId: string,
    kind: FeedCheckpointKind,
  ): Promise<number> {
    await this.ensureConnected();
    const value = await this.redis.hget(
      this.key(bindingId, 'checkpoints'),
      kind,
    );
    const parsed = Number(value ?? 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  async setCheckpoint(
    bindingId: string,
    kind: FeedCheckpointKind,
    value: number,
  ): Promise<void> {
    await this.redis.hset(
      this.key(bindingId, 'checkpoints'),
      kind,
      String(value),
    );
  }

  async getMapping(
    bindingId: string,
    identity: string,
  ): Promise<SourceMapping | null> {
    const value = await this.redis.hget(
      this.key(bindingId, 'mappings'),
      identity,
    );
    return value ? (JSON.parse(value) as SourceMapping) : null;
  }

  async listMappings(bindingId: string): Promise<SourceMapping[]> {
    const values = await this.redis.hvals(this.key(bindingId, 'mappings'));
    return values.map((value) => JSON.parse(value) as SourceMapping);
  }

  async setMapping(
    bindingId: string,
    mapping: SourceMapping,
  ): Promise<void> {
    await this.redis.hset(
      this.key(bindingId, 'mappings'),
      mapping.identity,
      JSON.stringify(mapping),
    );
  }

  async deleteMapping(bindingId: string, identity: string): Promise<void> {
    await this.redis.hdel(this.key(bindingId, 'mappings'), identity);
  }

  async close(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') {
      await this.redis.connect();
    }
  }

  private key(bindingId: string, suffix: string): string {
    return `${this.prefix}:${bindingId}:${suffix}`;
  }
}
