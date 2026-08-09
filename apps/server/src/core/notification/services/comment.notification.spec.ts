import { NotificationType } from '../notification.constants';
import { CommentNotificationService } from './comment.notification';

describe('CommentNotificationService', () => {
  const createDb = () => {
    const db = {
      selectFrom: jest.fn((table: string) => {
        const builder = {
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          executeTakeFirst: jest.fn(async () => {
            if (table === 'users') {
              return { id: 'actor-1', name: 'Alice' };
            }

            if (table === 'pages') {
              return { id: 'page-1', title: 'Roadmap', slugId: 'roadmap' };
            }

            if (table === 'spaces') {
              return { id: 'space-1', slug: 'docs' };
            }

            return null;
          }),
          execute: jest.fn(async () => [
            { creatorId: 'thread-author-1' },
            { creatorId: 'thread-author-2' },
            { creatorId: 'actor-1' },
          ]),
        };

        return builder;
      }),
    };

    return db as any;
  };

  const createService = () => {
    const notificationService = {
      createWithImmediateEmail: jest.fn(async (data) => ({
        ...data,
        id: `notification-${notificationService.createWithImmediateEmail.mock.calls.length}`,
      })),
      getUserLocale: jest.fn().mockResolvedValue('en-US'),
    } as any;
    const watcherRepo = {
      getPageWatcherIds: jest.fn().mockResolvedValue([]),
    } as any;
    const pushAggregationService = {
      dispatchOrAggregate: jest.fn(),
    } as any;
    const pageAccessService = {
      filterUsersWithPageReadAccess: jest.fn(
        async (_pageId, userIds) => userIds,
      ),
    } as any;
    const recipientResolverService = {
      resolvePageRoleRecipients: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new CommentNotificationService(
      createDb(),
      notificationService,
      watcherRepo,
      pushAggregationService,
      pageAccessService,
      recipientResolverService,
    );

    return {
      service,
      notificationService,
      watcherRepo,
      pageAccessService,
      recipientResolverService,
    };
  };

  const createRootJob = (overrides = {}) =>
    ({
      eventId: 'event-1',
      commentId: 'comment-1',
      pageId: 'page-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      actorId: 'actor-1',
      mentionedUserIds: [],
      notifyWatchers: true,
      ...overrides,
    }) as any;

  const createdPayloads = (notificationService: any) =>
    notificationService.createWithImmediateEmail.mock.calls.map(
      ([payload]) => payload,
    );

  it('notifies root comment watchers and page roles once', async () => {
    const {
      service,
      notificationService,
      watcherRepo,
      recipientResolverService,
    } = createService();
    watcherRepo.getPageWatcherIds.mockResolvedValue([
      'watcher-1',
      'role-1',
      'actor-1',
    ]);
    recipientResolverService.resolvePageRoleRecipients.mockResolvedValue([
      'role-1',
      'role-2',
    ]);

    await service.processComment(createRootJob(), 'https://example.test');

    const payloads = createdPayloads(notificationService);
    expect(payloads).toHaveLength(3);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'watcher-1',
          type: NotificationType.COMMENT_CREATED,
        }),
        expect.objectContaining({
          userId: 'role-1',
          type: NotificationType.COMMENT_CREATED,
        }),
        expect.objectContaining({
          userId: 'role-2',
          type: NotificationType.COMMENT_CREATED,
        }),
      ]),
    );
    expect(payloads).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: 'actor-1' })]),
    );
  });

  it('deduplicates mentioned users from root comment recipients', async () => {
    const {
      service,
      notificationService,
      watcherRepo,
      recipientResolverService,
    } = createService();
    watcherRepo.getPageWatcherIds.mockResolvedValue(['watcher-1']);
    recipientResolverService.resolvePageRoleRecipients.mockResolvedValue([
      'role-1',
    ]);

    await service.processComment(
      createRootJob({
        mentionedUserIds: ['role-1', 'mention-1'],
      }),
      'https://example.test',
    );

    const payloads = createdPayloads(notificationService);
    expect(payloads).toHaveLength(3);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'role-1',
          type: NotificationType.COMMENT_USER_MENTION,
        }),
        expect.objectContaining({
          userId: 'mention-1',
          type: NotificationType.COMMENT_USER_MENTION,
        }),
        expect.objectContaining({
          userId: 'watcher-1',
          type: NotificationType.COMMENT_CREATED,
        }),
      ]),
    );
    expect(payloads).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'role-1',
          type: NotificationType.COMMENT_CREATED,
        }),
      ]),
    );
  });

  it('does not notify watchers or page roles for replies', async () => {
    const {
      service,
      notificationService,
      watcherRepo,
      recipientResolverService,
    } = createService();

    await service.processComment(
      createRootJob({
        parentCommentId: 'parent-comment-1',
        notifyWatchers: false,
      }),
      'https://example.test',
    );

    const payloads = createdPayloads(notificationService);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'thread-author-1',
          type: NotificationType.COMMENT_REPLY,
        }),
        expect.objectContaining({
          userId: 'thread-author-2',
          type: NotificationType.COMMENT_REPLY,
        }),
      ]),
    );
    expect(payloads).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: 'actor-1' })]),
    );
    expect(watcherRepo.getPageWatcherIds).not.toHaveBeenCalled();
    expect(
      recipientResolverService.resolvePageRoleRecipients,
    ).not.toHaveBeenCalled();
  });
});
