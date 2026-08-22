import { QueueJob } from '../../integrations/queue/constants';
import { CollabHistoryService } from './collab-history.service';

describe('CollabHistoryService dirty history scheduling', () => {
  const createRedis = () => {
    const hashes = new Map<string, Map<string, string>>();
    const lists = new Map<string, string[]>();
    const sets = new Map<string, Set<string>>();
    const strings = new Map<string, string>();
    const sortedSets = new Map<string, Map<string, number>>();

    const getHash = (key: string) => {
      const existing = hashes.get(key);
      if (existing) {
        return existing;
      }

      const next = new Map<string, string>();
      hashes.set(key, next);
      return next;
    };

    const markDirty = (
      dirtyKey: string,
      indexKey: string,
      nowValue: string,
      idleWindowValue: string,
      maxWindowValue: string,
      member: string,
    ) => {
      const hash = getHash(dirtyKey);
      const now = Number(nowValue);
      if (!hash.has('firstDirtyAt')) {
        hash.set('firstDirtyAt', nowValue);
      }
      if (!hash.has('idleWindowMs')) {
        hash.set('idleWindowMs', idleWindowValue);
      }
      if (!hash.has('maxWindowMs')) {
        hash.set('maxWindowMs', maxWindowValue);
      }
      const previousLastDirtyAt = Number(hash.get('lastDirtyAt') ?? -1);
      const lastDirtyAt = Math.max(now, previousLastDirtyAt + 1);
      hash.set('lastDirtyAt', String(lastDirtyAt));
      const dueAt = Math.min(
        now + Number(hash.get('idleWindowMs')),
        Number(hash.get('firstDirtyAt')) + Number(hash.get('maxWindowMs')),
      );
      hash.set('dueAt', String(dueAt));
      const index = sortedSets.get(indexKey) ?? new Map<string, number>();
      index.set(member, dueAt);
      sortedSets.set(indexKey, index);
      return [lastDirtyAt, dueAt];
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
      eval: jest.fn(
        async (script: string, keyCount: number, ...args: string[]) => {
          if (keyCount === 3 && script.includes("redis.call('RPUSH'")) {
            const [
              bufferKey,
              dirtyKey,
              indexKey,
              event,
              now,
              idle,
              max,
              member,
            ] = args;
            const list = lists.get(bufferKey) ?? [];
            list.push(event);
            lists.set(bufferKey, list);
            return markDirty(dirtyKey, indexKey, now, idle, max, member);
          }

          if (keyCount === 2 && script.includes('local now = tonumber')) {
            const [dirtyKey, indexKey, now, idle, max, member] = args;
            return markDirty(dirtyKey, indexKey, now, idle, max, member);
          }

          if (keyCount === 2 && script.includes("redis.call('DEL', KEYS[1])")) {
            const [dirtyKey, indexKey, expectedLastDirtyAt, member] = args;
            const hash = hashes.get(dirtyKey);
            if (hash?.get('lastDirtyAt') === expectedLastDirtyAt) {
              hashes.delete(dirtyKey);
              sortedSets.get(indexKey)?.delete(member);
              return 1;
            }

            return 0;
          }

          if (keyCount === 2 && script.includes("redis.call('ZADD'")) {
            const [
              dirtyKey,
              indexKey,
              expectedLastDirtyAt,
              recoveryAt,
              member,
            ] = args;
            if (
              hashes.get(dirtyKey)?.get('lastDirtyAt') !== expectedLastDirtyAt
            ) {
              return 0;
            }
            const index = sortedSets.get(indexKey) ?? new Map<string, number>();
            index.set(member, Number(recoveryAt));
            sortedSets.set(indexKey, index);
            return 1;
          }

          if (keyCount === 4 && script.includes("redis.call('RENAME'")) {
            const [
              bufferKey,
              processingKey,
              batchKey,
              indexKey,
              nextBatchId,
              recoveryAt,
              pageId,
            ] = args;
            if (lists.has(processingKey)) {
              const existingBatchId = strings.get(batchKey);
              if (existingBatchId) {
                const index = sortedSets.get(indexKey) ?? new Map();
                index.set(`${pageId}|${existingBatchId}`, Number(recoveryAt));
                sortedSets.set(indexKey, index);
                return existingBatchId;
              }
              strings.set(batchKey, nextBatchId);
              const index = sortedSets.get(indexKey) ?? new Map();
              index.set(`${pageId}|${nextBatchId}`, Number(recoveryAt));
              sortedSets.set(indexKey, index);
              return nextBatchId;
            }

            if (!lists.has(bufferKey)) {
              strings.delete(batchKey);
              return '';
            }

            strings.set(batchKey, nextBatchId);
            lists.set(processingKey, lists.get(bufferKey) ?? []);
            lists.delete(bufferKey);
            const index = sortedSets.get(indexKey) ?? new Map();
            index.set(`${pageId}|${nextBatchId}`, Number(recoveryAt));
            sortedSets.set(indexKey, index);
            return nextBatchId;
          }

          if (keyCount === 3) {
            const [processingKey, batchKey, indexKey, batchId, pageId] = args;
            if (strings.get(batchKey) !== batchId) {
              return 0;
            }

            lists.delete(processingKey);
            strings.delete(batchKey);
            sortedSets.get(indexKey)?.delete(`${pageId}|${batchId}`);
            return 1;
          }

          if (keyCount === 3 && script.includes("redis.call('LRANGE'")) {
            const [processingKey, bufferKey, batchKey, batchId] = args;
            if (strings.get(batchKey) !== batchId) {
              return 0;
            }

            const processing = lists.get(processingKey) ?? [];
            const buffered = lists.get(bufferKey) ?? [];
            if (processing.length > 0) {
              lists.set(bufferKey, [...processing, ...buffered]);
            }
            lists.delete(processingKey);
            strings.delete(batchKey);
            return 1;
          }

          return 0;
        },
      ),
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
              strings.delete(key);
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
        strings.delete(key);
        return 1;
      }),
      lrange: jest.fn(async (key: string) => lists.get(key) ?? []),
      llen: jest.fn(async (key: string) => lists.get(key)?.length ?? 0),
      get: jest.fn(async (key: string) => strings.get(key) ?? null),
      persist: jest.fn(async () => 1),
      zadd: jest.fn(async (key: string, ...args: Array<string | number>) => {
        const useNx = args[0] === 'NX';
        const score = Number(args[useNx ? 1 : 0]);
        const member = String(args[useNx ? 2 : 1]);
        const sortedSet = sortedSets.get(key) ?? new Map<string, number>();
        if (useNx && sortedSet.has(member)) {
          return 0;
        }
        sortedSet.set(member, Number(score));
        sortedSets.set(key, sortedSet);
        return 1;
      }),
      zrem: jest.fn(async (key: string, member: string) => {
        const removed = sortedSets.get(key)?.delete(member) ?? false;
        return removed ? 1 : 0;
      }),
      zrangebyscore: jest.fn(
        async (
          key: string,
          _minimum: string,
          maximum: number,
          _limit: string,
          offset: number,
          count: number,
        ) =>
          [...(sortedSets.get(key)?.entries() ?? [])]
            .filter(([, score]) => score <= Number(maximum))
            .sort((left, right) => left[1] - right[1])
            .slice(offset, offset + count)
            .map(([member]) => member),
      ),
      scan: jest.fn(
        async (
          _cursor: string,
          _match: string,
          pattern: string,
          _count: string,
          count: number,
        ) => {
          const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
          const keys = new Set([
            ...hashes.keys(),
            ...lists.keys(),
            ...strings.keys(),
          ]);
          return [
            '0',
            [...keys].filter((key) => key.startsWith(prefix)).slice(0, count),
          ];
        },
      ),
      strings,
      sortedSets,
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
      redis,
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

  it('keeps one fixed successor while the primary page job is active', async () => {
    const { service, historyQueue } = createService();

    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);

    const activeJob = {
      getState: jest.fn().mockResolvedValue('active'),
    };
    const successorJob = {
      getState: jest.fn().mockResolvedValue('delayed'),
      changeDelay: jest.fn(),
    };
    let successorLookupCount = 0;
    historyQueue.getJob.mockImplementation(async (jobId: string) => {
      if (jobId === 'page-1') return activeJob;
      if (jobId === 'page-1-successor') {
        successorLookupCount += 1;
        return successorLookupCount === 1 ? null : successorJob;
      }
      return null;
    });

    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);
    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);

    const successorAdds = historyQueue.add.mock.calls.filter(
      ([, , options]) => options.jobId === 'page-1-successor',
    );
    expect(successorAdds).toHaveLength(1);
    expect(successorJob.changeDelay).toHaveBeenCalledWith(300_000);
  });

  it('coalesces delayed recovery for one stable event batch', async () => {
    const { service, historyQueue } = createService();
    const delayedRecovery = {
      getState: jest.fn().mockResolvedValue('delayed'),
      changeDelay: jest.fn(),
    };
    historyQueue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(delayedRecovery);

    await service.scheduleEventBatchRecovery('page-1', 'batch-1');
    await service.scheduleEventBatchRecovery('page-1', 'batch-1');

    expect(historyQueue.add).toHaveBeenCalledTimes(1);
    expect(historyQueue.add).toHaveBeenCalledWith(
      QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      { pageId: 'page-1', batchId: 'batch-1' },
      expect.objectContaining({
        jobId: 'page-history-event-recovery-page-1-batch-1',
        delay: 60_000,
        removeOnComplete: true,
      }),
    );
    expect(delayedRecovery.changeDelay).toHaveBeenCalledWith(60_000);
  });

  it('recovers the same processing batch until its token is acknowledged', async () => {
    const { service } = createService();
    await service.enqueuePageHistoryEvent('page-1', {
      changeType: 'database.row.created',
      changeData: { databaseId: 'db-1' },
      actorId: 'actor-1',
    });

    const first = await service.takeBufferedEventsForProcessing('page-1');
    const recovered = await service.takeBufferedEventsForProcessing('page-1');

    expect(first).not.toBeNull();
    expect(recovered).toEqual(first);
    await expect(
      service.acknowledgeBufferedProcessingEvents('page-1', 'stale-token'),
    ).resolves.toBe(false);
    await expect(
      service.acknowledgeBufferedProcessingEvents('page-1', first!.batchId),
    ).resolves.toBe(true);
    await expect(
      service.takeBufferedEventsForProcessing('page-1'),
    ).resolves.toBeNull();
  });

  it('keeps a claimed batch identity stable while later events remain buffered', async () => {
    const { service } = createService();
    await service.enqueuePageHistoryEvent('page-1', {
      changeType: 'event.first',
      changeData: {},
    });
    const firstBatch = await service.takeBufferedEventsForProcessing('page-1');
    await service.enqueuePageHistoryEvent('page-1', {
      changeType: 'event.later',
      changeData: {},
    });

    const retried = await service.takeBufferedEventsForProcessing('page-1');
    expect(retried).toEqual(firstBatch);
    await service.acknowledgeBufferedProcessingEvents(
      'page-1',
      firstBatch!.batchId,
    );
    const nextBatch = await service.takeBufferedEventsForProcessing('page-1');
    expect(nextBatch?.batchId).not.toBe(firstBatch?.batchId);
    expect(nextBatch?.events.map((event) => event.changeType)).toEqual([
      'event.later',
    ]);
  });

  it('keeps a processing marker recoverable beyond the former buffer TTL', async () => {
    const { service } = createService();
    await service.enqueuePageHistoryEvent('page-1', {
      changeType: 'event.first',
      changeData: {},
    });
    const batch = await service.takeBufferedEventsForProcessing('page-1');

    jest.advanceTimersByTime(31 * 60 * 1000);

    await expect(service.listRecoverableEventBatches(100)).resolves.toEqual([
      { pageId: 'page-1', batchId: batch!.batchId },
    ]);
    await service.acknowledgeBufferedProcessingEvents('page-1', batch!.batchId);
    await expect(service.listRecoverableEventBatches(100)).resolves.toEqual([]);
  });

  it('indexes event and content dirty state before an initial queue failure', async () => {
    const { service, historyQueue, redis } = createService();
    historyQueue.add.mockRejectedValue(new Error('queue unavailable'));

    await expect(
      service.enqueuePageHistoryEvent('page-event', {
        changeType: 'database.row.created',
        changeData: { databaseId: 'db-1' },
      }),
    ).rejects.toThrow('queue unavailable');
    await expect(
      service.enqueuePageContentHistory('page-content', 300_000, 1_800_000),
    ).rejects.toThrow('queue unavailable');

    expect(redis.lists.get('history:events:buffer:page-event')).toHaveLength(1);
    jest.advanceTimersByTime(300_001);

    await expect(service.listRecoverableDirtyStates(100)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'events', pageId: 'page-event' }),
        expect.objectContaining({ kind: 'content', pageId: 'page-content' }),
      ]),
    );
  });

  it('does not clear a same-millisecond dirty update with an older token', async () => {
    const { service } = createService();

    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);
    const firstState = await service.getContentDirtyState('page-1');
    await service.enqueuePageContentHistory('page-1', 300_000, 1_800_000);
    const secondState = await service.getContentDirtyState('page-1');

    expect(secondState!.lastDirtyAt).toBeGreaterThan(firstState!.lastDirtyAt);
    await expect(
      service.clearContentDirtyState('page-1', firstState!.lastDirtyAt),
    ).resolves.toBe(false);
    await expect(
      service.clearContentDirtyState('page-1', secondState!.lastDirtyAt),
    ).resolves.toBe(true);

    jest.advanceTimersByTime(2_000_000);
    await expect(service.listRecoverableDirtyStates(100)).resolves.toEqual([]);
  });

  it('adopts legacy processing and unindexed buffer keys after upgrade', async () => {
    const { service, redis } = createService();
    const legacyEvent = JSON.stringify({
      changeType: 'database.row.created',
      changeData: { databaseId: 'db-1' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    redis.lists.set('history:events:processing:legacy-processing', [
      legacyEvent,
    ]);
    redis.lists.set('history:events:buffer:legacy-buffer', [legacyEvent]);

    await service.recoverLegacyUnindexedHistory(100);

    const adoptedBatchId =
      await service.getProcessingEventBatchId('legacy-processing');
    expect(adoptedBatchId).toEqual(expect.any(String));
    await expect(
      service.takeBufferedEventsForProcessing('legacy-processing'),
    ).resolves.toEqual(
      expect.objectContaining({
        batchId: adoptedBatchId,
        events: [
          expect.objectContaining({ changeType: 'database.row.created' }),
        ],
      }),
    );
    await expect(service.getEventDirtyState('legacy-buffer')).resolves.toEqual(
      expect.objectContaining({ delayMs: 300_000 }),
    );

    jest.advanceTimersByTime(300_001);
    await expect(service.listRecoverableDirtyStates(100)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'events', pageId: 'legacy-buffer' }),
      ]),
    );
  });
});
