import { BadRequestException } from '@nestjs/common';
import { PageAccessService } from './page-access.service';
import {
  PageAccessEffect,
  PageAccessPrincipalType,
  PageRole,
  SpaceRole,
  UserRole,
} from '../../common/helpers/types/permission';

describe('PageAccessService', () => {
  let service: PageAccessService;

  const pageRepo = {
    findById: jest.fn(),
    getPageAndDescendants: jest.fn(),
  };

  const pageAccessRuleRepo = {
    findUserRule: jest.fn(),
    findGroupRules: jest.fn(),
    upsertUserRuleForPages: jest.fn(),
    upsertGroupRuleForPages: jest.fn(),
    copyRulesFromParentToChild: jest.fn(),
    deleteRulesByPageIds: jest.fn(),
  };

  const groupUserRepo = {
    getGroupIdsByUserId: jest.fn(),
  };

  const spaceMemberRepo = {
    getUserSpaceRoles: jest.fn(),
  };

  const pageHistoryRecorder = {
    recordPageEvent: jest.fn(),
  };

  const page = {
    id: 'page-1',
    spaceId: 'space-1',
    workspaceId: 'workspace-1',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new PageAccessService(
      {} as any,
      pageRepo as any,
      pageAccessRuleRepo as any,
      groupUserRepo as any,
      spaceMemberRepo as any,
      pageHistoryRecorder as any,
    );
  });

  it('grants full bypass capabilities to workspace owner/admin', async () => {
    groupUserRepo.getGroupIdsByUserId.mockResolvedValue([]);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([]);
    pageAccessRuleRepo.findUserRule.mockResolvedValue({
      effect: PageAccessEffect.DENY,
      role: null,
    });
    pageAccessRuleRepo.findGroupRules.mockResolvedValue([]);

    const access = await service.getEffectiveAccess(page, {
      id: 'owner-1',
      role: UserRole.OWNER,
    } as any);

    expect(access.role).toBe(PageRole.WRITER);
    expect(access.isSystemAccess).toBe(true);
    expect(access.sources).toEqual(['system']);
    expect(access.capabilities).toEqual({
      canRead: true,
      canWrite: true,
      canCreateChild: true,
      canMoveDeleteShare: true,
      canManageAccess: true,
    });
  });

  it('applies user rule before group rules', async () => {
    groupUserRepo.getGroupIdsByUserId.mockResolvedValue(['group-1']);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
      { userId: 'user-1', role: SpaceRole.READER },
    ]);
    pageAccessRuleRepo.findUserRule.mockResolvedValue({
      effect: PageAccessEffect.ALLOW,
      role: PageRole.WRITER,
    });
    pageAccessRuleRepo.findGroupRules.mockResolvedValue([
      {
        effect: PageAccessEffect.DENY,
        role: null,
      },
    ]);

    const access = await service.getEffectiveAccess(page, {
      id: 'user-1',
      role: UserRole.MEMBER,
    } as any);

    expect(access.role).toBe(PageRole.WRITER);
    expect(access.denied).toBe(false);
    expect(access.sources).toContain('page_user');
    expect(access.capabilities.canRead).toBe(true);
    expect(access.capabilities.canWrite).toBe(true);
    expect(access.capabilities.canMoveDeleteShare).toBe(false);
  });

  it('resolves group conflicts with deny stronger than allow', async () => {
    groupUserRepo.getGroupIdsByUserId.mockResolvedValue(['group-1', 'group-2']);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
      { userId: 'user-1', role: SpaceRole.READER },
    ]);
    pageAccessRuleRepo.findUserRule.mockResolvedValue(undefined);
    pageAccessRuleRepo.findGroupRules.mockResolvedValue([
      {
        principalType: PageAccessPrincipalType.GROUP,
        effect: PageAccessEffect.ALLOW,
        role: PageRole.WRITER,
      },
      {
        principalType: PageAccessPrincipalType.GROUP,
        effect: PageAccessEffect.DENY,
        role: null,
      },
    ]);

    const access = await service.getEffectiveAccess(page, {
      id: 'user-1',
      role: UserRole.MEMBER,
    } as any);

    expect(access.denied).toBe(true);
    expect(access.role).toBeNull();
    expect(access.capabilities.canRead).toBe(false);
    expect(access.sources).toContain('page_group');
  });

  it('falls back to space role when no page rules exist', async () => {
    groupUserRepo.getGroupIdsByUserId.mockResolvedValue([]);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
      { userId: 'user-1', role: SpaceRole.WRITER },
    ]);
    pageAccessRuleRepo.findUserRule.mockResolvedValue(undefined);
    pageAccessRuleRepo.findGroupRules.mockResolvedValue([]);

    const access = await service.getEffectiveAccess(page, {
      id: 'user-1',
      role: UserRole.MEMBER,
    } as any);

    expect(access.role).toBe(PageRole.WRITER);
    expect(access.sources).toEqual(['space']);
    expect(access.capabilities.canRead).toBe(true);
    expect(access.capabilities.canWrite).toBe(true);
    expect(access.capabilities.canCreateChild).toBe(true);
    expect(access.capabilities.canMoveDeleteShare).toBe(true);
    expect(access.capabilities.canManageAccess).toBe(false);
  });

  it('cascades grant user access to all descendants and records history', async () => {
    const actor = { id: 'admin-1', role: UserRole.ADMIN } as any;
    const ensureWorkspaceUserSpy = jest
      .spyOn(service as any, 'ensureWorkspaceUser')
      .mockResolvedValue({ id: 'user-1', role: UserRole.MEMBER });
    const subtreeSpy = jest
      .spyOn(service as any, 'getSubtreePageIds')
      .mockResolvedValue(['page-1', 'page-2', 'page-3']);

    await service.grantUserAccessForSubtree(
      page,
      'user-1',
      PageRole.READER,
      actor,
    );

    expect(ensureWorkspaceUserSpy).toHaveBeenCalledWith(
      page.workspaceId,
      'user-1',
    );
    expect(subtreeSpy).toHaveBeenCalledWith(page.id);
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
  });

  it('writes user deny on close and rejects close for workspace owner/admin', async () => {
    const actor = { id: 'admin-1', role: UserRole.ADMIN } as any;
    jest
      .spyOn(service as any, 'getSubtreePageIds')
      .mockResolvedValue(['page-1', 'page-2']);

    jest
      .spyOn(service as any, 'ensureWorkspaceUser')
      .mockResolvedValueOnce({ id: 'owner-1', role: UserRole.OWNER });

    await expect(
      service.closeUserAccessForSubtree(page, 'owner-1', actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    (service as any).ensureWorkspaceUser.mockResolvedValueOnce({
      id: 'user-1',
      role: UserRole.MEMBER,
    });

    await service.closeUserAccessForSubtree(page, 'user-1', actor);

    expect(pageAccessRuleRepo.upsertUserRuleForPages).toHaveBeenCalledWith(
      ['page-1', 'page-2'],
      expect.objectContaining({
        userId: 'user-1',
        effect: PageAccessEffect.DENY,
        role: null,
      }),
      undefined,
    );
  });

  it('copies parent ACL to new child and clears ACL by subtree', async () => {
    const subtreeSpy = jest
      .spyOn(service as any, 'getSubtreePageIds')
      .mockResolvedValue(['page-1', 'page-2']);

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

    expect(subtreeSpy).toHaveBeenCalledWith('page-1');
    expect(pageAccessRuleRepo.deleteRulesByPageIds).toHaveBeenCalledWith(
      ['page-1', 'page-2'],
      undefined,
    );
  });
});
