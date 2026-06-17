import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessRuleRepo } from '@docmost/db/repos/page/page-access-rule.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { Page, PageAccessRule, User } from '@docmost/db/types/entity.types';
import {
  PageAccessEffect,
  PageAccessPrincipalType,
  PageRole,
  SpaceRole,
  UserRole,
} from '../../common/helpers/types/permission';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { PageHistoryRecorderService } from '../page/services/page-history-recorder.service';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';

export type PageAccessSource = 'system' | 'space' | 'page_user' | 'page_group';

export interface PageAccessCapabilities {
  canRead: boolean;
  canWrite: boolean;
  canCreateChild: boolean;
  canMoveDeleteShare: boolean;
  canManageAccess: boolean;
}

export interface EffectivePageAccess {
  role: PageRole | null;
  denied: boolean;
  sources: PageAccessSource[];
  capabilities: PageAccessCapabilities;
  spaceRole: SpaceRole | null;
  isSystemAccess: boolean;
}

export interface SidebarAccessSnapshot {
  visiblePageIds: Set<string>;
  readablePageIds: Set<string>;
  writablePageIds: Set<string>;
  createChildPageIds: Set<string>;
  moveDeleteSharePageIds: Set<string>;
  manageAccessPageIds: Set<string>;
  visibleChildrenCountByParentId: Map<string, number>;
}

interface AccessDecision {
  role: PageRole | null;
  denied: boolean;
  sources: PageAccessSource[];
  decisionSource: 'system' | 'space' | 'page_user' | 'page_group' | 'none';
}

