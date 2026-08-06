import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  const createService = (options?: {
    shouldSend?: boolean;
    userRecord?: unknown;
    insertResult?: unknown;
    listResult?: unknown;
    unreadNotifications?: Array<{ id: string; pageId: string | null }>;
    usersWithPageAccess?: string[];
  }) => {
    const notificationRepo = {
      insert: jest
        .fn()
        .mockResolvedValue(
          typeof options?.insertResult === 'undefined'
            ? { id: 'notification-1', type: 'page.user_mention' }
            : options.insertResult,
        ),
      findByUserId: jest.fn().mockResolvedValue(
        options?.listResult ?? {
          items: [],
          meta: {},
        },
      ),
      findUnreadForUser: jest
        .fn()
        .mockResolvedValue(options?.unreadNotifications ?? []),
    } as any;
    const wsGateway = {
      server: {
        to: jest.fn().mockReturnValue({
          emit: jest.fn(),
        }),
      },
    } as any;
    const mailService = {
      sendToQueue: jest.fn(),
    } as any;
    const notificationDeliveryPolicyService = {
      shouldSend: jest.fn().mockResolvedValue(options?.shouldSend ?? true),
    } as any;
    const pageAccessService = {
      filterUsersWithPageReadAccess: jest
        .fn()
        .mockResolvedValue(options?.usersWithPageAccess ?? ['user-1']),
    } as any;
    const db = {
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue(
          options?.userRecord ?? {
            email: 'john@example.com',
            settings: { preferences: { emailFrequency: 'immediate' } },
          },
        ),
      }),
    } as any;

    return {
      service: new NotificationService(
        notificationRepo,
        wsGateway,
        mailService,
        notificationDeliveryPolicyService,
        pageAccessService,
        db,
      ),
      mailService,
      notificationRepo,
      wsGateway,
      notificationDeliveryPolicyService,
      pageAccessService,
      db,
    };
  };

  it('queues email immediately for immediate frequency', async () => {
    const { service, mailService } = createService();

    await service.queueEmail(
      'user-1',
      'n-1',
      'page-1',
      'actor-1',
      'space-1',
      'Subject',
      {},
    );

    expect(mailService.sendToQueue).toHaveBeenCalledWith({
      to: 'john@example.com',
      subject: 'Subject',
      template: {},
      notificationId: 'n-1',
      notificationUserId: 'user-1',
      notificationDeliveryMode: 'immediate',
      notificationFrequency: 'immediate',
    });
  });

  it('does not queue immediate email when frequency is delayed', async () => {
    const { service, mailService } = createService({
      userRecord: {
        email: 'john@example.com',
        settings: { preferences: { emailFrequency: '3h' } },
      },
    });

    await service.queueEmail(
      'user-1',
      'n-1',
      'page-1',
      'actor-1',
      'space-1',
      'Subject',
      {},
    );

    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });

  it('does not queue immediate email when delayed frequency is quoted', async () => {
    const { service, mailService } = createService({
      userRecord: {
        email: 'john@example.com',
        settings: { preferences: { emailFrequency: '"1h"' } },
      },
    });

    await service.queueEmail(
      'user-1',
      'n-1',
      'page-1',
      'actor-1',
      'space-1',
      'Subject',
      {},
    );

    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });

  it('skips email queueing when delivery policy blocks sending', async () => {
    const { service, mailService, db } = createService({ shouldSend: false });

    await service.queueEmail(
      'user-1',
      'n-1',
      'page-1',
      'actor-1',
      'space-1',
      'Subject',
      {},
    );

    expect(db.selectFrom).not.toHaveBeenCalled();
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });

  it('does not emit or redeliver a notification on a deduplication conflict', async () => {
    const { service, notificationRepo, wsGateway } = createService({
      insertResult: null,
    });

    const result = await service.create(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        type: 'page.user_mention',
      } as any,
      'event-1:user-1',
    );

    expect(result).toBeNull();
    expect(notificationRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ deduplicationKey: 'event-1:user-1' }),
    );
    expect(wsGateway.server.to).not.toHaveBeenCalled();
  });

  it('removes inaccessible page notifications from the in-app response', async () => {
    const restrictedNotification = {
      id: 'notification-1',
      pageId: 'page-1',
      page: { title: 'Private canary title' },
    };
    const { service } = createService({
      listResult: { items: [restrictedNotification], meta: {} },
      usersWithPageAccess: [],
    });

    const result = await service.findByUserId('user-1', {} as any);

    expect(result.items).toEqual([]);
  });

  it('excludes inaccessible page notifications from unread count', async () => {
    const { service } = createService({
      unreadNotifications: [
        { id: 'notification-1', pageId: 'page-1' },
        { id: 'notification-2', pageId: null },
      ],
      usersWithPageAccess: [],
    });

    await expect(service.getUnreadCount('user-1')).resolves.toBe(1);
  });
});
