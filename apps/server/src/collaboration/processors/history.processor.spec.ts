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
    collabHistory.takeBufferedEventsForProcessing.mockResolvedValue([]);
    collabHistory.hasBufferedEvents.mockResolvedValue(false);
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
