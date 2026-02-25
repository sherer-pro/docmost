import { PushAggregationService } from './push-aggregation.service';

describe('PushAggregationService', () => {
  const baseNotification = {
    id: 'n-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    pageId: 'page-1',
    type: 'page-mention',
  } as any;

  const basePayload = {
    title: 'title',
    body: 'body',
    url: '/doc',
    type: 'page-mention',
    notificationId: 'n-1',
  };

  const dueJob = {
    id: 'job-1',
    userId: 'user-1',
    pageId: 'page-1',
    windowKey: '1h:2026-02-01T10:00:00.000Z',
    sendAfter: new Date('2026-02-01T11:00:00.000Z'),
    eventsCount: 2,
    payload: {
      title: 'title',
      body: 'Doc title',
      url: '/doc',
      type: 'page-updated',
    },
  };

  const createService = (options?: {
    pushFrequency?: string;
    isUnreadForUser?: boolean;
    unreadCountInWindow?: number;
    userSettings?: unknown;
  }) => {
    const db = {
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({
          settings:
            typeof options?.userSettings !== 'undefined'
              ? options.userSettings
              : {
                  preferences: {
                    pushEnabled: true,
                    pushFrequency: options?.pushFrequency ?? 'immediate',
                  },
                },
        }),
      }),
    } as any;

    const notificationQueue = { add: jest.fn() } as any;
    const pushNotificationJobRepo = {
      upsertPending: jest.fn(),
      claimDuePending: jest.fn(),
      finalizeClaimed: jest.fn(),
    } as any;
    const notificationRepo = {
      isUnreadForUser: jest
        .fn()
        .mockResolvedValue(options?.isUnreadForUser ?? true),
      countUnreadByUserPageInWindow: jest
        .fn()
        .mockResolvedValue(options?.unreadCountInWindow ?? 1),
    } as any;
    const pushService = {
      sendToUser: jest.fn().mockResolvedValue({
        sent: 1,
        failed: 0,
        revoked: 0,
        outcome: 'success',
      }),
    } as any;

    const service = new PushAggregationService(
      db,
      notificationQueue,
      pushNotificationJobRepo,
      notificationRepo,
      pushService,
    );

    return {
      service,
      pushService,
      pushNotificationJobRepo,
      notificationRepo,
    };
  };


  it('использует продуктовый дефолт для пользователя без settings.preferences', async () => {
    const { service, pushService, notificationRepo } = createService({
      userSettings: {},
    });

    await service.dispatchOrAggregate(baseNotification, basePayload);

    expect(pushService.sendToUser).not.toHaveBeenCalled();
    expect(notificationRepo.isUnreadForUser).not.toHaveBeenCalled();
  });

  it('не отправляет immediate push, если связанное уведомление уже прочитано', async () => {
    const { service, pushService, notificationRepo } = createService({
      pushFrequency: 'immediate',
      isUnreadForUser: false,
    });

    await service.dispatchOrAggregate(baseNotification, basePayload);

    expect(notificationRepo.isUnreadForUser).toHaveBeenCalledWith('n-1', 'user-1');
    expect(pushService.sendToUser).not.toHaveBeenCalled();
  });

  it('в delayed режиме отменяет отправку, если до send_after все события прочитаны', async () => {
    const { service, pushService, pushNotificationJobRepo, notificationRepo } =
      createService({ unreadCountInWindow: 0 });

    pushNotificationJobRepo.claimDuePending.mockResolvedValue([dueJob]);

    await service.processDueJobs();

    expect(notificationRepo.countUnreadByUserPageInWindow).toHaveBeenCalledTimes(1);
    expect(pushService.sendToUser).not.toHaveBeenCalled();
    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      sentIds: [],
      cancelledIds: ['job-1'],
      retryIds: [],
    });
  });

  it('не помечает job как sent при временной ошибке отправки', async () => {
    const { service, pushService, pushNotificationJobRepo } = createService();

    pushNotificationJobRepo.claimDuePending.mockResolvedValue([dueJob]);
    pushService.sendToUser.mockResolvedValue({
      sent: 1,
      failed: 1,
      revoked: 0,
      outcome: 'transient-failure',
    });

    await service.processDueJobs();

    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      sentIds: [],
      cancelledIds: [],
      retryIds: ['job-1'],
    });
  });

  it('оставляет job в pending для retry при полной недоставке из-за временной ошибки', async () => {
    const { service, pushService, pushNotificationJobRepo } = createService();

    pushNotificationJobRepo.claimDuePending.mockResolvedValue([dueJob]);
    pushService.sendToUser.mockResolvedValue({
      sent: 0,
      failed: 2,
      revoked: 0,
      outcome: 'transient-failure',
    });

    await service.processDueJobs();

    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      sentIds: [],
      cancelledIds: [],
      retryIds: ['job-1'],
    });
  });

  it('обрабатывает соседние окна как полуинтервалы [start, end) без пересечения на границе', async () => {
    const { service, pushService, pushNotificationJobRepo, notificationRepo } =
      createService();

    const firstWindowJob = {
      ...dueJob,
      id: 'job-1',
      windowKey: '1h:2026-02-01T10:00:00.000Z',
      sendAfter: new Date('2026-02-01T11:00:00.000Z'),
    };
    const secondWindowJob = {
      ...dueJob,
      id: 'job-2',
      windowKey: '1h:2026-02-01T11:00:00.000Z',
      sendAfter: new Date('2026-02-01T12:00:00.000Z'),
    };

    pushNotificationJobRepo.claimDuePending.mockResolvedValue([
      firstWindowJob,
      secondWindowJob,
    ]);
    notificationRepo.countUnreadByUserPageInWindow.mockImplementation(
      ({ windowStart, windowEnd }) => {
        if (
          windowStart.toISOString() === '2026-02-01T10:00:00.000Z' &&
          windowEnd.toISOString() === '2026-02-01T11:00:00.000Z'
        ) {
          return Promise.resolve(0);
        }

        if (
          windowStart.toISOString() === '2026-02-01T11:00:00.000Z' &&
          windowEnd.toISOString() === '2026-02-01T12:00:00.000Z'
        ) {
          return Promise.resolve(1);
        }

        return Promise.resolve(0);
      },
    );

    await service.processDueJobs();

    expect(notificationRepo.countUnreadByUserPageInWindow).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      pageId: 'page-1',
      windowStart: new Date('2026-02-01T10:00:00.000Z'),
      windowEnd: new Date('2026-02-01T11:00:00.000Z'),
    });
    expect(notificationRepo.countUnreadByUserPageInWindow).toHaveBeenNthCalledWith(2, {
      userId: 'user-1',
      pageId: 'page-1',
      windowStart: new Date('2026-02-01T11:00:00.000Z'),
      windowEnd: new Date('2026-02-01T12:00:00.000Z'),
    });
    expect(pushService.sendToUser).toHaveBeenCalledTimes(1);
    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      sentIds: ['job-2'],
      cancelledIds: ['job-1'],
      retryIds: [],
    });
  });
});
