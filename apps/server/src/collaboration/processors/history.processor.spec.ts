jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { HistoryProcessor } from './history.processor';
import { QueueJob } from '../../integrations/queue/constants';

describe('HistoryProcessor buffered page events', () => {
  const pageHistoryRepo = {
    findPageLastHistory: jest.fn(),
    saveHistory: jest.fn(),
    insertPageHistory: jest.fn(),
  };
  const pageRepo = {
    findById: jest.fn(),
  };
  const collabHistory = {
    clearContributors: jest.fn(),
    popContributors: jest.fn(),
    addContributors: jest.fn(),
    takeBufferedEventsForProcessing: jest.fn(),
    clearBufferedProcessingEvents: jest.fn(),
    requeueBufferedProcessingEvents: jest.fn(),
    hasBufferedEvents: jest.fn(),
    scheduleEventFlush: jest.fn(),
    getContentDirtyState: jest.fn(),
    getEventDirtyState: jest.fn(),
    clearContentDirtyState: jest.fn(),
    clearEventDirtyState: jest.fn(),
    scheduleContentHistoryFlush: jest.fn(),
  };
  const watcherService = {
    addPageWatchers: jest.fn(),
  };
  const notificationQueue = {
    add: jest.fn(),
  };

  const processor = new HistoryProcessor(
    pageHistoryRepo as any,
    pageRepo as any,
    collabHistory as any,
    watcherService as any,
    notificationQueue as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    collabHistory.getContentDirtyState.mockResolvedValue(null);
    collabHistory.getEventDirtyState.mockResolvedValue(null);
    collabHistory.clearContentDirtyState.mockResolvedValue(true);
    collabHistory.clearEventDirtyState.mockResolvedValue(true);
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue([]);
    collabHistory.hasBufferedEvents.mockResolvedValue(false);
    pageHistoryRepo.findPageLastHistory.mockResolvedValue(null);
    pageHistoryRepo.saveHistory.mockResolvedValue({ id: 'history-1' });
    pageHistoryRepo.insertPageHistory.mockResolvedValue(undefined);
    pageRepo.findById.mockReset();
    notificationQueue.add.mockResolvedValue(undefined);
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
      { contributorIds: ['user-2'] },
    );
    expect(notificationQueue.add).toHaveBeenCalledWith(
      QueueJob.PAGE_RECIPIENT_NOTIFICATION,
      expect.objectContaining({
        eventId: 'history-1',
        reason: 'document-changed',
        actorId: 'actor-1',
        pageId: 'page-1',
      }),
    );
    expect(collabHistory.clearContentDirtyState).toHaveBeenCalledWith(
      'page-1',
      2_000,
    );
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
    expect(notificationQueue.add).not.toHaveBeenCalled();
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
    expect(collabHistory.takeBufferedEventsForProcessing).not.toHaveBeenCalled();
    expect(pageHistoryRepo.insertPageHistory).not.toHaveBeenCalled();
  });

  it('writes one combined history record preserving event order', async () => {
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue([
      {
        changeType: 'database.row.created',
        changeData: { databaseId: 'db-1', row: { pageId: 'row-1' } },
        actorId: 'user-1',
        createdAt: '2026-03-08T10:00:00.000Z',
      },
      {
        changeType: 'database.row.cells.updated',
        changeData: { databaseId: 'db-1', rowContext: { rowPageId: 'row-1' } },
        actorId: 'user-2',
        createdAt: '2026-03-08T10:00:10.000Z',
      },
    ]);
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

    expect(pageHistoryRepo.insertPageHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
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
    expect(collabHistory.clearBufferedProcessingEvents).toHaveBeenCalledWith(
      'page-1',
    );
  });

  it('schedules next flush when new events arrive during processing', async () => {
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue([
      {
        changeType: 'database.property.created',
        changeData: { databaseId: 'db-1' },
        actorId: 'user-1',
        createdAt: '2026-03-08T10:00:00.000Z',
      },
    ]);
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

  it('requeues processing buffer if combined history insert fails', async () => {
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue([
      {
        changeType: 'database.property.created',
        changeData: { databaseId: 'db-1' },
        actorId: 'user-1',
        createdAt: '2026-03-08T10:00:00.000Z',
      },
    ]);
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
    pageHistoryRepo.insertPageHistory.mockRejectedValue(new Error('insert failed'));

    await expect(
      processor.process({
        name: QueueJob.PAGE_HISTORY_EVENT_FLUSH,
        data: { pageId: 'page-1' },
      } as any),
    ).rejects.toThrow('insert failed');

    expect(collabHistory.requeueBufferedProcessingEvents).toHaveBeenCalledWith(
      'page-1',
    );
  });
});
