import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { PageAccessRuleRepo } from '@docmost/db/repos/page/page-access-rule.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Page, User } from '@docmost/db/types/entity.types';
import {
  PageAccessEffect,
  PageAccessPrincipalType,
  PageRole,
  UserRole,
} from '../../../common/helpers/types/permission';
import { EventName } from '../../../common/events/event.contants';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageHistoryRecorderService } from './page-history-recorder.service';

@Injectable()
export class PageAccessMutationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessRuleRepo: PageAccessRuleRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly pageHistoryRecorder: PageHistoryRecorderService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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
    this.pageAccessService.assertCanManageAccess(actor, page.workspaceId);
    await this.pageAccessService.assertSpaceIsActive(page.spaceId, trx);

    const targetUser = await this.ensureWorkspaceUser(
      page.workspaceId,
      targetUserId,
    );
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

    await this.recordAccessChange({
      page,
      actor,
      operation: 'grant',
      principalType: PageAccessPrincipalType.USER,
      principalId: targetUserId,
      effect: PageAccessEffect.ALLOW,
      role,
      cascadedPageCount: pageIds.length,
      trx,
    });
  }

  async closeUserAccessForSubtree(
    page: Page,
    targetUserId: string,
    actor: User,
    trx?: KyselyTransaction,
  ): Promise<void> {
    this.pageAccessService.assertCanManageAccess(actor, page.workspaceId);
    await this.pageAccessService.assertSpaceIsActive(page.spaceId, trx);

    const targetUser = await this.ensureWorkspaceUser(
      page.workspaceId,
      targetUserId,
    );
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

    await this.recordAccessChange({
      page,
      actor,
      operation: 'close',
      principalType: PageAccessPrincipalType.USER,
      principalId: targetUserId,
      effect: PageAccessEffect.DENY,
      role: null,
      cascadedPageCount: pageIds.length,
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
    this.pageAccessService.assertCanManageAccess(actor, page.workspaceId);
    await this.pageAccessService.assertSpaceIsActive(page.spaceId, trx);

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

    await this.recordAccessChange({
      page,
      actor,
      operation: 'grant',
      principalType: PageAccessPrincipalType.GROUP,
      principalId: targetGroupId,
      effect: PageAccessEffect.ALLOW,
      role,
      cascadedPageCount: pageIds.length,
      trx,
    });
  }

  async closeGroupAccessForSubtree(
    page: Page,
    targetGroupId: string,
    actor: User,
    trx?: KyselyTransaction,
  ): Promise<void> {
    this.pageAccessService.assertCanManageAccess(actor, page.workspaceId);
    await this.pageAccessService.assertSpaceIsActive(page.spaceId, trx);

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

    await this.recordAccessChange({
      page,
      actor,
      operation: 'close',
      principalType: PageAccessPrincipalType.GROUP,
      principalId: targetGroupId,
      effect: PageAccessEffect.DENY,
      role: null,
      cascadedPageCount: pageIds.length,
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

  private async recordAccessChange(input: {
    page: Page;
    actor: User;
    operation: 'grant' | 'close';
    principalType: PageAccessPrincipalType;
    principalId: string;
    effect: PageAccessEffect;
    role: PageRole | null;
    cascadedPageCount: number;
    trx?: KyselyTransaction;
  }): Promise<void> {
    await this.pageHistoryRecorder.recordPageEvent({
      pageId: input.page.id,
      actorId: input.actor.id,
      changeType: 'page.access.updated',
      changeData: {
        operation: input.operation,
        principalType: input.principalType,
        principalId: input.principalId,
        effect: input.effect,
        role: input.role,
        cascadedPageCount: input.cascadedPageCount,
      },
      trx: input.trx,
    });

    const accessUserIds =
      input.principalType === PageAccessPrincipalType.USER
        ? [input.principalId]
        : (
            await this.db
              .selectFrom('groupUsers')
              .select('userId')
              .where('groupId', '=', input.principalId)
              .execute()
          ).map((membership) => membership.userId);

    await Promise.all(
      accessUserIds.map((userId) =>
        this.eventEmitter.emitAsync(EventName.AUTHORIZATION_CHANGED, {
          workspaceId: input.page.workspaceId,
          userId,
        }),
      ),
    );
  }
}
