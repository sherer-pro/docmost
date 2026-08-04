import { ConflictException, Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

const LOCK_TTL_MS = 30_000;
const LOCK_RENEW_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

const COMPARE_AND_RENEW = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const COMPARE_AND_DELETE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface PageEmbedGraphLease {
  fencingToken: number;
  assertOwned(): void;
  assertOwnedAsync(): Promise<void>;
  release(): Promise<void>;
}

@Injectable()
export class PageEmbedGraphLockService {
  private static readonly processLocks = new Map<
    string,
    { locked: boolean; sequence: number }
  >();
  private readonly redis?: Redis;
  private readonly useProcessMutex: boolean;

  constructor(redisService: RedisService, environment: EnvironmentService) {
    this.useProcessMutex = environment.isCollabDisableRedis();
    if (!this.useProcessMutex) this.redis = redisService.getOrThrow();
  }

  async acquire(workspaceId: string): Promise<PageEmbedGraphLease> {
    if (this.useProcessMutex) return this.acquireProcessLease(workspaceId);
    const redis = this.redis!;
    const lockKey = `page-embed:graph-lock:${workspaceId}`;
    const fencingKey = `page-embed:graph-fence:${workspaceId}`;
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    let fencingToken: number | null = null;

    while (Date.now() < deadline) {
      const fence = await redis.incr(fencingKey);
      const candidate = Date.now() * 1000 + (fence % 1000);
      const value = `${candidate}:${token}`;
      const acquired = await redis.set(lockKey, value, 'PX', LOCK_TTL_MS, 'NX');
      if (acquired === 'OK') {
        fencingToken = candidate;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }

    if (fencingToken === null) {
      throw new ConflictException({
        code: 'page_embed_graph_lock_unavailable',
        message: 'Page embed graph is busy',
      });
    }

    const value = `${fencingToken}:${token}`;
    let lost = false;
    const renewTimer = setInterval(async () => {
      try {
        const renewed = await redis.eval(
          COMPARE_AND_RENEW,
          1,
          lockKey,
          value,
          String(LOCK_TTL_MS),
        );
        if (Number(renewed) !== 1) lost = true;
      } catch {
        lost = true;
      }
    }, LOCK_RENEW_MS);
    renewTimer.unref();

    return {
      fencingToken,
      assertOwned() {
        if (lost) {
          throw new ConflictException({
            code: 'page_embed_graph_lock_lost',
            message: 'Page embed graph lock was lost',
          });
        }
      },
      assertOwnedAsync: async () => {
        let current: string | null = null;
        try {
          current = await redis.get(lockKey);
        } catch {
          lost = true;
        }
        if (current !== value) lost = true;
        if (lost) {
          throw new ConflictException({
            code: 'page_embed_graph_lock_lost',
            message: 'Page embed graph lock was lost',
          });
        }
      },
      release: async () => {
        clearInterval(renewTimer);
        try {
          const released = await redis.eval(
            COMPARE_AND_DELETE,
            1,
            lockKey,
            value,
          );
          if (Number(released) !== 1) lost = true;
        } catch {
          lost = true;
        }
        if (lost) {
          throw new ConflictException({
            code: 'page_embed_graph_lock_lost',
            message: 'Page embed graph lock was lost',
          });
        }
      },
    };
  }

  private async acquireProcessLease(
    workspaceId: string,
  ): Promise<PageEmbedGraphLease> {
    const state = PageEmbedGraphLockService.processLocks.get(workspaceId) ?? {
      locked: false,
      sequence: 0,
    };
    PageEmbedGraphLockService.processLocks.set(workspaceId, state);
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (state.locked && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    if (state.locked) {
      throw new ConflictException({
        code: 'page_embed_graph_lock_unavailable',
        message: 'Page embed graph is busy',
      });
    }
    state.locked = true;
    state.sequence = (state.sequence + 1) % 1000;
    const fencingToken = Date.now() * 1000 + state.sequence;
    let owned = true;
    const assertOwned = () => {
      if (!owned || !state.locked) {
        throw new ConflictException({
          code: 'page_embed_graph_lock_lost',
          message: 'Page embed graph lock was lost',
        });
      }
    };
    return {
      fencingToken,
      assertOwned,
      assertOwnedAsync: async () => assertOwned(),
      release: async () => {
        assertOwned();
        owned = false;
        state.locked = false;
      },
    };
  }
}
