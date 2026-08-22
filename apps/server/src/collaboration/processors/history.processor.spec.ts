jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { HistoryProcessor } from './history.processor';
import { QueueJob } from '../../integrations/queue/constants';

describe('HistoryProcessor buffered page events', () => {
  const pageHistoryRepo = {
    findPageLastHistory: jest.fn(),
    saveHistory: jest.fn(),
    insertPageHistoryIdempotent: jest.fn(),
    deleteExpiredHistoryBatch: jest.fn(),
  };
  const pageRepo = {
    findById: jest.fn(),
  };
  const collabHistory = {
    clearContributors: jest.fn(),
    popContributors: jest.fn(),
    addContributors: jest.fn(),
    takeBufferedEventsForProcessing: jest.fn(),
    acknowledgeBufferedProcessingEvents: jest.fn(),
    hasBufferedEvents: jest.fn(),
    scheduleEventFlush: jest.fn(),
    getProcessingEventBatchId: jest.fn(),
    scheduleEventBatchRecovery: jest.fn(),
    listRecoverableEventBatches: jest.fn(),
    listRecoverableDirtyStates: jest.fn(),
    recoverLegacyUnindexedHistory: jest.fn(),
    deferEventBatchRecovery: jest.fn(),
    getContentDirtyState: jest.fn(),
    getEventDirtyState: jest.fn(),
    clearContentDirtyState: jest.fn(),
    clearEventDirtyState: jest.fn(),
    scheduleContentHistoryFlush: jest.fn(),
  };
  const watcherService = {
    addPageWatchers: jest.fn(),
  };
  const transaction = {};
  const db = {
    transaction: jest.fn(() => ({
      execute: jest.fn(async (callback) => callback(transaction)),
    })),
  };
  const outboxRepo = {
    enqueue: jest.fn(),
  };
  const historyQueue = {
    add: jest.fn(),
  };

  const processor = new HistoryProcessor(
    pageHistoryRepo as any,
    pageRepo as any,
    collabHistory as any,
    watcherService as any,
    db as any,
    outboxRepo as any,
    historyQueue as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    collabHistory.getContentDirtyState.mockResolvedValue(null);
    collabHistory.getEventDirtyState.mockResolvedValue(null);
    collabHistory.clearContentDirtyState.mockResolvedValue(true);
    collabHistory.clearEventDirtyState.mockResolvedValue(true);
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue(null);
    collabHistory.acknowledgeBufferedProcessingEvents.mockResolvedValue(true);
    collabHistory.hasBufferedEvents.mockResolvedValue(false);
    collabHistory.getProcessingEventBatchId.mockResolvedValue(null);
    collabHistory.scheduleEventBatchRecovery.mockResolvedValue(undefined);
    collabHistory.listRecoverableEventBatches.mockResolvedValue([]);
    collabHistory.listRecoverableDirtyStates.mockResolvedValue([]);
    collabHistory.recoverLegacyUnindexedHistory.mockResolvedValue(undefined);
    collabHistory.deferEventBatchRecovery.mockResolvedValue(undefined);
    pageHistoryRepo.findPageLastHistory.mockResolvedValue(null);
    pageHistoryRepo.saveHistory.mockResolvedValue({ id: 'history-1' });
    pageHistoryRepo.insertPageHistoryIdempotent.mockResolvedValue({
      history: { id: 'history-event-1' },
      inserted: true,
    });
    pageHistoryRepo.deleteExpiredHistoryBatch.mockResolvedValue(0);
    pageRepo.findById.mockReset();
    outboxRepo.enqueue.mockResolvedValue('outbox-1');
    historyQueue.add.mockResolvedValue(undefined);
  });

  it('reschedules content history when the dirty session is not due', async () => {
    collabHistory.getContentDirtyState.mockResolvedValue({
      firstDirtyAt: 1_000,
      lastDirtyAt: 2_000,
      idleWindowMs: 300_000,
      maxWindowMs: 1_800_000,
      dueAt: 302_000,
      delayMs: 120_000,
    });

    await processor.process({
      name: QueueJob.PAGE_HISTORY,
      data: { pageId: 'page-1' },
    } as any);

    expect(collabHistory.scheduleContentHistoryFlush).toHaveBeenCalledWith(
      'page-1',
    );
    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(pageHistoryRepo.saveHistory).not.toHaveBeenCalled();
  });

  it('writes content history and sends one document changed notification when due', async () => {
    collabHistory.getContentDirtyState.mockResolvedValue({
      firstDirtyAt: 1_000,
      lastDirtyAt: 2_000,
      idleWindowMs: 300_000,
      maxWindowMs: 1_800_000,
      dueAt: 302_000,
      delayMs: 0,
    });
    collabHistory.popContributors.mockResolvedValue(['user-2']);
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      lastUpdatedById: 'actor-1',
      creatorId: 'creator-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });

    await processor.process({
      name: QueueJob.PAGE_HISTORY,
      data: { pageId: 'page-1' },
    } as any);

    expect(pageHistoryRepo.saveHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'page-1' }),
      { contributorIds: ['user-2'], trx: transaction },
    );
    expect(outboxRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'notification_dispatch',
        dedupeKey: `notification-dispatch:${QueueJob.PAGE_RECIPIENT_NOTIFICATION}:history-1`,
        payload: expect.objectContaining({
          jobName: QueueJob.PAGE_RECIPIENT_NOTIFICATION,
          jobData: expect.objectContaining({
            eventId: 'history-1',
            reason: 'document-changed',
            actorId: 'actor-1',
            pageId: 'page-1',
          }),
        }),
      }),
      transaction,
    );
    expect(collabHistory.clearContentDirtyState).toHaveBeenCalledWith(
      'page-1',
      2_000,
    );
  });

  it('fails the history transaction when durable notification dispatch cannot be written', async () => {
    collabHistory.getContentDirtyState.mockResolvedValue({
      firstDirtyAt: 1_000,
      lastDirtyAt: 2_000,
      idleWindowMs: 300_000,
      maxWindowMs: 1_800_000,
      dueAt: 302_000,
      delayMs: 0,
    });
    collabHistory.popContributors.mockResolvedValue(['user-2']);
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      content: { type: 'doc', content: [] },
      lastUpdatedById: 'actor-1',
      creatorId: 'creator-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });
    outboxRepo.enqueue.mockRejectedValueOnce(new Error('outbox unavailable'));

    await expect(
      processor.process({
        name: QueueJob.PAGE_HISTORY,
        data: { pageId: 'page-1' },
      } as any),
    ).rejects.toThrow('outbox unavailable');

    expect(pageHistoryRepo.saveHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'page-1' }),
      { contributorIds: ['user-2'], trx: transaction },
    );
    expect(collabHistory.addContributors).toHaveBeenCalledWith('page-1', [
      'user-2',
    ]);
    expect(collabHistory.clearContentDirtyState).not.toHaveBeenCalled();
  });

  it('skips document notification when content matches latest history', async () => {
    const content = { type: 'doc', content: [] };
    collabHistory.getContentDirtyState.mockResolvedValue({
      firstDirtyAt: 1_000,
      lastDirtyAt: 2_000,
      idleWindowMs: 300_000,
      maxWindowMs: 1_800_000,
      dueAt: 302_000,
      delayMs: 0,
    });
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      content,
      lastUpdatedById: 'actor-1',
      creatorId: 'creator-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });
    pageHistoryRepo.findPageLastHistory.mockResolvedValue({ content });

    await processor.process({
      name: QueueJob.PAGE_HISTORY,
      data: { pageId: 'page-1' },
    } as any);

    expect(pageHistoryRepo.saveHistory).not.toHaveBeenCalled();
    expect(outboxRepo.enqueue).not.toHaveBeenCalled();
    expect(collabHistory.clearContentDirtyState).toHaveBeenCalledWith(
      'page-1',
      2_000,
    );
  });

  it('reschedules buffered event history when the dirty session is not due', async () => {
    collabHistory.getEventDirtyState.mockResolvedValue({
      firstDirtyAt: 1_000,
      lastDirtyAt: 2_000,
      idleWindowMs: 300_000,
      maxWindowMs: 1_800_000,
      dueAt: 302_000,
      delayMs: 120_000,
    });

    await processor.process({
      name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      data: { pageId: 'page-1' },
    } as any);

    expect(collabHistory.scheduleEventFlush).toHaveBeenCalledWith('page-1');
    expect(
      collabHistory.takeBufferedEventsForProcessing,
    ).not.toHaveBeenCalled();
    expect(pageHistoryRepo.insertPageHistoryIdempotent).not.toHaveBeenCalled();
  });

  it('writes one combined history record preserving event order', async () => {
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue({
      batchId: 'batch-1',
      events: [
        {
          changeType: 'database.row.created',
          changeData: { databaseId: 'db-1', row: { pageId: 'row-1' } },
          actorId: 'user-1',
          createdAt: '2026-03-08T10:00:00.000Z',
        },
        {
          changeType: 'database.row.cells.updated',
          changeData: {
            databaseId: 'db-1',
            rowContext: { rowPageId: 'row-1' },
          },
          actorId: 'user-2',
          createdAt: '2026-03-08T10:00:10.000Z',
        },
      ],
    });
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Page',
      content: { type: 'doc' },
      icon: null,
      coverPhoto: null,
      lastUpdatedById: 'user-3',
      creatorId: 'user-3',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });

    await processor.process({
      name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      data: { pageId: 'page-1' },
    } as any);

    expect(pageHistoryRepo.insertPageHistoryIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
        sourceBatchId: 'batch-1',
        changeType: 'page.events.combined',
        lastUpdatedById: 'user-2',
        changeData: expect.objectContaining({
          databaseId: 'db-1',
          events: [
            expect.objectContaining({
              changeType: 'database.row.created',
              actorId: 'user-1',
            }),
            expect.objectContaining({
              changeType: 'database.row.cells.updated',
              actorId: 'user-2',
            }),
          ],
        }),
      }),
    );
    expect(
      collabHistory.acknowledgeBufferedProcessingEvents,
    ).toHaveBeenCalledWith('page-1', 'batch-1');
  });

  it('schedules next flush when new events arrive during processing', async () => {
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue({
      batchId: 'batch-2',
      events: [
        {
          changeType: 'database.property.created',
          changeData: { databaseId: 'db-1' },
          actorId: 'user-1',
          createdAt: '2026-03-08T10:00:00.000Z',
        },
      ],
    });
    collabHistory.hasBufferedEvents.mockResolvedValue(true);
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Page',
      content: { type: 'doc' },
      icon: null,
      coverPhoto: null,
      lastUpdatedById: 'user-1',
      creatorId: 'user-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });

    await processor.process({
      name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      data: { pageId: 'page-1' },
    } as any);

    expect(collabHistory.scheduleEventFlush).toHaveBeenCalledWith('page-1');
  });

  it('keeps the stable processing batch for an idempotent retry if insert is ambiguous', async () => {
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue({
      batchId: 'batch-3',
      events: [
        {
          changeType: 'database.property.created',
          changeData: { databaseId: 'db-1' },
          actorId: 'user-1',
          createdAt: '2026-03-08T10:00:00.000Z',
        },
      ],
    });
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Page',
      content: { type: 'doc' },
      icon: null,
      coverPhoto: null,
      lastUpdatedById: 'user-1',
      creatorId: 'user-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });
    pageHistoryRepo.insertPageHistoryIdempotent.mockRejectedValue(
      new Error('insert failed'),
    );

    await expect(
      processor.process({
        name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
        data: { pageId: 'page-1' },
      } as any),
    ).rejects.toThrow('insert failed');

    expect(
      collabHistory.acknowledgeBufferedProcessingEvents,
    ).not.toHaveBeenCalled();
  });

  it('reuses the same source batch after an ambiguous insert failure', async () => {
    const batch = {
      batchId: 'batch-stable',
      events: [
        {
          changeType: 'database.property.created',
          changeData: { databaseId: 'db-1' },
          actorId: 'user-1',
          createdAt: '2026-03-08T10:00:00.000Z',
        },
      ],
    };
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue(batch);
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Page',
      content: { type: 'doc' },
      icon: null,
      coverPhoto: null,
      lastUpdatedById: 'user-1',
      creatorId: 'user-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });
    pageHistoryRepo.insertPageHistoryIdempotent
      .mockRejectedValueOnce(new Error('connection lost after commit'))
      .mockResolvedValueOnce({
        history: { id: 'history-event-1' },
        inserted: false,
      });

    const job = {
      name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      data: { pageId: 'page-1' },
    } as any;
    await expect(processor.process(job)).rejects.toThrow(
      'connection lost after commit',
    );
    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(pageHistoryRepo.insertPageHistoryIdempotent).toHaveBeenCalledTimes(
      2,
    );
    expect(
      pageHistoryRepo.insertPageHistoryIdempotent.mock.calls.map(
        ([input]) => input.sourceBatchId,
      ),
    ).toEqual(['batch-stable', 'batch-stable']);
    expect(
      collabHistory.acknowledgeBufferedProcessingEvents,
    ).toHaveBeenCalledWith('page-1', 'batch-stable');
  });

  it('recovers the same batch after the Bull attempt budget is exhausted', async () => {
    const batch = {
      batchId: 'batch-outage',
      events: [
        {
          changeType: 'database.property.created',
          changeData: { databaseId: 'db-1' },
          actorId: 'user-1',
          createdAt: '2026-03-08T10:00:00.000Z',
        },
      ],
    };
    const persistedBatchIds = new Set<string>();
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue(batch);
    collabHistory.getProcessingEventBatchId.mockResolvedValue(batch.batchId);
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Page',
      content: { type: 'doc' },
      icon: null,
      coverPhoto: null,
      lastUpdatedById: 'user-1',
      creatorId: 'user-1',
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });
    pageHistoryRepo.insertPageHistoryIdempotent
      .mockImplementationOnce(async (input) => {
        persistedBatchIds.add(input.sourceBatchId);
        throw new Error('connection lost after commit');
      })
      .mockRejectedValueOnce(new Error('database outage'))
      .mockImplementationOnce(async (input) => ({
        history: { id: 'history-event-1' },
        inserted: !persistedBatchIds.has(input.sourceBatchId),
      }));

    const initialJob: any = {
      name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      data: { pageId: 'page-1' },
      opts: { attempts: 2 },
      attemptsMade: 0,
      updateData: jest.fn(async (data) => {
        initialJob.data = data;
      }),
    };

    await expect(processor.process(initialJob)).rejects.toThrow(
      'connection lost after commit',
    );
    initialJob.attemptsMade = 1;
    await expect(processor.process(initialJob)).rejects.toThrow(
      'database outage',
    );
    await processor.onError(initialJob);
    expect(collabHistory.scheduleEventBatchRecovery).not.toHaveBeenCalled();

    initialJob.attemptsMade = 2;
    await processor.onError(initialJob);

    expect(initialJob.data.batchId).toBe(batch.batchId);
    expect(collabHistory.scheduleEventBatchRecovery).toHaveBeenCalledWith(
      'page-1',
      batch.batchId,
    );

    await expect(
      processor.process({
        name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
        data: { pageId: 'page-1', batchId: batch.batchId },
      } as any),
    ).resolves.toBeUndefined();

    expect(persistedBatchIds).toEqual(new Set([batch.batchId]));
    expect(
      pageHistoryRepo.insertPageHistoryIdempotent.mock.calls.map(
        ([input]) => input.sourceBatchId,
      ),
    ).toEqual([batch.batchId, batch.batchId, batch.batchId]);
    expect(
      collabHistory.acknowledgeBufferedProcessingEvents,
    ).toHaveBeenCalledTimes(1);
    expect(
      collabHistory.acknowledgeBufferedProcessingEvents,
    ).toHaveBeenCalledWith('page-1', batch.batchId);
  });

  it('fails closed for an unsupported queue job', async () => {
    await expect(
      processor.process({ name: 'retired-history-job', data: {} } as any),
    ).rejects.toThrow('Unsupported history queue job: retired-history-job');
  });

  it('registers hourly retention cleanup with a fixed job id', async () => {
    await processor.onModuleInit();

    expect(historyQueue.add).toHaveBeenCalledWith(
      QueueJob.PAGE_HISTORY_RETENTION_CLEANUP,
      {},
      expect.objectContaining({
        jobId: 'page-history-retention-cleanup',
        repeat: { every: 60 * 60 * 1000 },
      }),
    );
    expect(historyQueue.add).toHaveBeenCalledWith(
      QueueJob.PAGE_HISTORY_EVENT_RECONCILE,
      {},
      expect.objectContaining({
        jobId: 'page-history-event-reconcile',
        repeat: { every: 60_000 },
      }),
    );
  });

  it('recovers without new edits when the final-failure scheduler was unavailable', async () => {
    collabHistory.getProcessingEventBatchId.mockResolvedValue('batch-orphan');
    collabHistory.scheduleEventBatchRecovery
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(undefined);
    collabHistory.listRecoverableEventBatches.mockResolvedValue([
      { pageId: 'page-1', batchId: 'batch-orphan' },
    ]);

    await processor.onError({
      name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
      data: { pageId: 'page-1', batchId: 'batch-orphan' },
      opts: { attempts: 2 },
      attemptsMade: 2,
    } as any);

    await expect(
      processor.process({
        name: QueueJob.PAGE_HISTORY_EVENT_RECONCILE,
        data: {},
      } as any),
    ).resolves.toBeUndefined();

    expect(collabHistory.scheduleEventBatchRecovery).toHaveBeenNthCalledWith(
      2,
      'page-1',
      'batch-orphan',
      0,
    );
    expect(collabHistory.deferEventBatchRecovery).toHaveBeenCalledWith(
      'page-1',
      'batch-orphan',
    );
  });

  it('reschedules indexed dirty states after the initial queue write failed', async () => {
    collabHistory.listRecoverableDirtyStates.mockResolvedValue([
      { kind: 'content', pageId: 'page-content', lastDirtyAt: 1_000 },
      { kind: 'events', pageId: 'page-events', lastDirtyAt: 2_000 },
    ]);

    await expect(
      processor.process({
        name: QueueJob.PAGE_HISTORY_EVENT_RECONCILE,
        data: {},
      } as any),
    ).resolves.toBeUndefined();

    expect(collabHistory.scheduleContentHistoryFlush).toHaveBeenCalledWith(
      'page-content',
    );
    expect(collabHistory.scheduleEventFlush).toHaveBeenCalledWith(
      'page-events',
    );
    expect(collabHistory.recoverLegacyUnindexedHistory).toHaveBeenCalledWith(
      100,
    );
  });

  it('deletes expired history in bounded 500-row batches', async () => {
    pageHistoryRepo.deleteExpiredHistoryBatch
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(12);

    await processor.process({
      name: QueueJob.PAGE_HISTORY_RETENTION_CLEANUP,
      data: {},
    } as any);

    expect(pageHistoryRepo.deleteExpiredHistoryBatch).toHaveBeenCalledTimes(3);
    expect(pageHistoryRepo.deleteExpiredHistoryBatch).toHaveBeenCalledWith(500);
  });

  it('bounds retention cleanup work per run', async () => {
    pageHistoryRepo.deleteExpiredHistoryBatch.mockResolvedValue(500);

    await processor.process({
      name: QueueJob.PAGE_HISTORY_RETENTION_CLEANUP,
      data: {},
    } as any);

    expect(pageHistoryRepo.deleteExpiredHistoryBatch).toHaveBeenCalledTimes(20);
  });

  it('does not clear dirty state when the batch token is stale', async () => {
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue({
      batchId: 'stale-batch',
      events: [],
    });
    collabHistory.acknowledgeBufferedProcessingEvents.mockResolvedValue(false);

    await expect(
      processor.process({
        name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
        data: { pageId: 'page-1' },
      } as any),
    ).rejects.toThrow('Page history event batch ownership changed');

    expect(collabHistory.clearEventDirtyState).not.toHaveBeenCalled();
  });
});
