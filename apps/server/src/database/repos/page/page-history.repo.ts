import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertablePageHistory,
  Page,
  PageHistory,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { ExpressionBuilder, sql } from 'kysely';
import type { DB } from '@docmost/db/types/db';

@Injectable()
export class PageHistoryRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private baseFields: Array<keyof PageHistory> = [
    'id',
    'pageId',
    'slugId',
    'title',
    'changeType',
    'changeData',
    'icon',
    'coverPhoto',
    'lastUpdatedById',
    'contributorIds',
    'spaceId',
    'workspaceId',
    'createdAt',
  ];

  async findById(
    pageHistoryId: string,
    opts?: {
      includeContent?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<PageHistory> {
    const db = dbOrTx(this.db, opts?.trx);

    return await db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .$if(opts?.includeContent, (qb) => qb.select('content'))
      .select((eb) => this.withLastUpdatedBy(eb))
      .select((eb) => this.withContributors(eb))
      .where('id', '=', pageHistoryId)
      .executeTakeFirst();
  }

  async insertPageHistory(
    insertablePageHistory: InsertablePageHistory,
    trx?: KyselyTransaction,
  ): Promise<PageHistory> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('pageHistory')
      .values(insertablePageHistory)
      .returningAll()
      .executeTakeFirst();
  }

  async insertPageHistoryIdempotent(
    insertablePageHistory: InsertablePageHistory & { sourceBatchId: string },
    trx?: KyselyTransaction,
  ): Promise<{ history: PageHistory; inserted: boolean }> {
    const db = dbOrTx(this.db, trx);
    const inserted = await db
      .insertInto('pageHistory')
      .values(insertablePageHistory)
      .onConflict((oc) =>
        oc.columns(['pageId', 'sourceBatchId']).doNothing(),
      )
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      return { history: inserted, inserted: true };
    }

    const existing = await db
      .selectFrom('pageHistory')
      .selectAll()
      .where('pageId', '=', insertablePageHistory.pageId)
      .where('sourceBatchId', '=', insertablePageHistory.sourceBatchId)
      .executeTakeFirstOrThrow();

    return { history: existing, inserted: false };
  }

  async findMetadataById(
    pageHistoryId: string,
  ): Promise<Pick<PageHistory, 'id' | 'workspaceId'> | undefined> {
    return this.db
      .selectFrom('pageHistory')
      .select(['id', 'workspaceId'])
      .where('id', '=', pageHistoryId)
      .executeTakeFirst();
  }

  async deleteById(pageHistoryId: string): Promise<void> {
    await this.db
      .deleteFrom('pageHistory')
      .where('id', '=', pageHistoryId)
      .execute();
  }

  async saveHistory(
    page: Page,
    opts?: { contributorIds?: string[]; trx?: KyselyTransaction },
  ): Promise<PageHistory> {
    return this.insertPageHistory(
      {
        pageId: page.id,
        slugId: page.slugId,
        title: page.title,
        content: page.content,
        icon: page.icon,
        coverPhoto: page.coverPhoto,
        lastUpdatedById: page.lastUpdatedById ?? page.creatorId,
        contributorIds: opts?.contributorIds,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
      },
      opts?.trx,
    );
  }

  async findPageHistoryByPageId(pageId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .select((eb) => this.withLastUpdatedBy(eb))
      .select((eb) => this.withContributors(eb))
      .where('pageId', '=', pageId);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'desc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  async findPageLastHistory(
    pageId: string,
    opts?: {
      includeContent?: boolean;
      trx?: KyselyTransaction;
    },
  ) {
    const db = dbOrTx(this.db, opts?.trx);

    return await db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .$if(opts?.includeContent, (qb) => qb.select('content'))
      .where('pageId', '=', pageId)
      .limit(1)
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
  }

  async deleteExpiredHistoryBatch(limit = 500): Promise<number> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await sql<{ id: string }>`
      with expired as (
        select history.id
        from page_history as history
        inner join workspaces as workspace
          on workspace.id = history.workspace_id
        where workspace.page_history_retention_days is not null
          and history.created_at < now()
            - (workspace.page_history_retention_days * interval '1 day')
          and exists (
            select 1
            from page_history as newer
            where newer.page_id = history.page_id
              and (newer.created_at, newer.id)
                > (history.created_at, history.id)
            order by newer.created_at desc, newer.id desc
            offset 9
            limit 1
          )
        order by history.created_at asc, history.id asc
        limit ${safeLimit}
        for update of history skip locked
      )
      delete from page_history as history
      using expired
      where history.id = expired.id
      returning history.id
    `.execute(this.db);

    return result.rows.length;
  }

  withLastUpdatedBy(eb: ExpressionBuilder<DB, 'pageHistory'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'pageHistory.lastUpdatedById'),
    ).as('lastUpdatedBy');
  }

  withContributors(eb: ExpressionBuilder<DB, 'pageHistory'>) {
    return jsonArrayFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef(
          'users.id',
          '=',
          sql`ANY(${eb.ref('pageHistory.contributorIds')})`,
        ),
    ).as('contributors');
  }
}
