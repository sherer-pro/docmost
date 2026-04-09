import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  const createService = (options?: {
    shouldSend?: boolean;
    userRecord?: unknown;
  }) => {
    const notificationRepo = {} as any;
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
        db,
      ),
      mailService,
      notificationDeliveryPolicyService,
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
});
