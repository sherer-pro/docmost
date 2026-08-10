import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PageAccessEffect,
  PageRole,
  UserRole,
} from '../../../common/helpers/types/permission';
import { PageAccessMutationService } from './page-access-mutation.service';
import { EventName } from '../../../common/events/event.contants';

describe('PageAccessMutationService', () => {
  const pageRepo = {
    getPageAndDescendants: jest.fn(),
  };
  const pageAccessRuleRepo = {
    upsertUserRuleForPages: jest.fn(),
    upsertGroupRuleForPages: jest.fn(),
    copyRulesFromParentToChild: jest.fn(),
    deleteRulesByPageIds: jest.fn(),
  };
  const pageAccessService = {
    assertCanManageAccess: jest.fn(),
    assertSpaceIsActive: jest.fn(),
  };
  const pageHistoryRecorder = {
    recordPageEvent: jest.fn(),
  };
  const eventEmitter = {
    emit: jest.fn(),
  };
  const page = {
    id: 'page-1',
    spaceId: 'space-1',
    workspaceId: 'workspace-1',
  } as any;
  const actor = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    workspaceId: 'workspace-1',
  } as any;

  let service: PageAccessMutationService;

  beforeEach(() => {
    jest.clearAllMocks();
    pageAccessService.assertSpaceIsActive.mockResolvedValue(undefined);
    pageRepo.getPageAndDescendants.mockResolvedValue([
      { id: 'page-1' },
      { id: 'page-2' },
      { id: 'page-3' },
    ]);

    service = new PageAccessMutationService(
      {} as any,
      pageRepo as any,
      pageAccessRuleRepo as any,
      pageAccessService as any,
      pageHistoryRecorder as any,
      eventEmitter as any,
    );
  });

  it('cascades a user grant, records history, and invalidates embed visibility', async () => {
    jest
      .spyOn(service as any, 'ensureWorkspaceUser')
      .mockResolvedValue({ id: 'user-1', role: UserRole.MEMBER });

    await service.grantUserAccessForSubtree(
      page,
      'user-1',
      PageRole.READER,
      actor,
    );

    expect(pageAccessService.assertCanManageAccess).toHaveBeenCalledWith(
      actor,
      page.workspaceId,
    );
    expect(pageAccessService.assertSpaceIsActive).toHaveBeenCalledWith(
      page.spaceId,
      undefined,
    );
    expect(pageAccessRuleRepo.upsertUserRuleForPages).toHaveBeenCalledWith(
      ['page-1', 'page-2', 'page-3'],
      expect.objectContaining({
        userId: 'user-1',
        effect: PageAccessEffect.ALLOW,
        role: PageRole.READER,
        sourcePageId: page.id,
        actorId: actor.id,
      }),
      undefined,
    );
    expect(pageHistoryRecorder.recordPageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: page.id,
        actorId: actor.id,
        changeType: 'page.access.updated',
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      EventName.PAGE_EMBED_VISIBILITY_CHANGED,
      { workspaceId: page.workspaceId, accessUserIds: ['user-1'] },
    );
  });

  it('rejects access changes in archived spaces before writing rules', async () => {
    pageAccessService.assertSpaceIsActive.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(
      service.grantUserAccessForSubtree(
        page,
        'user-1',
        PageRole.READER,
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageAccessRuleRepo.upsertUserRuleForPages).not.toHaveBeenCalled();
  });

  it('writes a user deny but refuses to close owner or admin access', async () => {
    const ensureWorkspaceUser = jest
      .spyOn(service as any, 'ensureWorkspaceUser')
      .mockResolvedValueOnce({ id: 'owner-1', role: UserRole.OWNER });

    await expect(
      service.closeUserAccessForSubtree(page, 'owner-1', actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    ensureWorkspaceUser.mockResolvedValueOnce({
      id: 'user-1',
      role: UserRole.MEMBER,
    });
    await service.closeUserAccessForSubtree(page, 'user-1', actor);

    expect(pageAccessRuleRepo.upsertUserRuleForPages).toHaveBeenCalledWith(
      ['page-1', 'page-2', 'page-3'],
      expect.objectContaining({
        userId: 'user-1',
        effect: PageAccessEffect.DENY,
        role: null,
      }),
      undefined,
    );
  });

  it('copies parent ACL to a child and clears a subtree ACL', async () => {
    await service.copyParentRulesToChild(
      'parent-1',
      {
        id: 'child-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
      } as any,
      'actor-1',
    );

    expect(pageAccessRuleRepo.copyRulesFromParentToChild).toHaveBeenCalledWith(
      'parent-1',
      'child-1',
      {
        actorId: 'actor-1',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
      },
      undefined,
    );

    await service.clearRulesForSubtree('page-1');
    expect(pageAccessRuleRepo.deleteRulesByPageIds).toHaveBeenCalledWith(
      ['page-1', 'page-2', 'page-3'],
      undefined,
    );
  });
});
