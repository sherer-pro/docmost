import { NotificationDeliveryPolicyService } from './notification-delivery-policy.service';

describe('NotificationDeliveryPolicyService', () => {
  const createService = (options?: {
    userSettings?: unknown;
    isUnread?: boolean;
    usersWithAccess?: Set<string>;
  }) => {
    const db = {
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({
          settings:
            typeof options?.userSettings !== 'undefined'
              ? options.userSettings
              : { preferences: { pushEnabled: true, emailEnabled: true } },
        }),
      }),
    } as any;

    const notificationRepo = {
      isUnreadForUser: jest.fn().mockResolvedValue(options?.isUnread ?? true),
    } as any;

    const spaceMemberRepo = {
      getUserIdsWithSpaceAccess: jest
        .fn()
        .mockResolvedValue(options?.usersWithAccess ?? new Set(['user-1'])),
    } as any;

    return {
      service: new NotificationDeliveryPolicyService(
        db,
        notificationRepo,
        spaceMemberRepo,
      ),
      notificationRepo,
      spaceMemberRepo,
    };
  };

  it('returns false when channel is disabled in user preferences', async () => {
    const { service, notificationRepo } = createService({
      userSettings: { preferences: { pushEnabled: false, emailEnabled: true } },
    });

    const shouldSend = await service.shouldSend({
      channel: 'push',
      userId: 'user-1',
      notificationId: 'n-1',
      pageId: 'page-1',
    });

    expect(shouldSend).toBe(false);
    expect(notificationRepo.isUnreadForUser).not.toHaveBeenCalled();
  });

  it('returns false when notification is already read for immediate delivery', async () => {
    const { service, notificationRepo } = createService({ isUnread: false });

    const shouldSend = await service.shouldSend({
      channel: 'email',
      userId: 'user-1',
      notificationId: 'n-1',
      pageId: 'page-1',
    });

    expect(shouldSend).toBe(false);
    expect(notificationRepo.isUnreadForUser).toHaveBeenCalledWith('n-1', 'user-1');
  });

  it('returns false for actor self-case', async () => {
    const { service, notificationRepo } = createService();

    const shouldSend = await service.shouldSend({
      channel: 'email',
      userId: 'user-1',
      actorId: 'user-1',
      notificationId: 'n-1',
      pageId: 'page-1',
    });

    expect(shouldSend).toBe(false);
    expect(notificationRepo.isUnreadForUser).not.toHaveBeenCalled();
  });

  it('returns false when user has no access to the space', async () => {
    const { service, notificationRepo, spaceMemberRepo } = createService({
      usersWithAccess: new Set<string>(),
    });

    const shouldSend = await service.shouldSend({
      channel: 'push',
      userId: 'user-1',
      spaceId: 'space-1',
      notificationId: 'n-1',
      pageId: 'page-1',
    });

    expect(shouldSend).toBe(false);
    expect(spaceMemberRepo.getUserIdsWithSpaceAccess).toHaveBeenCalledWith(
      ['user-1'],
      'space-1',
    );
    expect(notificationRepo.isUnreadForUser).not.toHaveBeenCalled();
  });
});
