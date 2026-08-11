import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CommentController } from './comment.controller';

describe('CommentController', () => {
  const createController = () => {
    const commentService = { resolve: jest.fn() } as any;
    const commentRepo = {
      findById: jest.fn(),
      hasChildrenFromOtherUsers: jest.fn(),
      deleteComment: jest.fn(),
    } as any;
    const pageRepo = { findById: jest.fn() } as any;
    const pageAccessService = {
      assertCanWritePage: jest.fn().mockResolvedValue({
        capabilities: { canWrite: true },
      }),
      assertCanMoveDeleteShare: jest.fn(),
    } as any;
    const controller = new CommentController(
      commentService,
      commentRepo,
      pageRepo,
      pageAccessService,
    );
    return {
      controller,
      commentService,
      commentRepo,
      pageRepo,
      pageAccessService,
    };
  };

  it('rejects resolving a reply after checking page write access', async () => {
    const {
      controller,
      commentService,
      commentRepo,
      pageRepo,
      pageAccessService,
    } = createController();
    const comment = {
      id: '019fee02-e834-7733-9bee-ccd10e2a6560',
      pageId: '019fee02-e76c-74f6-8fa2-68d4a19b4e56',
      parentCommentId: '019fee02-e800-7000-8000-000000000000',
    };
    commentRepo.findById.mockResolvedValue(comment);
    pageRepo.findById.mockResolvedValue({ id: comment.pageId });

    await expect(
      controller.resolve(
        { commentId: comment.id, pageId: comment.pageId, resolved: true },
        { id: 'user-1' } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(pageAccessService.assertCanWritePage).toHaveBeenCalled();
    expect(commentService.resolve).not.toHaveBeenCalled();
  });

  it('protects replies by other users from owner cascade deletion', async () => {
    const { controller, commentRepo, pageRepo, pageAccessService } =
      createController();
    const comment = {
      id: '019fee02-e834-7733-9bee-ccd10e2a6560',
      pageId: '019fee02-e76c-74f6-8fa2-68d4a19b4e56',
      creatorId: 'user-1',
    };
    commentRepo.findById.mockResolvedValue(comment);
    commentRepo.hasChildrenFromOtherUsers.mockResolvedValue(true);
    pageRepo.findById.mockResolvedValue({ id: comment.pageId });
    pageAccessService.assertCanMoveDeleteShare.mockResolvedValue({
      capabilities: { canMoveDeleteShare: false },
    });

    await expect(
      controller.delete({ commentId: comment.id }, { id: 'user-1' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(commentRepo.deleteComment).not.toHaveBeenCalled();
  });

  it('allows an owner to delete a comment without replies by other users', async () => {
    const { controller, commentRepo, pageRepo, pageAccessService } =
      createController();
    const comment = {
      id: '019fee02-e834-7733-9bee-ccd10e2a6560',
      pageId: '019fee02-e76c-74f6-8fa2-68d4a19b4e56',
      creatorId: 'user-1',
    };
    commentRepo.findById.mockResolvedValue(comment);
    commentRepo.hasChildrenFromOtherUsers.mockResolvedValue(false);
    pageRepo.findById.mockResolvedValue({ id: comment.pageId });

    await controller.delete({ commentId: comment.id }, { id: 'user-1' } as any);

    expect(commentRepo.deleteComment).toHaveBeenCalledWith(comment.id);
    expect(pageAccessService.assertCanMoveDeleteShare).not.toHaveBeenCalled();
  });
});
