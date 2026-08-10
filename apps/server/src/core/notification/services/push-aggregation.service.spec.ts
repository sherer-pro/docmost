import { PushAggregationService } from './push-aggregation.service';
import { PushAggregationMetricsService } from './push-aggregation-metrics.service';

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
    revision: 1,
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

  const claim = (jobs: any[]) => ({
    leaseToken: 'lease-1',
    jobs,
    reclaimed: 0,
  });

  it('carries the claim owner and row revision through finalization', async () => {
    const { service, pushNotificationJobRepo } = createService();

    pushNotificationJobRepo.claimDuePending.mockResolvedValue({
      leaseToken: 'lease-1',
      jobs: [dueJob],
      reclaimed: 0,
    });

    await service.processDueJobs();

    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      leaseToken: 'lease-1',
      sent: [{ id: 'job-1', revision: 1 }],
      cancelled: [],
      retry: [],
    });
  });

  it('fails closed when the processing lease is lost during delivery', async () => {
    jest.useFakeTimers();

    try {
      const { service, pushService, pushNotificationJobRepo } = createService();
      let resolveDelivery: ((result: unknown) => void) | undefined;

      pushNotificationJobRepo.claimDuePending.mockResolvedValue(
        claim([dueJob]),
      );
      pushNotificationJobRepo.renewLease.mockResolvedValue(false);
      pushService.sendToUser.mockReturnValue(
        new Promise((resolve) => {
          resolveDelivery = resolve;
        }),
      );

      const processing = service.processDueJobs();
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
      expect(pushService.sendToUser).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(pushNotificationJobRepo.renewLease).toHaveBeenCalledWith(
        ['job-1'],
        'lease-1',
        120_000,
      );

      resolveDelivery?.({
        sent: 1,
        failed: 0,
        revoked: 0,
        outcome: 'success',
      });
      await processing;

      expect(pushNotificationJobRepo.finalizeClaimed).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

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
      renewLease: jest.fn().mockResolvedValue(true),
      finalizeClaimed: jest.fn().mockResolvedValue({
        sent: 0,
        cancelled: 0,
        retried: 0,
        superseded: 0,
      }),
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
      new PushAggregationMetricsService(),
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
    const { service, pushService, notificationDeliveryPolicyService } =
      createService({
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

  it('persists only transiently failed subscriptions for an immediate retry', async () => {
    const { service, pushService, pushNotificationJobRepo } = createService({
      pushFrequency: 'immediate',
    });
    pushService.sendToUser.mockResolvedValue({
      sent: 1,
      failed: 1,
      revoked: 0,
      outcome: 'transient-failure',
      retrySubscriptionIds: ['subscription-2'],
    });

    await service.dispatchOrAggregate(baseNotification, basePayload);

    expect(pushNotificationJobRepo.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        pageId: 'page-1',
        windowKey: 'immediate:n-1',
        idempotencyKey: 'push-immediate:n-1',
        payload: expect.objectContaining({
          retryMeta: expect.objectContaining({
            subscriptionIds: ['subscription-2'],
          }),
        }),
      }),
    );
  });

  it('aggregates push when frequency is quoted but valid', async () => {
    const { service, pushService, pushNotificationJobRepo } = createService({
      userSettings: {
        preferences: {
          pushEnabled: true,
          pushFrequency: '"3h"',
        },
      },
    });

    await service.dispatchOrAggregate(baseNotification, basePayload);

    expect(pushService.sendToUser).not.toHaveBeenCalled();
    expect(pushNotificationJobRepo.upsertPending).toHaveBeenCalledTimes(1);
  });

  it('cancels delivery in delayed mode if all events are read before sendAfter', async () => {
    const { service, pushService, pushNotificationJobRepo, notificationRepo } =
      createService({ unreadCountInWindow: 0 });

    pushNotificationJobRepo.claimDuePending.mockResolvedValue(claim([dueJob]));

    await service.processDueJobs();

    expect(
      notificationRepo.countUnreadByUserPageInWindow,
    ).toHaveBeenCalledTimes(1);
    expect(pushService.sendToUser).not.toHaveBeenCalled();
    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      leaseToken: 'lease-1',
      sent: [],
      cancelled: [{ id: 'job-1', revision: 1 }],
      retry: [],
    });
  });

  it('cancels delivery in delayed mode when push is disabled before sendAfter', async () => {
    const {
      service,
      pushService,
      pushNotificationJobRepo,
      notificationRepo,
      notificationDeliveryPolicyService,
    } = createService({ shouldSend: false });

    pushNotificationJobRepo.claimDuePending.mockResolvedValue(claim([dueJob]));

    await service.processDueJobs();

    expect(notificationDeliveryPolicyService.shouldSend).toHaveBeenCalledWith({
      channel: 'push',
      userId: 'user-1',
      pageId: 'page-1',
    });
    expect(
      notificationRepo.countUnreadByUserPageInWindow,
    ).not.toHaveBeenCalled();
    expect(pushService.sendToUser).not.toHaveBeenCalled();
    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      leaseToken: 'lease-1',
      sent: [],
      cancelled: [{ id: 'job-1', revision: 1 }],
      retry: [],
    });
  });

  it('does not mark a job as sent on transient delivery failure', async () => {
    const { service, pushService, pushNotificationJobRepo } = createService();

    pushNotificationJobRepo.claimDuePending.mockResolvedValue(claim([dueJob]));
    pushService.sendToUser.mockResolvedValue({
      sent: 1,
      failed: 1,
      revoked: 0,
      outcome: 'transient-failure',
      retrySubscriptionIds: ['subscription-2'],
    });

    await service.processDueJobs();

    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      leaseToken: 'lease-1',
      sent: [],
      cancelled: [],
      retry: [
        {
          id: 'job-1',
          revision: 1,
          retrySubscriptionIds: ['subscription-2'],
        },
      ],
    });
  });

  it('keeps a job pending for retry on complete delivery failure caused by a transient error', async () => {
    const { service, pushService, pushNotificationJobRepo } = createService();

    pushNotificationJobRepo.claimDuePending.mockResolvedValue(claim([dueJob]));
    pushService.sendToUser.mockResolvedValue({
      sent: 0,
      failed: 2,
      revoked: 0,
      outcome: 'transient-failure',
    });

    await service.processDueJobs();

    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      leaseToken: 'lease-1',
      sent: [],
      cancelled: [],
      retry: [{ id: 'job-1', revision: 1 }],
    });
  });

  it('cancels an aggregated job after the third transient failure', async () => {
    const { service, pushService, pushNotificationJobRepo } = createService();

    pushNotificationJobRepo.claimDuePending.mockResolvedValue(
      claim([
        {
          ...dueJob,
          payload: {
            ...dueJob.payload,
            retryMeta: { attempts: 2 },
          },
        },
      ]),
    );
    pushService.sendToUser.mockResolvedValue({
      sent: 0,
      failed: 2,
      revoked: 0,
      outcome: 'transient-failure',
    });

    await service.processDueJobs();

    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      leaseToken: 'lease-1',
      sent: [],
      cancelled: [{ id: 'job-1', revision: 1 }],
      retry: [],
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

    pushNotificationJobRepo.claimDuePending.mockResolvedValue(
      claim([firstWindowJob, secondWindowJob]),
    );
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

    expect(
      notificationRepo.countUnreadByUserPageInWindow,
    ).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      pageId: 'page-1',
      windowStart: new Date('2026-02-01T10:00:00.000Z'),
      windowEnd: new Date('2026-02-01T11:00:00.000Z'),
    });
    expect(
      notificationRepo.countUnreadByUserPageInWindow,
    ).toHaveBeenNthCalledWith(2, {
      userId: 'user-1',
      pageId: 'page-1',
      windowStart: new Date('2026-02-01T11:00:00.000Z'),
      windowEnd: new Date('2026-02-01T12:00:00.000Z'),
    });
    expect(pushService.sendToUser).toHaveBeenCalledTimes(1);
    expect(pushNotificationJobRepo.finalizeClaimed).toHaveBeenCalledWith({
      leaseToken: 'lease-1',
      sent: [{ id: 'job-2', revision: 1 }],
      cancelled: [{ id: 'job-1', revision: 1 }],
      retry: [],
    });
  });
});
