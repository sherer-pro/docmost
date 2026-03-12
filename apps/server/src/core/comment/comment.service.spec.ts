import { QueueJob } from '../../integrations/queue/constants';
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
      insertComment: jest.fn(),
      updateComment: jest.fn(),
    } as any;

    const pageRepo = {
      findById: jest.fn(),
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
      generalQueue,
      notificationQueue,
    );

    return { service, commentRepo, generalQueue, notificationQueue };
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
