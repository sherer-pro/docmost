import { QueueJob } from '../../integrations/queue/constants';
import { CollabHistoryService } from './collab-history.service';

describe('CollabHistoryService dirty history scheduling', () => {
  const createRedis = () => {
    const hashes = new Map<string, Map<string, string>>();
    const lists = new Map<string, string[]>();
    const sets = new Map<string, Set<string>>();

    const getHash = (key: string) => {
      const existing = hashes.get(key);
      if (existing) {
        return existing;
      }

      const next = new Map<string, string>();
      hashes.set(key, next);
      return next;
    };

    const redis = {
      hashes,
      lists,
      hsetnx: jest.fn(async (key: string, field: string, value: string) => {
        const hash = getHash(key);
        if (hash.has(field)) {
          return 0;
        }

        hash.set(field, value);
        return 1;
      }),
      hgetall: jest.fn(async (key: string) =>
        Object.fromEntries(hashes.get(key)?.entries() ?? []),
      ),
      eval: jest.fn(async (_script: string, keyCount: number, ...args: string[]) => {
        if (keyCount === 1) {
          const [key, expectedLastDirtyAt] = args;
          const hash = hashes.get(key);
          if (hash?.get('lastDirtyAt') === expectedLastDirtyAt) {
            hashes.delete(key);
            return 1;
          }

          return 0;
        }

        if (keyCount === 2) {
          const [bufferKey, processingKey] = args;
          if (lists.has(processingKey) || !lists.has(bufferKey)) {
            return 0;
          }

          lists.set(processingKey, lists.get(bufferKey) ?? []);
          lists.delete(bufferKey);
          return 1;
        }

        return 0;
      }),
      multi: jest.fn(() => {
        const ops: Array<() => void> = [];
        const multi = {
          hset: jest.fn((key: string, field: string, value: string) => {
            ops.push(() => getHash(key).set(field, value));
            return multi;
          }),
          pexpire: jest.fn(() => multi),
          rpush: jest.fn((key: string, ...values: string[]) => {
            ops.push(() => {
              const list = lists.get(key) ?? [];
              list.push(...values);
              lists.set(key, list);
            });
            return multi;
          }),
          lpush: jest.fn((key: string, ...values: string[]) => {
            ops.push(() => {
              const list = lists.get(key) ?? [];
              list.unshift(...values);
              lists.set(key, list);
            });
            return multi;
          }),
          del: jest.fn((key: string) => {
            ops.push(() => {
              hashes.delete(key);
              lists.delete(key);
            });
            return multi;
          }),
          exec: jest.fn(async () => {
            ops.forEach((op) => op());
            return [];
          }),
        };

        return multi;
      }),
      sadd: jest.fn(async (key: string, ...values: string[]) => {
        const set = sets.get(key) ?? new Set<string>();
        values.forEach((value) => set.add(value));
        sets.set(key, set);
        return set.size;
      }),
      scard: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
      spop: jest.fn(async (key: string, count: number) => {
        const set = sets.get(key) ?? new Set<string>();
        const values = [...set].slice(0, count);
        values.forEach((value) => set.delete(value));
        return values;
      }),
      del: jest.fn(async (key: string) => {
        hashes.delete(key);
        lists.delete(key);
        sets.delete(key);
        return 1;
      }),
      lrange: jest.fn(async (key: string) => lists.get(key) ?? []),
      llen: jest.fn(async (key: string) => lists.get(key)?.length ?? 0),
    };

    return redis as any;
  };

  const createService = () => {
    const redis = createRedis();
    const redisService = {
      getOrThrow: jest.fn(() => redis),
    } as any;
    const historyQueue = {
      add: jest.fn(async (_name, _data, opts) => ({ id: opts.jobId })),
      getJob: jest.fn().mockResolvedValue(null),
    } as any;

    return {
      service: new CollabHistoryService(redisService, historyQueue),
      historyQueue,
    };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('moves content history due time after repeated changes', async () => {
    const { service, historyQueue } = createService();
    const delayedJob = {
      getState: jest.fn().mockResolvedValue('delayed'),
      changeDelay: jest.fn(),
    };

    historyQueue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(delayedJob);

    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);
    jest.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);

    expect(historyQueue.add).toHaveBeenCalledWith(
      QueueJob.PAGE_HISTORY,
      { pageId: 'page-1' },
      expect.objectContaining({
        jobId: 'page-1',
        delay: 300_000,
        removeOnComplete: true,
      }),
    );
    expect(delayedJob.changeDelay).toHaveBeenCalledWith(300_000);
  });

  it('caps content history delay by the max dirty window', async () => {
    const { service, historyQueue } = createService();
    const delayedJob = {
      getState: jest.fn().mockResolvedValue('delayed'),
      changeDelay: jest.fn(),
    };

    historyQueue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(delayedJob);

    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);
    jest.setSystemTime(new Date('2026-01-01T00:29:00.000Z'));
    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);

    expect(delayedJob.changeDelay).toHaveBeenCalledWith(60_000);
  });

  it('moves event flush due time without processing the buffer early', async () => {
    const { service, historyQueue } = createService();
    const delayedJob = {
      getState: jest.fn().mockResolvedValue('delayed'),
      changeDelay: jest.fn(),
    };

    historyQueue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(delayedJob);

    await service.enqueuePageHistoryEvent('page-1', {
      changeType: 'database.row.created',
      changeData: { databaseId: 'db-1' },
      actorId: 'actor-1',
    });
    jest.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
    await service.enqueuePageHistoryEvent('page-1', {
      changeType: 'database.row.cells.updated',
      changeData: { databaseId: 'db-1' },
      actorId: 'actor-1',
    });

    const dirtyState = await service.getEventDirtyState('page-1');

    expect(historyQueue.add).toHaveBeenCalledWith(
      QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      { pageId: 'page-1' },
      expect.objectContaining({
        jobId: 'page-history-event-flush-page-1',
        delay: 300_000,
        removeOnComplete: true,
      }),
    );
    expect(delayedJob.changeDelay).toHaveBeenCalledWith(300_000);
    expect(dirtyState?.delayMs).toBe(300_000);
  });
});
