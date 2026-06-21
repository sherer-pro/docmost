import { ConflictException } from '@nestjs/common';
import { QueueJob } from '../../integrations/queue/constants';
import { COMMENT_LIMIT } from './comment.constants';
import { CommentService } from './comment.service';
import { CommentType } from './dto/create-comment.dto';

describe('CommentService', () => {
  const createContent = () =>
    JSON.stringify({
      type: 'doc',
      content: [],
    });

  const createService = () => {
    const commentRepo = {
      findById: jest.fn(),
      countPageComments: jest.fn().mockResolvedValue(0),
      insertComment: jest.fn(),
      updateComment: jest.fn(),
    } as any;

    const pageRepo = {
      findById: jest.fn().mockImplementation((pageId: string) =>
        Promise.resolve({
          id: pageId,
          spaceId: 'space-1',
        }),
      ),
    } as any;

    const trx = { trx: true } as any;
    const db = {
      transaction: jest.fn(() => ({
        execute: jest.fn((callback) => callback(trx)),
      })),
    } as any;

    const generalQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as any;

    const notificationQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new CommentService(
      commentRepo,
      pageRepo,
      db,
      generalQueue,
      notificationQueue,
    );

    return {
      service,
      commentRepo,
      pageRepo,
      db,
      trx,
      generalQueue,
      notificationQueue,
    };
  };

  it('creates root page-level comment when type=page is provided', async () => {
    const { service, commentRepo } = createService();
    commentRepo.insertComment.mockResolvedValue({
      id: 'comment-1',
      workspaceId: 'workspace-1',
    });

    await service.create(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        page: {
          id: 'page-1',
          spaceId: 'space-1',
        } as any,
      },
      {
        pageId: 'page-1',
        content: createContent(),
        type: CommentType.PAGE,
      } as any,
    );

    expect(commentRepo.insertComment).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
        type: CommentType.PAGE,
        parentCommentId: undefined,
      }),
      expect.anything(),
    );
  });

  it('defaults root comment type to inline when type is omitted', async () => {
    const { service, commentRepo } = createService();
    commentRepo.insertComment.mockResolvedValue({
      id: 'comment-2',
      workspaceId: 'workspace-1',
    });

    await service.create(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        page: {
          id: 'page-1',
          spaceId: 'space-1',
        } as any,
      },
      {
        pageId: 'page-1',
        content: createContent(),
      } as any,
    );

    expect(commentRepo.insertComment).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CommentType.INLINE,
      }),
      expect.anything(),
    );
  });

  it('allows creating the 500th page comment and serializes the count with a page lock', async () => {
    const { service, commentRepo, pageRepo, trx } = createService();
    commentRepo.countPageComments.mockResolvedValue(COMMENT_LIMIT - 1);
    commentRepo.insertComment.mockResolvedValue({
      id: 'comment-500',
      workspaceId: 'workspace-1',
    });

    await service.create(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        page: {
          id: 'page-1',
          spaceId: 'space-1',
        } as any,
      },
      {
        pageId: 'page-1',
        content: createContent(),
      } as any,
    );

    expect(pageRepo.findById).toHaveBeenCalledWith('page-1', {
      withLock: true,
      trx,
    });
    expect(commentRepo.countPageComments).toHaveBeenCalledWith('page-1', trx);
    expect(commentRepo.insertComment).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
      }),
      trx,
    );
  });

  it('blocks creating comments after the page reaches the comment limit', async () => {
    const { service, commentRepo, generalQueue, notificationQueue } =
      createService();
    commentRepo.countPageComments.mockResolvedValue(COMMENT_LIMIT);

    await expect(
      service.create(
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          page: {
            id: 'page-1',
            spaceId: 'space-1',
          } as any,
        },
        {
          pageId: 'page-1',
          content: createContent(),
        } as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(commentRepo.insertComment).not.toHaveBeenCalled();
    expect(generalQueue.add).not.toHaveBeenCalled();
    expect(notificationQueue.add).not.toHaveBeenCalled();
  });

  it('queues only comment notification for root comments', async () => {
    const { service, commentRepo, notificationQueue } = createService();
    commentRepo.insertComment.mockResolvedValue({
      id: 'comment-root',
      workspaceId: 'workspace-1',
    });

    await service.create(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        page: {
          id: 'page-1',
          spaceId: 'space-1',
        } as any,
      },
      {
        pageId: 'page-1',
        content: createContent(),
      } as any,
    );

    expect(notificationQueue.add).toHaveBeenCalledTimes(1);
    expect(notificationQueue.add).toHaveBeenCalledWith(
      QueueJob.COMMENT_NOTIFICATION,
      expect.objectContaining({
        commentId: 'comment-root',
        pageId: 'page-1',
        notifyWatchers: true,
      }),
    );
    expect(notificationQueue.add).not.toHaveBeenCalledWith(
      QueueJob.PAGE_RECIPIENT_NOTIFICATION,
      expect.anything(),
    );
  });

  it('inherits parent type for replies and ignores dto.type', async () => {
    const { service, commentRepo } = createService();
    commentRepo.findById.mockResolvedValue({
      id: 'parent-1',
      pageId: 'page-1',
      parentCommentId: null,
      type: CommentType.PAGE,
    });
    commentRepo.insertComment.mockResolvedValue({
      id: 'reply-1',
      workspaceId: 'workspace-1',
    });

    await service.create(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        page: {
          id: 'page-1',
          spaceId: 'space-1',
        } as any,
      },
      {
        pageId: 'page-1',
        parentCommentId: 'parent-1',
        content: createContent(),
        type: CommentType.INLINE,
      } as any,
    );

    expect(commentRepo.insertComment).toHaveBeenCalledWith(
      expect.objectContaining({
        parentCommentId: 'parent-1',
        type: CommentType.PAGE,
      }),
      expect.anything(),
    );
  });

  it('falls back to inline type when parent reply type is null', async () => {
    const { service, commentRepo } = createService();
    commentRepo.findById.mockResolvedValue({
      id: 'parent-2',
      pageId: 'page-1',
      parentCommentId: null,
      type: null,
    });
    commentRepo.insertComment.mockResolvedValue({
      id: 'reply-2',
      workspaceId: 'workspace-1',
    });

    await service.create(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        page: {
          id: 'page-1',
          spaceId: 'space-1',
        } as any,
      },
      {
        pageId: 'page-1',
        parentCommentId: 'parent-2',
        content: createContent(),
        type: CommentType.PAGE,
      } as any,
    );

    expect(commentRepo.insertComment).toHaveBeenCalledWith(
      expect.objectContaining({
        type: CommentType.INLINE,
      }),
      expect.anything(),
    );
  });

  it('resolves comment and enqueues resolved notification', async () => {
    const { service, commentRepo, notificationQueue } = createService();
    commentRepo.findById.mockResolvedValue({
      id: 'comment-3',
      creatorId: 'user-2',
      pageId: 'page-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      resolvedById: 'user-1',
      resolvedAt: new Date(),
    });

    await service.resolve(
      {
        id: 'comment-3',
        creatorId: 'user-2',
        pageId: 'page-1',
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
      } as any,
      {
        commentId: 'comment-3',
        pageId: 'page-1',
        resolved: true,
      },
      {
        id: 'user-1',
      } as any,
    );

    expect(commentRepo.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedById: 'user-1',
      }),
      'comment-3',
    );

    expect(notificationQueue.add).toHaveBeenCalledWith(
      QueueJob.COMMENT_RESOLVED_NOTIFICATION,
      expect.objectContaining({
        commentId: 'comment-3',
        commentCreatorId: 'user-2',
        actorId: 'user-1',
      }),
    );
  });
});
