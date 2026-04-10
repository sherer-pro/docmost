import { EmailAggregationService } from './email-aggregation.service';

describe('EmailAggregationService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createService = (options?: {
    pendingUsers?: Array<{
      userId: string;
      workspaceId: string;
      firstPendingAt: Date | string;
    }>;
    notifications?: any[];
    userRecord?: unknown;
  }) => {
    const usersQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirst: jest.fn().mockResolvedValue(
        options?.userRecord ?? {
          email: 'john@example.com',
          settings: {
            preferences: {
              emailEnabled: true,
              emailFrequency: '1h',
            },
          },
        },
      ),
    };

    const workspacesQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirst: jest.fn().mockResolvedValue({
        hostname: 'acme',
      }),
    };

    const db = {
      selectFrom: jest.fn((table: string) => {
        if (table === 'users') {
          return usersQuery;
        }

        return workspacesQuery;
      }),
    } as any;

    const notificationQueue = {
      add: jest.fn(),
    } as any;

    const notificationRepo = {
      findPendingEmailDigestUsers: jest
        .fn()
        .mockResolvedValue(
          options?.pendingUsers ?? [
            {
              userId: 'user-1',
              workspaceId: 'ws-1',
              firstPendingAt: new Date('2026-02-01T10:15:00.000Z'),
            },
          ],
        ),
      findUnreadUnemailedForUserBefore: jest
        .fn()
        .mockResolvedValue(
          options?.notifications ?? [
            {
              id: 'n-1',
              type: 'page.user_mention',
              actor: { name: 'John' },
              page: { title: 'Roadmap', slugId: 'roadmap' },
              space: { slug: 'product' },
            },
          ],
        ),
    } as any;

    const mailService = {
      sendToQueue: jest.fn(),
    } as any;

    const domainService = {
      getUrl: jest.fn().mockReturnValue('https://acme.example.com'),
    } as any;

    return {
      service: new EmailAggregationService(
        db,
        notificationQueue,
        notificationRepo,
        mailService,
        domainService,
      ),
      notificationRepo,
      mailService,
      notificationQueue,
    };
  };

  it('queues a single digest email when the aggregation window is due', async () => {
    jest.setSystemTime(new Date('2026-02-01T12:00:00.000Z'));
    const { service, notificationRepo, mailService } = createService();

    await service.processDueDigests();

    expect(notificationRepo.findUnreadUnemailedForUserBefore).toHaveBeenCalledWith({
      userId: 'user-1',
      windowEnd: new Date('2026-02-01T11:00:00.000Z'),
    });
    expect(mailService.sendToQueue).toHaveBeenCalledTimes(1);
    expect(mailService.sendToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@example.com',
        notificationIds: ['n-1'],
      }),
    );
  });

  it('does not send digest before the aggregation window ends', async () => {
    jest.setSystemTime(new Date('2026-02-01T10:30:00.000Z'));
    const { service, notificationRepo, mailService } = createService();

    await service.processDueDigests();

    expect(notificationRepo.findUnreadUnemailedForUserBefore).not.toHaveBeenCalled();
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });

  it('does not send digest for immediate frequency', async () => {
    jest.setSystemTime(new Date('2026-02-01T12:00:00.000Z'));
    const { service, notificationRepo, mailService } = createService({
      userRecord: {
        email: 'john@example.com',
        settings: {
          preferences: {
            emailEnabled: true,
            emailFrequency: 'immediate',
          },
        },
      },
    });

    await service.processDueDigests();

    expect(notificationRepo.findUnreadUnemailedForUserBefore).not.toHaveBeenCalled();
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });

  it('sends digest when frequency is quoted but valid', async () => {
    jest.setSystemTime(new Date('2026-02-01T12:00:00.000Z'));
    const { service, notificationRepo, mailService } = createService({
      userRecord: {
        email: 'john@example.com',
        settings: {
          preferences: {
            emailEnabled: true,
            emailFrequency: '"1h"',
          },
        },
      },
    });

    await service.processDueDigests();

    expect(notificationRepo.findUnreadUnemailedForUserBefore).toHaveBeenCalledWith({
      userId: 'user-1',
      windowEnd: new Date('2026-02-01T11:00:00.000Z'),
    });
    expect(mailService.sendToQueue).toHaveBeenCalledTimes(1);
  });

  it('does not send digest when email is disabled as a string', async () => {
    jest.setSystemTime(new Date('2026-02-01T12:00:00.000Z'));
    const { service, notificationRepo, mailService } = createService({
      userRecord: {
        email: 'john@example.com',
        settings: {
          preferences: {
            emailEnabled: '"false"',
            emailFrequency: '"1h"',
          },
        },
      },
    });

    await service.processDueDigests();

    expect(notificationRepo.findUnreadUnemailedForUserBefore).not.toHaveBeenCalled();
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });
});
