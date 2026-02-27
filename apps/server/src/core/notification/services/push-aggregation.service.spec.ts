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
    shouldSend?: boolean;
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
    const notificationDeliveryPolicyService = {
      shouldSend: jest.fn().mockResolvedValue(options?.shouldSend ?? true),
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
      notificationDeliveryPolicyService,
    );

    return {
      service,
      pushService,
      pushNotificationJobRepo,
      notificationRepo,
      notificationDeliveryPolicyService,
    };
  };


  it('uses delivery policy before immediate push dispatch', async () => {
    const { service, pushService, notificationDeliveryPolicyService } = createService({
      pushFrequency: 'immediate',
      shouldSend: false,
    });

    await service.dispatchOrAggregate(baseNotification, basePayload);

    expect(notificationDeliveryPolicyService.shouldSend).toHaveBeenCalledWith({
      channel: 'push',
      userId: 'user-1',
      notificationId: 'n-1',
      pageId: 'page-1',
      actorId: undefined,
      spaceId: undefined,
    });
    expect(pushService.sendToUser).not.toHaveBeenCalled();
  });

  it('cancels delivery in delayed mode if all events are read before sendAfter', async () => {
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

  it('does not mark a job as sent on transient delivery failure', async () => {
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

  it('keeps a job pending for retry on complete delivery failure caused by a transient error', async () => {
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

  it('treats adjacent windows as half-open intervals [start, end) without boundary overlap', async () => {
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
