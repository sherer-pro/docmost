import { BadRequestException, ForbiddenException } from '@nestjs/common';
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

  const environmentService = {
    isDebugMode: jest.fn(() => false),
  };

  const page = {
    id: 'page-1',
    spaceId: 'space-1',
    workspaceId: 'workspace-1',
  } as any;

  function createSelectQueryMock(rows: any[]) {
    const query = {
      selectAll: jest.fn(() => query),
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      execute: jest.fn().mockResolvedValue(rows),
      executeTakeFirst: jest.fn().mockResolvedValue(rows[0]),
    };

    return query;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    service = new PageAccessService(
      {} as any,
      pageRepo as any,
      pageAccessRuleRepo as any,
      groupUserRepo as any,
      spaceMemberRepo as any,
      pageHistoryRecorder as any,
      environmentService as any,
      { emit: jest.fn() } as any,
    );

    jest.spyOn(service as any, 'getSpaceArchivedAt').mockResolvedValue(null);
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
      workspaceId: 'workspace-1',
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
      workspaceId: 'workspace-1',
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
      workspaceId: 'workspace-1',
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
      workspaceId: 'workspace-1',
    } as any);

    expect(access.role).toBe(PageRole.WRITER);
    expect(access.sources).toEqual(['space']);
    expect(access.capabilities.canRead).toBe(true);
    expect(access.capabilities.canWrite).toBe(true);
    expect(access.capabilities.canCreateChild).toBe(true);
    expect(access.capabilities.canMoveDeleteShare).toBe(true);
    expect(access.capabilities.canManageAccess).toBe(false);
  });

  it('keeps archived spaces readable but read-only for workspace bypass users', async () => {
    (service as any).getSpaceArchivedAt.mockResolvedValueOnce(new Date());
    groupUserRepo.getGroupIdsByUserId.mockResolvedValue([]);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([]);
    pageAccessRuleRepo.findUserRule.mockResolvedValue(undefined);
    pageAccessRuleRepo.findGroupRules.mockResolvedValue([]);

    const access = await service.getEffectiveAccess(page, {
      id: 'owner-1',
      role: UserRole.OWNER,
      workspaceId: 'workspace-1',
    } as any);

    expect(access.capabilities).toEqual({
      canRead: true,
      canWrite: false,
      canCreateChild: false,
      canMoveDeleteShare: false,
      canManageAccess: false,
    });
  });

  it('denies workspace bypass when page belongs to another workspace', async () => {
    const access = await service.getEffectiveAccess(page, {
      id: 'owner-2',
      role: UserRole.OWNER,
      workspaceId: 'workspace-2',
    } as any);

    expect(access.isSystemAccess).toBe(false);
    expect(access.capabilities.canRead).toBe(false);
    expect(access.capabilities.canWrite).toBe(false);
    expect(groupUserRepo.getGroupIdsByUserId).not.toHaveBeenCalled();
    expect(spaceMemberRepo.getUserSpaceRoles).not.toHaveBeenCalled();
    expect(pageAccessRuleRepo.findUserRule).not.toHaveBeenCalled();
  });

  it('batches effective access checks for multiple pages', async () => {
    const userRuleQuery = createSelectQueryMock([
      {
        pageId: 'page-1',
        principalType: PageAccessPrincipalType.USER,
        userId: 'user-1',
        effect: PageAccessEffect.ALLOW,
        role: PageRole.WRITER,
      },
    ]);
    const groupRuleQuery = createSelectQueryMock([
      {
        pageId: 'page-2',
        principalType: PageAccessPrincipalType.GROUP,
        groupId: 'group-1',
        effect: PageAccessEffect.ALLOW,
        role: PageRole.READER,
      },
    ]);
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(userRuleQuery)
        .mockReturnValueOnce(groupRuleQuery),
    };
    const batchService = new PageAccessService(
      db as any,
      pageRepo as any,
      pageAccessRuleRepo as any,
      groupUserRepo as any,
      spaceMemberRepo as any,
      pageHistoryRecorder as any,
      environmentService as any,
      { emit: jest.fn() } as any,
    );
    jest
      .spyOn(batchService as any, 'getSpaceArchivedAt')
      .mockResolvedValue(null);
    groupUserRepo.getGroupIdsByUserId.mockResolvedValue(['group-1']);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
      { userId: 'user-1', role: SpaceRole.READER },
    ]);

    const accessByPageId = await batchService.getEffectiveAccessForPages(
      [
        page,
        {
          id: 'page-2',
          spaceId: 'space-1',
          workspaceId: 'workspace-1',
        },
      ] as any[],
      {
        id: 'user-1',
        role: UserRole.MEMBER,
        workspaceId: 'workspace-1',
      } as any,
    );

    expect(accessByPageId.get('page-1')?.role).toBe(PageRole.WRITER);
    expect(accessByPageId.get('page-2')?.role).toBe(PageRole.READER);
    expect(accessByPageId.get('page-2')?.capabilities.canRead).toBe(true);
    expect(db.selectFrom).toHaveBeenCalledTimes(2);
    expect(spaceMemberRepo.getUserSpaceRoles).toHaveBeenCalledTimes(1);
    expect(pageAccessRuleRepo.findUserRule).not.toHaveBeenCalled();
    expect(pageAccessRuleRepo.findGroupRules).not.toHaveBeenCalled();
  });

  it('keeps archived spaces readable but read-only for space writers', async () => {
    (service as any).getSpaceArchivedAt.mockResolvedValueOnce(new Date());
    groupUserRepo.getGroupIdsByUserId.mockResolvedValue([]);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
      { userId: 'user-1', role: SpaceRole.WRITER },
    ]);
    pageAccessRuleRepo.findUserRule.mockResolvedValue(undefined);
    pageAccessRuleRepo.findGroupRules.mockResolvedValue([]);

    const access = await service.getEffectiveAccess(page, {
      id: 'user-1',
      role: UserRole.MEMBER,
      workspaceId: 'workspace-1',
    } as any);

    expect(access.capabilities).toEqual({
      canRead: true,
      canWrite: false,
      canCreateChild: false,
      canMoveDeleteShare: false,
      canManageAccess: false,
    });
  });

  it('cascades grant user access to all descendants and records history', async () => {
    const actor = {
      id: 'admin-1',
      role: UserRole.ADMIN,
      workspaceId: 'workspace-1',
    } as any;
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

  it('rejects page access changes in archived spaces', async () => {
    const actor = {
      id: 'admin-1',
      role: UserRole.ADMIN,
      workspaceId: 'workspace-1',
    } as any;
    (service as any).getSpaceArchivedAt.mockResolvedValueOnce(new Date());

    await expect(
      service.grantUserAccessForSubtree(page, 'user-1', PageRole.READER, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('writes user deny on close and rejects close for workspace owner/admin', async () => {
    const actor = {
      id: 'admin-1',
      role: UserRole.ADMIN,
      workspaceId: 'workspace-1',
    } as any;
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
