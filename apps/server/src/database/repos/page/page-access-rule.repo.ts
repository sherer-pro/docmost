import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertablePageAccessRule,
  PageAccessRule,
} from '@docmost/db/types/entity.types';
import {
  PageAccessEffect,
  PageAccessPrincipalType,
  PageRole,
} from '../../../common/helpers/types/permission';

@Injectable()
export class PageAccessRuleRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findUserRule(
    pageId: string,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<PageAccessRule | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('pageAccessRules')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('principalType', '=', PageAccessPrincipalType.USER)
      .where('userId', '=', userId)
      .executeTakeFirst();
  }

  async findGroupRules(
    pageId: string,
    groupIds: string[],
    trx?: KyselyTransaction,
  ): Promise<PageAccessRule[]> {
    if (groupIds.length === 0) {
      return [];
    }

    return dbOrTx(this.db, trx)
      .selectFrom('pageAccessRules')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('principalType', '=', PageAccessPrincipalType.GROUP)
      .where('groupId', 'in', groupIds)
      .execute();
  }

  async listPageRules(
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<PageAccessRule[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('pageAccessRules')
      .selectAll()
      .where('pageId', '=', pageId)
      .execute();
  }

  async copyRulesFromParentToChild(
    parentPageId: string,
    childPageId: string,
    opts: {
      actorId: string;
      workspaceId: string;
      spaceId: string;
    },
    trx?: KyselyTransaction,
  ): Promise<void> {
    const { actorId, workspaceId, spaceId } = opts;
    const rules = await this.listPageRules(parentPageId, trx);

    if (rules.length === 0) {
      return;
    }

    const db = dbOrTx(this.db, trx);
    const insertableRules: InsertablePageAccessRule[] = rules.map((rule) => ({
      pageId: childPageId,
      workspaceId,
      spaceId,
      principalType: rule.principalType,
      userId: rule.userId,
      groupId: rule.groupId,
      effect: rule.effect,
      role: rule.role,
      sourcePageId: rule.sourcePageId,
      addedById: actorId,
      updatedById: actorId,
    }));

    await db
      .insertInto('pageAccessRules')
      .values(insertableRules)
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async upsertUserRuleForPages(
    pageIds: string[],
    opts: {
      userId: string;
      workspaceId: string;
      spaceId: string;
      effect: PageAccessEffect;
      role: PageRole | null;
      sourcePageId: string;
      actorId: string;
    },
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }

    const {
      userId,
      workspaceId,
      spaceId,
      effect,
      role,
      sourcePageId,
      actorId,
    } = opts;
    const db = dbOrTx(this.db, trx);
    const now = new Date();

    const insertableRules: InsertablePageAccessRule[] = pageIds.map((pageId) => ({
      pageId,
      workspaceId,
      spaceId,
      principalType: PageAccessPrincipalType.USER,
      userId,
      groupId: null,
      effect,
      role,
      sourcePageId,
      addedById: actorId,
      updatedById: actorId,
      createdAt: now,
      updatedAt: now,
    }));

    await db
      .insertInto('pageAccessRules')
      .values(insertableRules)
      .onConflict((oc) =>
        oc
          .columns(['pageId', 'userId'])
          .where('userId', 'is not', null)
          .doUpdateSet({
            principalType: PageAccessPrincipalType.USER,
            effect,
            role,
            sourcePageId,
            workspaceId,
            spaceId,
            updatedById: actorId,
            updatedAt: now,
          }),
      )
      .execute();
  }

  async upsertGroupRuleForPages(
    pageIds: string[],
    opts: {
      groupId: string;
      workspaceId: string;
      spaceId: string;
      effect: PageAccessEffect;
      role: PageRole | null;
      sourcePageId: string;
      actorId: string;
    },
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }

    const {
      groupId,
      workspaceId,
      spaceId,
      effect,
      role,
      sourcePageId,
      actorId,
    } = opts;
    const db = dbOrTx(this.db, trx);
    const now = new Date();

    const insertableRules: InsertablePageAccessRule[] = pageIds.map((pageId) => ({
      pageId,
      workspaceId,
      spaceId,
      principalType: PageAccessPrincipalType.GROUP,
      userId: null,
      groupId,
      effect,
      role,
      sourcePageId,
      addedById: actorId,
      updatedById: actorId,
      createdAt: now,
      updatedAt: now,
    }));

    await db
      .insertInto('pageAccessRules')
      .values(insertableRules)
      .onConflict((oc) =>
        oc
          .columns(['pageId', 'groupId'])
          .where('groupId', 'is not', null)
          .doUpdateSet({
            principalType: PageAccessPrincipalType.GROUP,
            effect,
            role,
            sourcePageId,
            workspaceId,
            spaceId,
            updatedById: actorId,
            updatedAt: now,
          }),
      )
      .execute();
  }

  async deleteRulesByPageIds(
    pageIds: string[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }

    await dbOrTx(this.db, trx)
      .deleteFrom('pageAccessRules')
      .where('pageId', 'in', pageIds)
      .execute();
  }

  async deleteRulesByWorkspaceUser(
    workspaceId: string,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('pageAccessRules')
      .where('workspaceId', '=', workspaceId)
      .where('userId', '=', userId)
      .execute();
  }

  async deleteRulesByGroupId(
    workspaceId: string,
    groupId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('pageAccessRules')
      .where('workspaceId', '=', workspaceId)
      .where('groupId', '=', groupId)
      .execute();
  }
}
