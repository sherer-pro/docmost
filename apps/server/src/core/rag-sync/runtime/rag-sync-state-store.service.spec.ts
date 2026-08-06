import {
  FENCED_RAG_SYNC_HSET_SCRIPT,
  RagSyncStateStore,
} from './rag-sync-state-store.service';
import { RagSyncLeaseLostError } from './rag-sync-runtime.types';

function createStore() {
  const redis = {
    status: 'ready',
    on: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    hget: jest.fn(),
    hmget: jest.fn(),
    hscan: jest.fn(),
    hexists: jest.fn(),
    time: jest.fn(),
    eval: jest.fn(),
    zrem: jest.fn(),
    quit: jest.fn(),
    disconnect: jest.fn(),
  };
  const duplicate = jest.fn(() => redis);
  const redisService = {
    getOrThrow: () => ({ duplicate }),
  };
  const config = {
    redisPrefix: 'docmost:rag-sync',
    requestTimeoutMs: 5_000,
    maxConcurrentBindings: 4,
    shutdownTimeoutMs: 1_000,
  };
  return {
    duplicate,
    redis,
    store: new RagSyncStateStore(redisService as any, config as any),
  };
}

describe('RagSyncStateStore', () => {
  const lease = {
    bindingId: 'binding-1',
    targetVersion: 3,
    token: 'lease-token',
  };

  it('uses fail-fast Redis commands for lease fencing', () => {
    const { duplicate } = createStore();

    expect(duplicate).toHaveBeenCalledWith(
      expect.objectContaining({
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 5_000,
        connectTimeout: 5_000,
      }),
    );
  });

  it('bounds shutdown of a partitioned Redis connection', async () => {
    jest.useFakeTimers();
    const { redis, store } = createStore();
    redis.quit.mockReturnValue(new Promise(() => undefined));

    const closing = store.close();
    await jest.advanceTimersByTimeAsync(1_000);
    await closing;

    expect(redis.disconnect).toHaveBeenCalledWith(false);
    jest.useRealTimers();
  });

  it('uses the v2 namespace and fences checkpoint writes with the lease token', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);

    await store.setCheckpoint(lease, 'updates', 123);

    expect(redis.eval).toHaveBeenCalledWith(
      FENCED_RAG_SYNC_HSET_SCRIPT,
      2,
      'docmost:rag-sync:v2:lock:binding-1',
      'docmost:rag-sync:v2:state:binding-1:3:checkpoints',
      'lease-token',
      'updates',
      '123',
    );
  });

  it('rejects a stale owner when Redis refuses a fenced write', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(0);

    await expect(
      store.setScopeFingerprint(lease, 'fingerprint'),
    ).rejects.toBeInstanceOf(RagSyncLeaseLostError);
  });

  it('serializes an admin operation without reserving a database connection', async () => {
    const { redis, store } = createStore();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    const callback = jest.fn().mockResolvedValue('done');

    await expect(
      store.runExclusive('workspace-1', 'space-1', callback),
    ).resolves.toBe('done');

    expect(callback).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(redis.set).toHaveBeenCalledWith(
      'docmost:rag-sync:v2:admin-lock:workspace-1:space-1',
      expect.any(String),
      'PX',
      30_000,
      'NX',
    );
  });

  it('rejects a concurrent admin operation with a bounded busy error', async () => {
    const { redis, store } = createStore();
    redis.set.mockResolvedValue(null);

    await expect(
      store.runExclusive('workspace-1', 'space-1', jest.fn()),
    ).rejects.toMatchObject({ reason: 'busy' });
  });

  it('reserves global runtime capacity only for a target test', async () => {
    const { redis, store } = createStore();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);

    await store.runExclusive(
      'workspace-1',
      'space-1',
      jest.fn().mockResolvedValue(undefined),
      { reserveGlobalSlot: true },
    );

    expect(redis.eval.mock.calls[0][0]).toContain("redis.call('TIME')");
    expect(redis.eval.mock.calls[0]).toEqual([
      expect.any(String),
      1,
      'docmost:rag-sync:v2:global-slots',
      4,
      expect.stringMatching(/^admin-/),
      30_000,
    ]);
    expect(redis.zrem).toHaveBeenCalledWith(
      'docmost:rag-sync:v2:global-slots',
      expect.stringMatching(/^admin-/),
    );
  });

  it('keeps emergency control operations available when runtime slots are full', async () => {
    const { redis, store } = createStore();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    const callback = jest.fn().mockResolvedValue('disabled');

    await expect(
      store.runExclusive('workspace-1', 'space-1', callback),
    ).resolves.toBe('disabled');

    expect(callback).toHaveBeenCalled();
    expect(redis.zrem).not.toHaveBeenCalled();
  });

  it('isolates corrupt mapping entries instead of failing the binding', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);
    redis.hscan.mockResolvedValue([
      '0',
      [
        'broken:1',
        '{not-json',
        'page:1',
        JSON.stringify({ identity: 'page:1', fileId: 'file-1' }),
      ],
    ]);

    await expect(store.scanMappings(lease, '0', 100)).resolves.toEqual({
      cursor: '0',
      items: [],
      hasMore: false,
      ackToken: null,
    });
    expect(redis.eval).toHaveBeenCalledTimes(3);
  });

  it('replays unacknowledged HSCAN batches, refreshes live values, and clears completed overflow', async () => {
    const { redis, store } = createStore();
    const mappings = [1, 2, 3, 4].map((value) => ({
      identity: `page:page-${value}`,
      fileId: `file-${value}`,
      operationId: String(value).repeat(64),
      contentHash: String(value + 3).repeat(64),
      sourceType: 'page' as const,
      sourceId: `page-${value}`,
      pageId: `page-${value}`,
      updatedAtMs: value,
    }));
    const liveMappings = new Map(
      mappings.map((mapping) => [mapping.identity, mapping]),
    );
    let overflowRaw: string | null = null;
    redis.hget.mockImplementation(async (key: string) =>
      key.endsWith(':scan-overflows') ? overflowRaw : null,
    );
    redis.hmget.mockImplementation(async (_key: string, ...fields: string[]) =>
      fields.map((field) => {
        const mapping = liveMappings.get(field);
        return mapping ? JSON.stringify(mapping) : null;
      }),
    );
    redis.eval.mockImplementation(async (...args: unknown[]) => {
      if (String(args[3]).endsWith(':scan-overflows')) {
        overflowRaw = args.length === 7 ? String(args[6]) : null;
      }
      return 1;
    });
    redis.hscan
      .mockResolvedValueOnce([
        '0',
        mappings
          .slice(0, 3)
          .flatMap((mapping) => [mapping.identity, JSON.stringify(mapping)]),
      ])
      .mockResolvedValueOnce([
        '0',
        [mappings[3].identity, JSON.stringify(mappings[3])],
      ]);

    const first = await store.scanMappings(lease, '0', 2, 'bounded-test');
    expect(first).toEqual({
      cursor: '0',
      items: mappings.slice(0, 2),
      hasMore: true,
      ackToken: expect.any(String),
    });

    const refreshed = { ...mappings[0], updatedAtMs: 99 };
    liveMappings.set(refreshed.identity, refreshed);
    await expect(
      store.scanMappings(lease, '0', 2, 'bounded-test'),
    ).resolves.toEqual({
      cursor: '0',
      items: [refreshed, mappings[1]],
      hasMore: true,
      ackToken: first.ackToken,
    });

    await store.ackScanBatch(
      lease,
      'mappings',
      'bounded-test',
      first.ackToken!,
    );
    const tail = await store.scanMappings(lease, '0', 2, 'bounded-test');
    expect(tail).toEqual({
      cursor: '0',
      items: [mappings[2]],
      hasMore: true,
      ackToken: expect.any(String),
    });
    await store.ackScanBatch(lease, 'mappings', 'bounded-test', tail.ackToken!);
    await expect(
      store.scanMappings(lease, '0', 2, 'bounded-test'),
    ).resolves.toEqual({
      cursor: '0',
      items: [],
      hasMore: false,
      ackToken: null,
    });
    expect(overflowRaw).toBeNull();

    liveMappings.set(mappings[3].identity, mappings[3]);
    await expect(
      store.scanMappings(lease, '0', 2, 'bounded-test'),
    ).resolves.toEqual({
      cursor: '0',
      items: [mappings[3]],
      hasMore: true,
      ackToken: expect.any(String),
    });
    expect(redis.hscan).toHaveBeenCalledTimes(2);
  });

  it('stores resumable database work in the target-version namespace', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);
    const progress = {
      operation: 'upsert',
      databaseId: 'database-1',
      pageId: 'page-1',
      sourceUpdatedAtMs: 123,
      phase: 'rows',
      rowCursor: 'row-cursor-99',
      mappingCursor: '0',
      mappingChangedInPass: false,
    } as const;

    await store.setDatabaseWorkProgress(lease, progress);

    expect(redis.eval).toHaveBeenCalledWith(
      FENCED_RAG_SYNC_HSET_SCRIPT,
      2,
      'docmost:rag-sync:v2:lock:binding-1',
      'docmost:rag-sync:v2:state:binding-1:3:feed-progress',
      'lease-token',
      'database:upsert:database-1',
      JSON.stringify(progress),
    );
  });

  it('stores drain confirmation in fenced target-version state', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);

    await store.setDrainEmptyObservedAt(lease, 4, 123);

    expect(redis.eval).toHaveBeenCalledWith(
      FENCED_RAG_SYNC_HSET_SCRIPT,
      2,
      'docmost:rag-sync:v2:lock:binding-1',
      'docmost:rag-sync:v2:state:binding-1:3:feed-progress',
      'lease-token',
      'drain-empty-observed-at',
      JSON.stringify({ configVersion: 4, observedAt: 123 }),
    );
  });

  it('stores upload intents in lease-fenced target-version state', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);
    const intent = {
      operationId: 'a'.repeat(64),
      identity: 'page:page-1',
      sourceType: 'page' as const,
      sourceId: 'page-1',
      pageId: 'page-1',
      configVersion: 4,
      createdAt: 123,
      notBefore: 456,
    };

    await store.setUploadIntent(lease, intent);

    expect(redis.eval).toHaveBeenCalledWith(
      FENCED_RAG_SYNC_HSET_SCRIPT,
      2,
      'docmost:rag-sync:v2:lock:binding-1',
      'docmost:rag-sync:v2:state:binding-1:3:upload-intents',
      'lease-token',
      intent.operationId,
      JSON.stringify(intent),
    );
  });

  it('scans upload intents without loading the full Redis hash', async () => {
    const { redis, store } = createStore();
    const intent = {
      operationId: 'a'.repeat(64),
      identity: 'page:page-1',
      sourceType: 'page' as const,
      sourceId: 'page-1',
      pageId: 'page-1',
      configVersion: 4,
      createdAt: 123,
      notBefore: 456,
    };
    redis.hscan.mockResolvedValue([
      '17',
      [intent.operationId, JSON.stringify(intent)],
    ]);
    redis.eval.mockResolvedValue(1);
    redis.hmget.mockResolvedValue([JSON.stringify(intent)]);

    await expect(store.scanUploadIntents(lease, '0', 100)).resolves.toEqual({
      cursor: '0',
      items: [intent],
      hasMore: true,
      ackToken: expect.any(String),
    });
    expect(redis.hscan).toHaveBeenCalledWith(
      'docmost:rag-sync:v2:state:binding-1:3:upload-intents',
      '0',
      'COUNT',
      100,
    );
  });

  it('isolates concurrent intent scan barriers by operation id', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);
    const first = 'a'.repeat(64);
    const second = 'b'.repeat(64);

    await Promise.all([
      store.markRemoteScanFileIds(
        lease,
        { kind: 'intent', operationId: first },
        ['1'.repeat(16)],
      ),
      store.markRemoteScanFileIds(
        lease,
        { kind: 'intent', operationId: second },
        ['2'.repeat(16)],
      ),
    ]);

    const keys = redis.eval.mock.calls.map((call) => call[3]).sort();
    expect(keys).toEqual([
      `docmost:rag-sync:v2:state:binding-1:3:remote-scan-seen:intent:${first}`,
      `docmost:rag-sync:v2:state:binding-1:3:remote-scan-seen:intent:${second}`,
    ]);
  });

  it('checks Knowledge membership in the completed remote scan', async () => {
    const { redis, store } = createStore();
    redis.hexists.mockResolvedValue(1);

    await expect(
      store.wasRemoteScanFileIdSeen(lease, 'reconcile', 'a'.repeat(16)),
    ).resolves.toBe(true);
    expect(redis.hexists).toHaveBeenCalledWith(
      'docmost:rag-sync:v2:state:binding-1:3:remote-scan-seen:reconcile',
      'a'.repeat(16),
    );
  });

  it('uses Redis TIME as the runtime safety clock', async () => {
    const { redis, store } = createStore();
    redis.time.mockResolvedValue(['123', '456789']);

    await expect(store.getTimeMs()).resolves.toBe(123_456);
  });

  it('stores the Redis-time drain start in fenced state', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);

    await store.setDrainStartedAt(lease, 4, 123);

    expect(redis.eval).toHaveBeenCalledWith(
      FENCED_RAG_SYNC_HSET_SCRIPT,
      2,
      'docmost:rag-sync:v2:lock:binding-1',
      'docmost:rag-sync:v2:state:binding-1:3:feed-progress',
      'lease-token',
      'drain-started-at',
      JSON.stringify({ configVersion: 4, observedAt: 123 }),
    );
  });

  it('discards drain confirmation from an older config generation', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);
    redis.hget.mockResolvedValue(
      JSON.stringify({ configVersion: 3, observedAt: 123 }),
    );

    await expect(store.getDrainEmptyObservedAt(lease, 4)).resolves.toBeNull();

    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('drops corrupt database progress and schedules reconciliation', async () => {
    const { redis, store } = createStore();
    redis.eval.mockResolvedValue(1);
    redis.hget.mockResolvedValue(
      JSON.stringify({
        operation: 'upsert',
        databaseId: 'database-1',
        pageId: 'page-1',
        sourceUpdatedAtMs: 123,
        phase: 'rows',
        rowCursor: 42,
        mappingCursor: '0',
        mappingChangedInPass: false,
      }),
    );

    await expect(
      store.getDatabaseWorkProgress(lease, 'upsert', 'database-1'),
    ).resolves.toBeNull();
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });
});