@Injectable()
export class PageAccessService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessRuleRepo: PageAccessRuleRepo,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageHistoryRecorder: PageHistoryRecorderService,
  ) {}

  isWorkspaceBypassUser(user: User, workspaceId?: string): boolean {
    if (workspaceId && user.workspaceId !== workspaceId) {
      return false;
    }

    return user.role === UserRole.OWNER || user.role === UserRole.ADMIN;
  }

  private noAccess(spaceRole: SpaceRole | null = null): EffectivePageAccess {
    return {
      role: null,
      denied: false,
      sources: [],
      capabilities: {
        canRead: false,
        canWrite: false,
        canCreateChild: false,
        canMoveDeleteShare: false,
        canManageAccess: false,
      },
      spaceRole,
      isSystemAccess: false,
    };
  }

  private emptySidebarAccessSnapshot(): SidebarAccessSnapshot {
    return {
      visiblePageIds: new Set<string>(),
      readablePageIds: new Set<string>(),
      writablePageIds: new Set<string>(),
      createChildPageIds: new Set<string>(),
      moveDeleteSharePageIds: new Set<string>(),
      manageAccessPageIds: new Set<string>(),
      visibleChildrenCountByParentId: new Map<string, number>(),
    };
  }

  private toPageRoleFromSpaceRole(spaceRole: SpaceRole | null): PageRole | null {
    if (!spaceRole) {
      return null;
    }

    if (spaceRole === SpaceRole.ADMIN || spaceRole === SpaceRole.WRITER) {
      return PageRole.WRITER;
    }

    return PageRole.READER;
  }

  private resolveCapabilities(
    decision: AccessDecision,
    spaceRole: SpaceRole | null,
    isSpaceArchived = false,
  ): PageAccessCapabilities {
    if (decision.decisionSource === 'system') {
      return {
        canRead: true,
        canWrite: !isSpaceArchived,
        canCreateChild: !isSpaceArchived,
        canMoveDeleteShare: !isSpaceArchived,
        canManageAccess: !isSpaceArchived,
      };
    }

    const canRead = !!decision.role && !decision.denied;
    const canWrite =
      !isSpaceArchived && canRead && decision.role === PageRole.WRITER;
    const canCreateChild = canWrite;

    const canMoveDeleteShare =
      !isSpaceArchived &&
      canRead &&
      decision.decisionSource === 'space' &&
      (spaceRole === SpaceRole.ADMIN || spaceRole === SpaceRole.WRITER);

    return {
      canRead,
      canWrite,
      canCreateChild,
      canMoveDeleteShare,
      canManageAccess: false,
    };
  }

  private evaluateDecision(input: {
    isSystemBypass: boolean;
    userRule: PageAccessRule | null;
    groupRules: PageAccessRule[];
    spaceRole: SpaceRole | null;
  }): AccessDecision {
    const { isSystemBypass, userRule, groupRules, spaceRole } = input;

    if (isSystemBypass) {
      return {
        role: PageRole.WRITER,
        denied: false,
        sources: ['system'],
        decisionSource: 'system',
      };
    }

    if (userRule) {
      const denied = userRule.effect === PageAccessEffect.DENY;
      return {
        role: denied ? null : ((userRule.role as PageRole | null) ?? null),
        denied,
        sources: ['page_user'],
        decisionSource: 'page_user',
      };
    }

    if (groupRules.length > 0) {
      const hasDeny = groupRules.some(
        (rule) => rule.effect === PageAccessEffect.DENY,
      );

      if (hasDeny) {
        return {
          role: null,
          denied: true,
          sources: ['page_group'],
          decisionSource: 'page_group',
        };
      }

      const hasWriter = groupRules.some(
        (rule) =>
          rule.effect === PageAccessEffect.ALLOW && rule.role === PageRole.WRITER,
      );

      return {
        role: hasWriter ? PageRole.WRITER : PageRole.READER,
        denied: false,
        sources: ['page_group'],
        decisionSource: 'page_group',
      };
    }

    if (spaceRole) {
      return {
        role: this.toPageRoleFromSpaceRole(spaceRole),
        denied: false,
        sources: ['space'],
        decisionSource: 'space',
      };
    }

    return {
      role: null,
      denied: false,
      sources: [],
      decisionSource: 'none',
    };
  }

  private async getHighestSpaceRole(
    userId: string,
    spaceId: string,
  ): Promise<SpaceRole | null> {
    const roles = await this.spaceMemberRepo.getUserSpaceRoles(userId, spaceId);
    return (findHighestUserSpaceRole(roles) as SpaceRole | undefined) ?? null;
  }

  private async getSpaceArchivedAt(
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<Date | null> {
    const db = trx ?? this.db;
    const space = await db
      .selectFrom('spaces')
      .select('archivedAt')
      .where('id', '=', spaceId)
      .executeTakeFirst();

    return (space?.archivedAt as Date | null | undefined) ?? null;
  }

  private async assertSpaceIsActive(
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const archivedAt = await this.getSpaceArchivedAt(spaceId, trx);
    if (archivedAt) {
      throw new ForbiddenException();
    }
  }

  private async getPageRulesForUser(
    pageId: string,
    userId: string,
    groupIds: string[],
    trx?: KyselyTransaction,
  ): Promise<{ userRule: PageAccessRule | null; groupRules: PageAccessRule[] }> {
    const [userRule, groupRules] = await Promise.all([
      this.pageAccessRuleRepo.findUserRule(pageId, userId, trx),
      this.pageAccessRuleRepo.findGroupRules(pageId, groupIds, trx),
    ]);

    return {
      userRule: userRule ?? null,
      groupRules,
    };
  }

  private buildEffectiveAccess(
    decision: AccessDecision,
    userRule: PageAccessRule | null,
    spaceRole: SpaceRole | null,
    spaceArchivedAt: Date | null,
  ): EffectivePageAccess {
    const sources = [...decision.sources];
    if (
      sources.length === 1 &&
      sources[0] !== 'space' &&
      spaceRole &&
      decision.decisionSource !== 'system'
    ) {
      sources.push('space');
    }

    if (
      decision.decisionSource === 'page_group' &&
      userRule?.effect === PageAccessEffect.DENY &&
      !sources.includes('page_user')
    ) {
      sources.push('page_user');
    }

    return {
      role: decision.role,
      denied: decision.denied,
      sources,
      capabilities: this.resolveCapabilities(
        decision,
        spaceRole,
        !!spaceArchivedAt,
      ),
      spaceRole,
      isSystemAccess: decision.decisionSource === 'system',
    };
  }

  async getEffectiveAccess(
    page: Page,
    user: User,
    opts?: {
      trx?: KyselyTransaction;
      groupIds?: string[];
      spaceRole?: SpaceRole | null;
      spaceArchivedAt?: Date | null;
    },
  ): Promise<EffectivePageAccess> {
    if (page.workspaceId !== user.workspaceId) {
      return this.noAccess();
    }

    const isSystemBypass = this.isWorkspaceBypassUser(user, page.workspaceId);

    const [groupIds, spaceRole, spaceArchivedAt] = await Promise.all([
      opts?.groupIds
        ? Promise.resolve(opts.groupIds)
        : this.groupUserRepo.getGroupIdsByUserId(user.id),
      typeof opts?.spaceRole === 'undefined'
        ? this.getHighestSpaceRole(user.id, page.spaceId)
        : Promise.resolve(opts.spaceRole),
      typeof opts?.spaceArchivedAt === 'undefined'
        ? this.getSpaceArchivedAt(page.spaceId, opts?.trx)
        : Promise.resolve(opts.spaceArchivedAt),
    ]);

    const { userRule, groupRules } = await this.getPageRulesForUser(
      page.id,
      user.id,
      groupIds,
      opts?.trx,
    );

    const decision = this.evaluateDecision({
      isSystemBypass,
      userRule,
      groupRules,
      spaceRole,
    });

    return this.buildEffectiveAccess(
      decision,
      userRule,
      spaceRole,
      spaceArchivedAt,
    );
  }

  async getEffectiveAccessForPages(
    pages: Page[],
    user: User,
  ): Promise<Map<string, EffectivePageAccess>> {
    const accessByPageId = new Map<string, EffectivePageAccess>();
    for (const page of pages) {
      accessByPageId.set(page.id, this.noAccess());
    }

    const workspacePages = pages.filter(
      (page) => page.workspaceId === user.workspaceId,
    );
    if (workspacePages.length === 0) {
      return accessByPageId;
    }

    const pageIds = [...new Set(workspacePages.map((page) => page.id))];
    const spaceIds = [...new Set(workspacePages.map((page) => page.spaceId))];
    const isSystemBypass = this.isWorkspaceBypassUser(user, user.workspaceId);

    const isSystemBypassBySpaceId = new Map<string, boolean>();
    const spaceRoleBySpaceId = new Map<string, SpaceRole | null>();
    const archivedAtBySpaceId = new Map<string, Date | null>();

    await Promise.all(
      spaceIds.map(async (spaceId) => {
        const [spaceRole, spaceArchivedAt] = await Promise.all([
          isSystemBypass
            ? Promise.resolve(null)
            : this.getHighestSpaceRole(user.id, spaceId),
          this.getSpaceArchivedAt(spaceId),
        ]);
        spaceRoleBySpaceId.set(spaceId, spaceRole);
        archivedAtBySpaceId.set(spaceId, spaceArchivedAt);
        isSystemBypassBySpaceId.set(spaceId, isSystemBypass);
      }),
    );

    if (isSystemBypass) {
      for (const page of workspacePages) {
        const decision = this.evaluateDecision({
          isSystemBypass: true,
          userRule: null,
          groupRules: [],
          spaceRole: null,
        });
        accessByPageId.set(
          page.id,
          this.buildEffectiveAccess(
            decision,
            null,
            null,
            archivedAtBySpaceId.get(page.spaceId) ?? null,
          ),
        );
      }

      return accessByPageId;
    }

    const groupIds = await this.groupUserRepo.getGroupIdsByUserId(user.id);
    const [userRules, groupRules] = await Promise.all([
      this.db
        .selectFrom('pageAccessRules')
        .selectAll()
        .where('pageId', 'in', pageIds)
        .where('principalType', '=', PageAccessPrincipalType.USER)
        .where('userId', '=', user.id)
        .execute(),
      groupIds.length > 0
        ? this.db
            .selectFrom('pageAccessRules')
            .selectAll()
            .where('pageId', 'in', pageIds)
            .where('principalType', '=', PageAccessPrincipalType.GROUP)
            .where('groupId', 'in', groupIds)
            .execute()
        : Promise.resolve([]),
    ]);

    const userRuleByPageId = new Map<string, PageAccessRule>();
    for (const rule of userRules) {
      userRuleByPageId.set(rule.pageId, rule as PageAccessRule);
    }

    const groupRulesByPageId = new Map<string, PageAccessRule[]>();
    for (const rule of groupRules) {
      const existing = groupRulesByPageId.get(rule.pageId) ?? [];
      existing.push(rule as PageAccessRule);
      groupRulesByPageId.set(rule.pageId, existing);
    }

    for (const page of workspacePages) {
      const userRule = userRuleByPageId.get(page.id) ?? null;
      const spaceRole = spaceRoleBySpaceId.get(page.spaceId) ?? null;
      const decision = this.evaluateDecision({
        isSystemBypass: isSystemBypassBySpaceId.get(page.spaceId) ?? false,
        userRule,
        groupRules: groupRulesByPageId.get(page.id) ?? [],
        spaceRole,
      });

      accessByPageId.set(
        page.id,
        this.buildEffectiveAccess(
          decision,
          userRule,
          spaceRole,
          archivedAtBySpaceId.get(page.spaceId) ?? null,
        ),
      );
    }

    return accessByPageId;
  }

  async getEffectiveAccessByPageId(
    pageId: string,
    user: User,
    opts?: { trx?: KyselyTransaction },
  ): Promise<{ page: Page; access: EffectivePageAccess }> {
    const page = await this.pageRepo.findById(pageId, { trx: opts?.trx });
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    const access = await this.getEffectiveAccess(page, user, { trx: opts?.trx });

    return { page, access };
  }

  async assertCanReadPage(page: Page, user: User): Promise<EffectivePageAccess> {
    const access = await this.getEffectiveAccess(page, user);
    if (!access.capabilities.canRead) {
      throw new ForbiddenException();
    }
    return access;
  }

  async assertCanWritePage(page: Page, user: User): Promise<EffectivePageAccess> {
    const access = await this.getEffectiveAccess(page, user);
    if (!access.capabilities.canWrite) {
      throw new ForbiddenException();
    }
    return access;
  }

  async assertCanCreateChild(
    page: Page,
    user: User,
  ): Promise<EffectivePageAccess> {
    const access = await this.getEffectiveAccess(page, user);
    if (!access.capabilities.canCreateChild) {
      throw new ForbiddenException();
    }
    return access;
  }

  async assertCanMoveDeleteShare(
    page: Page,
    user: User,
  ): Promise<EffectivePageAccess> {
    const access = await this.getEffectiveAccess(page, user);
    if (!access.capabilities.canMoveDeleteShare) {
      throw new ForbiddenException();
    }
    return access;
  }

  assertCanManageAccess(user: User, workspaceId?: string): void {
    if (!this.isWorkspaceBypassUser(user, workspaceId)) {
      throw new ForbiddenException();
    }
  }

  private async getSubtreePageIds(pageId: string): Promise<string[]> {
    const pages = await this.pageRepo.getPageAndDescendants(pageId, {
      includeContent: false,
    });
    return pages.map((page) => page.id);
  }

  private async ensureWorkspaceUser(
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string; role: UserRole | null } | null> {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'role'])
      .where('id', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      role: (user.role as UserRole | null) ?? null,
    };
  }

  private async ensureWorkspaceGroup(
    workspaceId: string,
    groupId: string,
  ): Promise<{ id: string } | null> {
    return this.db
      .selectFrom('groups')
      .select(['id'])
      .where('id', '=', groupId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async grantUserAccessForSubtree(
    page: Page,
    targetUserId: string,
    role: PageRole,
    actor: User,
    trx?: KyselyTransaction,
  ): Promise<void> {
    this.assertCanManageAccess(actor, page.workspaceId);
    await this.assertSpaceIsActive(page.spaceId, trx);

    const targetUser = await this.ensureWorkspaceUser(page.workspaceId, targetUserId);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const pageIds = await this.getSubtreePageIds(page.id);
    await this.pageAccessRuleRepo.upsertUserRuleForPages(
      pageIds,
      {
        userId: targetUserId,
        workspaceId: page.workspaceId,
        spaceId: page.spaceId,
        effect: PageAccessEffect.ALLOW,
        role,
        sourcePageId: page.id,
        actorId: actor.id,
      },
      trx,
    );

    await this.pageHistoryRecorder.recordPageEvent({
      pageId: page.id,
      actorId: actor.id,
      changeType: 'page.access.updated',
      changeData: {
        operation: 'grant',
        principalType: PageAccessPrincipalType.USER,
        principalId: targetUserId,
        effect: PageAccessEffect.ALLOW,
        role,
        cascadedPageCount: pageIds.length,
      },
      trx,
    });
  }

  async closeUserAccessForSubtree(
    page: Page,
    targetUserId: string,
    actor: User,
    trx?: KyselyTransaction,
  ): Promise<void> {
    this.assertCanManageAccess(actor, page.workspaceId);
    await this.assertSpaceIsActive(page.spaceId, trx);

    const targetUser = await this.ensureWorkspaceUser(page.workspaceId, targetUserId);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    if (
      targetUser.role === UserRole.OWNER ||
      targetUser.role === UserRole.ADMIN
    ) {
      throw new BadRequestException(
        'Workspace owner/admin has system access and cannot be closed',
      );
    }

    const pageIds = await this.getSubtreePageIds(page.id);
    await this.pageAccessRuleRepo.upsertUserRuleForPages(
      pageIds,
      {
        userId: targetUserId,
        workspaceId: page.workspaceId,
        spaceId: page.spaceId,
        effect: PageAccessEffect.DENY,
        role: null,
        sourcePageId: page.id,
        actorId: actor.id,
      },
      trx,
    );

    await this.pageHistoryRecorder.recordPageEvent({
      pageId: page.id,
      actorId: actor.id,
      changeType: 'page.access.updated',
      changeData: {
        operation: 'close',
        principalType: PageAccessPrincipalType.USER,
        principalId: targetUserId,
        effect: PageAccessEffect.DENY,
        role: null,
        cascadedPageCount: pageIds.length,
      },
      trx,
    });
  }

  async grantGroupAccessForSubtree(
    page: Page,
    targetGroupId: string,
    role: PageRole,
    actor: User,
    trx?: KyselyTransaction,
  ): Promise<void> {
    this.assertCanManageAccess(actor, page.workspaceId);
    await this.assertSpaceIsActive(page.spaceId, trx);

    const targetGroup = await this.ensureWorkspaceGroup(
      page.workspaceId,
      targetGroupId,
    );
    if (!targetGroup) {
      throw new NotFoundException('Group not found');
    }

    const pageIds = await this.getSubtreePageIds(page.id);
    await this.pageAccessRuleRepo.upsertGroupRuleForPages(
      pageIds,
      {
        groupId: targetGroupId,
        workspaceId: page.workspaceId,
        spaceId: page.spaceId,
        effect: PageAccessEffect.ALLOW,
        role,
        sourcePageId: page.id,
        actorId: actor.id,
      },
      trx,
    );

    await this.pageHistoryRecorder.recordPageEvent({
      pageId: page.id,
      actorId: actor.id,
      changeType: 'page.access.updated',
      changeData: {
        operation: 'grant',
        principalType: PageAccessPrincipalType.GROUP,
        principalId: targetGroupId,
        effect: PageAccessEffect.ALLOW,
        role,
        cascadedPageCount: pageIds.length,
      },
      trx,
    });
  }

  async closeGroupAccessForSubtree(
    page: Page,
    targetGroupId: string,
    actor: User,
    trx?: KyselyTransaction,
  ): Promise<void> {
    this.assertCanManageAccess(actor, page.workspaceId);
    await this.assertSpaceIsActive(page.spaceId, trx);

    const targetGroup = await this.ensureWorkspaceGroup(
      page.workspaceId,
      targetGroupId,
    );
    if (!targetGroup) {
      throw new NotFoundException('Group not found');
    }

    const pageIds = await this.getSubtreePageIds(page.id);
    await this.pageAccessRuleRepo.upsertGroupRuleForPages(
      pageIds,
      {
        groupId: targetGroupId,
        workspaceId: page.workspaceId,
        spaceId: page.spaceId,
        effect: PageAccessEffect.DENY,
        role: null,
        sourcePageId: page.id,
        actorId: actor.id,
      },
      trx,
    );

    await this.pageHistoryRecorder.recordPageEvent({
      pageId: page.id,
      actorId: actor.id,
      changeType: 'page.access.updated',
      changeData: {
        operation: 'close',
        principalType: PageAccessPrincipalType.GROUP,
        principalId: targetGroupId,
        effect: PageAccessEffect.DENY,
        role: null,
        cascadedPageCount: pageIds.length,
      },
      trx,
    });
  }

  async copyParentRulesToChild(
    parentPageId: string,
    childPage: Page,
    actorId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await this.pageAccessRuleRepo.copyRulesFromParentToChild(
      parentPageId,
      childPage.id,
      {
        actorId,
        workspaceId: childPage.workspaceId,
        spaceId: childPage.spaceId,
      },
      trx,
    );
  }

  async clearRulesForSubtree(
    rootPageId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const pageIds = await this.getSubtreePageIds(rootPageId);
    await this.pageAccessRuleRepo.deleteRulesByPageIds(pageIds, trx);
  }

  async clearRulesByPageIds(
    pageIds: string[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    await this.pageAccessRuleRepo.deleteRulesByPageIds(pageIds, trx);
  }

  async getSidebarAccessSnapshot(
    user: User,
    spaceId: string,
  ): Promise<SidebarAccessSnapshot> {
    if (!user.workspaceId) {
      return this.emptySidebarAccessSnapshot();
    }

    const pages = await this.db
      .selectFrom('pages')
      .select(['id', 'parentPageId'])
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', user.workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    const pageIds = pages.map((page) => page.id);
    const visiblePageIds = new Set<string>();
    const readablePageIds = new Set<string>();
    const writablePageIds = new Set<string>();
    const createChildPageIds = new Set<string>();
    const moveDeleteSharePageIds = new Set<string>();
    const manageAccessPageIds = new Set<string>();
    const visibleChildrenCountByParentId = new Map<string, number>();

    if (pageIds.length === 0) {
      return this.emptySidebarAccessSnapshot();
    }

    const isSpaceArchived = !!(await this.getSpaceArchivedAt(spaceId));

    if (this.isWorkspaceBypassUser(user)) {
      for (const page of pages) {
        visiblePageIds.add(page.id);
        readablePageIds.add(page.id);
        if (!isSpaceArchived) {
          writablePageIds.add(page.id);
          createChildPageIds.add(page.id);
          moveDeleteSharePageIds.add(page.id);
          manageAccessPageIds.add(page.id);
        }
      }
    } else {
      const [groupIds, spaceRole] = await Promise.all([
        this.groupUserRepo.getGroupIdsByUserId(user.id),
        this.getHighestSpaceRole(user.id, spaceId),
      ]);

      const userRules = await this.db
        .selectFrom('pageAccessRules')
        .selectAll()
        .where('pageId', 'in', pageIds)
        .where('principalType', '=', PageAccessPrincipalType.USER)
        .where('userId', '=', user.id)
        .execute();

      const groupRules =
        groupIds.length > 0
          ? await this.db
              .selectFrom('pageAccessRules')
              .selectAll()
              .where('pageId', 'in', pageIds)
              .where('principalType', '=', PageAccessPrincipalType.GROUP)
              .where('groupId', 'in', groupIds)
              .execute()
          : [];

      const userRuleByPageId = new Map<string, PageAccessRule>();
      for (const rule of userRules) {
        userRuleByPageId.set(rule.pageId, rule as PageAccessRule);
      }

      const groupRulesByPageId = new Map<string, PageAccessRule[]>();
      for (const rule of groupRules) {
        const existing = groupRulesByPageId.get(rule.pageId) ?? [];
        existing.push(rule as PageAccessRule);
        groupRulesByPageId.set(rule.pageId, existing);
      }

      for (const page of pages) {
        const decision = this.evaluateDecision({
          isSystemBypass: false,
          userRule: userRuleByPageId.get(page.id) ?? null,
          groupRules: groupRulesByPageId.get(page.id) ?? [],
          spaceRole,
        });
        const capabilities = this.resolveCapabilities(
          decision,
          spaceRole,
          isSpaceArchived,
        );

        if (capabilities.canRead) {
          readablePageIds.add(page.id);
        }
        if (capabilities.canWrite) {
          writablePageIds.add(page.id);
        }
        if (capabilities.canCreateChild) {
          createChildPageIds.add(page.id);
        }
        if (capabilities.canMoveDeleteShare) {
          moveDeleteSharePageIds.add(page.id);
        }
        if (capabilities.canManageAccess) {
          manageAccessPageIds.add(page.id);
        }
      }

      const parentByPageId = new Map<string, string | null>();
      for (const page of pages) {
        parentByPageId.set(page.id, page.parentPageId ?? null);
      }

      for (const pageId of readablePageIds) {
        let cursor: string | null | undefined = pageId;
        while (cursor) {
          if (visiblePageIds.has(cursor)) {
            break;
          }
          visiblePageIds.add(cursor);
          cursor = parentByPageId.get(cursor) ?? null;
        }
      }
    }

    if (visiblePageIds.size > 0) {
      for (const page of pages) {
        if (!visiblePageIds.has(page.id) || !page.parentPageId) {
          continue;
        }

        if (!visiblePageIds.has(page.parentPageId)) {
          continue;
        }

        const existing = visibleChildrenCountByParentId.get(page.parentPageId) ?? 0;
        visibleChildrenCountByParentId.set(page.parentPageId, existing + 1);
      }
    }

    return {
      visiblePageIds,
      readablePageIds,
      writablePageIds,
      createChildPageIds,
      moveDeleteSharePageIds,
      manageAccessPageIds,
      visibleChildrenCountByParentId,
    };
  }

  async hasAnyReadablePageInSpace(user: User, spaceId: string): Promise<boolean> {
    const snapshot = await this.getSidebarAccessSnapshot(user, spaceId);
    return snapshot.readablePageIds.size > 0;
  }

  async getSpaceIdsWithPageRuleAccess(
    userId: string,
    workspaceId: string,
  ): Promise<string[]> {
    const groupIds = await this.groupUserRepo.getGroupIdsByUserId(userId);

    let query = this.db
      .selectFrom('pageAccessRules')
      .select('spaceId')
      .distinct()
      .where('workspaceId', '=', workspaceId)
      .where('effect', '=', PageAccessEffect.ALLOW)
      .where('principalType', '=', PageAccessPrincipalType.USER)
      .where('userId', '=', userId);

    if (groupIds.length > 0) {
      query = query.union(
        this.db
          .selectFrom('pageAccessRules')
          .select('spaceId')
          .distinct()
          .where('workspaceId', '=', workspaceId)
          .where('effect', '=', PageAccessEffect.ALLOW)
          .where('principalType', '=', PageAccessPrincipalType.GROUP)
          .where('groupId', 'in', groupIds),
      );
    }

    const rows = await query.execute();
    return [...new Set(rows.map((row) => row.spaceId))];
  }

  private async getUserSpaceRoleMap(
    spaceId: string,
    userIds: string[],
  ): Promise<Map<string, SpaceRole | null>> {
    const roleMap = new Map<string, SpaceRole[]>();

    const directRoles = await this.db
      .selectFrom('spaceMembers')
      .select(['userId', 'role'])
      .where('spaceId', '=', spaceId)
      .where('userId', 'in', userIds)
      .execute();

    for (const role of directRoles) {
      const existing = roleMap.get(role.userId) ?? [];
      existing.push(role.role as SpaceRole);
      roleMap.set(role.userId, existing);
    }

    const groupRoles = await this.db
      .selectFrom('spaceMembers')
      .innerJoin('groupUsers', 'groupUsers.groupId', 'spaceMembers.groupId')
      .select(['groupUsers.userId as userId', 'spaceMembers.role as role'])
      .where('spaceMembers.spaceId', '=', spaceId)
      .where('groupUsers.userId', 'in', userIds)
      .execute();

    for (const role of groupRoles) {
      const existing = roleMap.get(role.userId) ?? [];
      existing.push(role.role as SpaceRole);
      roleMap.set(role.userId, existing);
    }

    const highestByUser = new Map<string, SpaceRole | null>();
    for (const userId of userIds) {
      const roles = roleMap.get(userId);
      highestByUser.set(
        userId,
        (findHighestUserSpaceRole(
          roles?.map((role) => ({ role, userId })) as {
            role: SpaceRole;
            userId: string;
          }[],
        ) as SpaceRole | undefined) ?? null,
      );
    }

    return highestByUser;
  }

  private async getEffectiveAccessForUsers(
    page: Page,
    users: Array<Pick<User, 'id' | 'role' | 'workspaceId'>>,
  ): Promise<Map<string, EffectivePageAccess>> {
    const accessByUserId = new Map<string, EffectivePageAccess>();
    const workspaceUsers = users.filter(
      (user) => user.workspaceId === page.workspaceId,
    );
    if (workspaceUsers.length === 0) {
      return accessByUserId;
    }

    const userIds = workspaceUsers.map((user) => user.id);
    const groupRows = await this.db
      .selectFrom('groupUsers')
      .select(['userId', 'groupId'])
      .where('userId', 'in', userIds)
      .execute();

    const groupIdsByUserId = new Map<string, string[]>();
    for (const row of groupRows) {
      const existing = groupIdsByUserId.get(row.userId) ?? [];
      existing.push(row.groupId);
      groupIdsByUserId.set(row.userId, existing);
    }

    const allGroupIds = [...new Set(groupRows.map((row) => row.groupId))];
    const [
      pageUserRules,
      pageGroupRules,
      spaceRoleByUserId,
      spaceArchivedAt,
    ] = await Promise.all([
      this.db
        .selectFrom('pageAccessRules')
        .selectAll()
        .where('pageId', '=', page.id)
        .where('principalType', '=', PageAccessPrincipalType.USER)
        .where('userId', 'in', userIds)
        .execute(),
      allGroupIds.length > 0
        ? this.db
            .selectFrom('pageAccessRules')
            .selectAll()
            .where('pageId', '=', page.id)
            .where('principalType', '=', PageAccessPrincipalType.GROUP)
            .where('groupId', 'in', allGroupIds)
            .execute()
        : Promise.resolve([]),
      this.getUserSpaceRoleMap(page.spaceId, userIds),
      this.getSpaceArchivedAt(page.spaceId),
    ]);

    const userRuleByUserId = new Map<string, PageAccessRule>();
    for (const rule of pageUserRules) {
      if (!rule.userId) {
        continue;
      }
      userRuleByUserId.set(rule.userId, rule as PageAccessRule);
    }

    const groupRulesByGroupId = new Map<string, PageAccessRule[]>();
    for (const rule of pageGroupRules) {
      if (!rule.groupId) {
        continue;
      }
      const existing = groupRulesByGroupId.get(rule.groupId) ?? [];
      existing.push(rule as PageAccessRule);
      groupRulesByGroupId.set(rule.groupId, existing);
    }

    for (const user of workspaceUsers) {
      const isSystemBypass = this.isWorkspaceBypassUser(user as User, page.workspaceId);

      const userRule = userRuleByUserId.get(user.id) ?? null;
      const groupRules = (groupIdsByUserId.get(user.id) ?? []).flatMap(
        (groupId) => groupRulesByGroupId.get(groupId) ?? [],
      );
      const spaceRole = spaceRoleByUserId.get(user.id) ?? null;

      const decision = this.evaluateDecision({
        isSystemBypass,
        userRule,
        groupRules,
        spaceRole,
      });
      const sources = [...decision.sources];
      if (
        sources.length === 1 &&
        sources[0] !== 'space' &&
        spaceRole &&
        decision.decisionSource !== 'system'
      ) {
        sources.push('space');
      }

      if (
        decision.decisionSource === 'page_group' &&
        userRule?.effect === PageAccessEffect.DENY &&
        !sources.includes('page_user')
      ) {
        sources.push('page_user');
      }

      accessByUserId.set(user.id, {
        role: decision.role,
        denied: decision.denied,
        sources,
        capabilities: this.resolveCapabilities(
          decision,
          spaceRole,
          !!spaceArchivedAt,
        ),
        spaceRole,
        isSystemAccess: decision.decisionSource === 'system',
      });
    }

    return accessByUserId;
  }

  async filterUsersWithPageReadAccess(
    pageId: string,
    candidateUserIds: string[],
  ): Promise<string[]> {
    if (candidateUserIds.length === 0) {
      return [];
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page) {
      return [];
    }

    const uniqueCandidateIds = [...new Set(candidateUserIds)];
    const users = await this.db
      .selectFrom('users')
      .select(['id', 'role', 'workspaceId'])
      .where('id', 'in', uniqueCandidateIds)
      .where('workspaceId', '=', page.workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    const accessByUserId = await this.getEffectiveAccessForUsers(
      page,
      users as Array<Pick<User, 'id' | 'role' | 'workspaceId'>>,
    );

    return users
      .filter((user) => accessByUserId.get(user.id)?.capabilities.canRead)
      .map((user) => user.id);
  }

  async listEffectiveUsers(
    page: Page,
    pagination: PaginationOptions,
  ): Promise<any> {
    const rules = await this.pageAccessRuleRepo.listPageRules(page.id);

    const ruleUserIds = rules
      .filter((rule) => rule.principalType === PageAccessPrincipalType.USER)
      .map((rule) => rule.userId)
      .filter((userId): userId is string => !!userId);

    const ruleGroupIds = rules
      .filter((rule) => rule.principalType === PageAccessPrincipalType.GROUP)
      .map((rule) => rule.groupId)
      .filter((groupId): groupId is string => !!groupId);

    const [systemUsers, spaceUserRows, ruleGroupUserRows] = await Promise.all([
      this.db
        .selectFrom('users')
        .select(['id'])
        .where('workspaceId', '=', page.workspaceId)
        .where('deletedAt', 'is', null)
        .where('role', 'in', [UserRole.OWNER, UserRole.ADMIN])
        .execute(),
      this.db
        .selectFrom('spaceMembers')
        .select(['userId'])
        .where('spaceId', '=', page.spaceId)
        .where('userId', 'is not', null)
        .union(
          this.db
            .selectFrom('spaceMembers')
            .innerJoin('groupUsers', 'groupUsers.groupId', 'spaceMembers.groupId')
            .select('groupUsers.userId as userId')
            .where('spaceMembers.spaceId', '=', page.spaceId),
        )
        .execute(),
      ruleGroupIds.length > 0
        ? this.db
            .selectFrom('groupUsers')
            .select(['userId'])
            .where('groupId', 'in', ruleGroupIds)
            .execute()
        : Promise.resolve([]),
    ]);

    const candidateUserIds = [
      ...new Set([
        ...systemUsers.map((user) => user.id),
        ...spaceUserRows.map((row) => row.userId),
        ...ruleUserIds,
        ...ruleGroupUserRows.map((row) => row.userId),
      ]),
    ];

    if (candidateUserIds.length === 0) {
      return {
        items: [],
        meta: {
          hasNextPage: false,
          hasPrevPage: false,
          nextCursor: null,
          prevCursor: null,
        },
      };
    }

    let usersQuery = this.db
      .selectFrom('users')
      .select(['id', 'name', 'email', 'avatarUrl', 'role'])
      .where('workspaceId', '=', page.workspaceId)
      .where('id', 'in', candidateUserIds)
      .where('deletedAt', 'is', null);

    if (pagination.query) {
      usersQuery = usersQuery.where((eb) =>
        eb('name', 'ilike', `%${pagination.query}%`).or(
          'email',
          'ilike',
          `%${pagination.query}%`,
        ),
      );
    }

    const paginatedUsers = await executeWithCursorPagination(usersQuery, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'asc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });

    const accessByUserId = await this.getEffectiveAccessForUsers(
      page,
      paginatedUsers.items.map((user) => ({
        ...user,
        workspaceId: page.workspaceId,
      })) as Array<Pick<User, 'id' | 'role' | 'workspaceId'>>,
    );

    paginatedUsers.items = paginatedUsers.items
      .map((user) => {
        const effective = accessByUserId.get(user.id);
        if (!effective?.capabilities.canRead) {
          return null;
        }

        return {
          ...user,
          type: 'user',
          access: {
            role: effective.role,
            sources: effective.sources,
            capabilities: effective.capabilities,
            isSystemAccess: effective.isSystemAccess,
            canClose: !effective.isSystemAccess,
          },
        };
      })
      .filter((user): user is NonNullable<typeof user> => !!user);

    return paginatedUsers;
  }

  async resolveReadableUsers(
    page: Page,
    candidateUserIds: string[],
  ): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      avatarUrl: string | null;
      type: 'user';
    }>
  > {
    const uniqueCandidateIds = [...new Set(candidateUserIds.filter(Boolean))];
    if (uniqueCandidateIds.length === 0) {
      return [];
    }

    const readableUserIds = await this.filterUsersWithPageReadAccess(
      page.id,
      uniqueCandidateIds,
    );

    if (readableUserIds.length === 0) {
      return [];
    }

    const users = await this.db
      .selectFrom('users')
      .select(['id', 'name', 'email', 'avatarUrl'])
      .where('workspaceId', '=', page.workspaceId)
      .where('id', 'in', readableUserIds)
      .where('deletedAt', 'is', null)
      .execute();

    const usersById = new Map(users.map((user) => [user.id, user]));

    return uniqueCandidateIds
      .map((userId) => usersById.get(userId))
      .filter((user): user is NonNullable<typeof user> => !!user)
      .map((user) => ({
        ...user,
        type: 'user' as const,
      }));
  }

  async listGroupRules(page: Page, pagination: PaginationOptions) {
    let query = this.db
      .selectFrom('pageAccessRules')
      .innerJoin('groups', 'groups.id', 'pageAccessRules.groupId')
      .select([
        'groups.id as id',
        'groups.name as name',
        'pageAccessRules.effect as effect',
        'pageAccessRules.role as role',
        'pageAccessRules.sourcePageId as sourcePageId',
        'pageAccessRules.createdAt as createdAt',
        'pageAccessRules.updatedAt as updatedAt',
      ])
      .where('pageAccessRules.pageId', '=', page.id)
      .where('pageAccessRules.principalType', '=', PageAccessPrincipalType.GROUP);

    if (pagination.query) {
      query = query.where('groups.name', 'ilike', `%${pagination.query}%`);
    }

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'asc' }],
      parseCursor: (cursor) => ({ id: cursor.id as string }),
    });
  }
}
