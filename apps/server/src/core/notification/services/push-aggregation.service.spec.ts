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

  const createService = (options?: {
    pushFrequency?: string;
    isUnreadForUser?: boolean;
    unreadCountInWindow?: number;
  }) => {
    const db = {
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({
          settings: {
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
      findDuePending: jest.fn(),
      markAsSent: jest.fn(),
      markAsCancelled: jest.fn(),
    } as any;
    const notificationRepo = {
      isUnreadForUser: jest
        .fn()
        .mockResolvedValue(options?.isUnreadForUser ?? true),
      countUnreadByUserPageInWindow: jest
        .fn()
        .mockResolvedValue(options?.unreadCountInWindow ?? 1),
    } as any;
    const pushService = { sendToUser: jest.fn() } as any;

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

    pushNotificationJobRepo.findDuePending.mockResolvedValue([
      {
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
      },
    ]);

    await service.processDueJobs();

    expect(notificationRepo.countUnreadByUserPageInWindow).toHaveBeenCalledTimes(1);
    expect(pushService.sendToUser).not.toHaveBeenCalled();
    expect(pushNotificationJobRepo.markAsCancelled).toHaveBeenCalledWith(['job-1']);
    expect(pushNotificationJobRepo.markAsSent).toHaveBeenCalledWith([]);
  });
});
