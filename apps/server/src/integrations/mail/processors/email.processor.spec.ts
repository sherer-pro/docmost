import { EmailProcessor } from './email.processor';

describe('EmailProcessor notification delivery recheck', () => {
  const notificationMessage = {
    to: 'recipient@example.com',
    subject: 'Canary page title',
    html: '<p>Canary page title and private snippet</p>',
    notificationId: 'notification-1',
    notificationUserId: 'user-1',
    notificationDeliveryMode: 'immediate' as const,
    notificationFrequency: 'immediate',
  };

  const createProcessor = (options?: {
    notification?: Record<string, unknown>;
    pageAccess?: string[];
    user?: Record<string, unknown> | null;
  }) => {
    const mailService = {
      sendEmail: jest.fn(),
    } as any;
    const notificationRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'notification-1',
        userId: 'user-1',
        actorId: 'actor-1',
        pageId: 'page-1',
        spaceId: 'space-1',
        readAt: null,
        emailedAt: null,
        ...options?.notification,
      }),
      markAsEmailed: jest.fn(),
      markMultipleAsEmailed: jest.fn(),
    } as any;
    const pageAccessService = {
      filterUsersWithPageReadAccess: jest
        .fn()
        .mockResolvedValue(options?.pageAccess ?? ['user-1']),
    } as any;
    const spaceMemberRepo = {
      getUserIdsWithSpaceAccess: jest
        .fn()
        .mockResolvedValue(new Set(['user-1'])),
    } as any;
    const db = {
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue(
          typeof options?.user === 'undefined'
            ? {
                email: 'recipient@example.com',
                settings: {
                  preferences: {
                    emailEnabled: true,
                    emailFrequency: 'immediate',
                  },
                },
              }
            : options.user,
        ),
      }),
    } as any;

    return {
      processor: new EmailProcessor(
        mailService,
        notificationRepo,
        pageAccessService,
        spaceMemberRepo,
        db,
      ),
      mailService,
      notificationRepo,
      pageAccessService,
    };
  };

  it('suppresses a queued email when the notification was read', async () => {
    const { processor, mailService, pageAccessService } = createProcessor({
      notification: { readAt: new Date() },
    });

    await processor.process({ data: notificationMessage } as any);

    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(
      pageAccessService.filterUsersWithPageReadAccess,
    ).not.toHaveBeenCalled();
  });

  it('suppresses a queued email when the notification was archived', async () => {
    const { processor, mailService, pageAccessService } = createProcessor({
      notification: { archivedAt: new Date() },
    });

    await processor.process({ data: notificationMessage } as any);

    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(
      pageAccessService.filterUsersWithPageReadAccess,
    ).not.toHaveBeenCalled();
  });

  it('suppresses the complete queued payload after page access is revoked', async () => {
    const { processor, mailService } = createProcessor({ pageAccess: [] });

    await processor.process({ data: notificationMessage } as any);

    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('suppresses a queued email after the channel is disabled', async () => {
    const { processor, mailService } = createProcessor({
      user: {
        email: 'recipient@example.com',
        settings: {
          preferences: {
            emailEnabled: false,
            emailFrequency: 'immediate',
          },
        },
      },
    });

    await processor.process({ data: notificationMessage } as any);

    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('sends and marks an email only after every recheck passes', async () => {
    const { processor, mailService, notificationRepo } = createProcessor();

    await processor.process({ data: notificationMessage } as any);

    expect(mailService.sendEmail).toHaveBeenCalledWith(notificationMessage);
    expect(notificationRepo.markAsEmailed).toHaveBeenCalledWith(
      'notification-1',
    );
  });

  it('keeps non-notification mail jobs compatible', async () => {
    const { processor, mailService, notificationRepo } = createProcessor();
    const invitation = {
      to: 'invitee@example.com',
      subject: 'Invitation',
      text: 'Join the workspace',
    };

    await processor.process({ data: invitation } as any);

    expect(mailService.sendEmail).toHaveBeenCalledWith(invitation);
    expect(notificationRepo.findById).not.toHaveBeenCalled();
  });
});
