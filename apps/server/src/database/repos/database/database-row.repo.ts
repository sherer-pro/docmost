import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  DatabaseRow,
  InsertableDatabaseRow,
  UpdatableDatabaseRow,
} from '@docmost/db/types/entity.types';
import {
  defaultDecodeCursor,
  defaultEncodeCursor,
  executeWithCursorPagination,
} from '@docmost/db/pagination/cursor-pagination';
import { RawBuilder, sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';

interface IDatabaseRowsFilterCondition {
  propertyId: string;
  operator: 'contains' | 'equals' | 'not_equals';
  value: string;
}

@Injectable()
export class DatabaseRowRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private buildRowsQuery(
    databaseId: string,
    workspaceId: string,
    spaceId: string,
  ) {
    return this.db
      .selectFrom('databaseRows')
      .innerJoin('pages', 'pages.id', 'databaseRows.pageId')
      .select('databaseRows.id')
      .select('databaseRows.databaseId')
      .select('databaseRows.workspaceId')
      .select('databaseRows.pageId')
      .select('databaseRows.createdById')
      .select('databaseRows.updatedById')
      .select('databaseRows.createdAt')
      .select('databaseRows.updatedAt')
      .select('databaseRows.archivedAt')
      .select('pages.title as pageTitle')
      .select('pages.slugId as pageSlugId')
      .select('pages.position as pagePosition')
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('pages as p')
            .innerJoin('spaces as s', 's.id', 'p.spaceId')
            .select(['p.id', 'p.slugId', 'p.title', 'p.icon', 'p.parentPageId', 'p.position'])
            /**
             * We create customFields using the same scheme as the page API:
             * data source - page.settings.
             *
             * Additionally, we apply visibility rules for the assignee/stakeholders fields
             * based on the settings.documentFields of a specific space.
             */
            .select(
              sql`jsonb_build_object(
                'status', p.settings -> 'status',
                'assigneeId', CASE
                  WHEN COALESCE((s.settings -> 'documentFields' ->> 'assignee')::boolean, false)
                    THEN p.settings -> 'assigneeId'
                  ELSE 'null'::jsonb
                END,
                'stakeholderIds', CASE
                  WHEN COALESCE((s.settings -> 'documentFields' ->> 'stakeholders')::boolean, false)
                    THEN COALESCE(p.settings -> 'stakeholderIds', '[]'::jsonb)
                  ELSE '[]'::jsonb
                END
              )`.as('customFields'),
            )
            .whereRef('p.id', '=', 'databaseRows.pageId'),
        ).as('page'),
      )
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('databaseCells')
            .select([
              'id',
              'databaseId',
              'workspaceId',
              'pageId',
              'propertyId',
              'value',
              'attachmentId',
              'createdById',
              'updatedById',
              'createdAt',
              'updatedAt',
              'deletedAt',
            ])
            .whereRef('databaseCells.databaseId', '=', 'databaseRows.databaseId')
            .whereRef('databaseCells.pageId', '=', 'databaseRows.pageId')
            .where('databaseCells.deletedAt', 'is', null),
        ).as('cells'),
      )
      .where('databaseId', '=', databaseId)
      .where('databaseRows.workspaceId', '=', workspaceId)
      .where('pages.workspaceId', '=', workspaceId)
      .where('pages.spaceId', '=', spaceId)
      .where('pages.deletedAt', 'is', null)
      .where('databaseRows.archivedAt', 'is', null);
  }

  private buildCellComparableTextExpression(cellAlias: string): RawBuilder<string> {
    const valueRef = sql.ref(`${cellAlias}.value`);

    return sql<string>`
      lower(
        coalesce(
          case
            when jsonb_typeof(${valueRef}) = 'string'
              then trim(both '"' from (${valueRef}::text))
            when jsonb_typeof(${valueRef}) = 'boolean'
              then ${valueRef}::text
            when jsonb_typeof(${valueRef}) = 'number'
              then ${valueRef}::text
            when jsonb_typeof(${valueRef}) = 'object'
              then coalesce(
                ${valueRef} ->> 'name',
                ${valueRef} ->> 'label',
                ${valueRef} ->> 'value',
                ${valueRef} ->> 'id',
                ${valueRef}::text
              )
            else coalesce(${valueRef}::text, '')
          end,
          ''
        )
      )
    `;
  }

  private buildRowCellComparableValueExpression(params: {
    rowAlias: string;
    propertyId: string;
  }): RawBuilder<string> {
    const cellQuery = this.db
      .selectFrom('databaseCells as filterCell')
      .select(() => this.buildCellComparableTextExpression('filterCell').as('value'))
      .whereRef(
        'filterCell.databaseId',
        '=',
        `${params.rowAlias}.databaseId` as any,
      )
      .whereRef(
        'filterCell.pageId',
        '=',
        `${params.rowAlias}.pageId` as any,
      )
      .where('filterCell.propertyId', '=', params.propertyId)
      .where('filterCell.deletedAt', 'is', null)
      .limit(1);

    return sql<string>`coalesce((${cellQuery}), '')`;
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }

  /**
   * Creates a database row associated with a page.
   */
  async insertRow(
    payload: InsertableDatabaseRow,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRow> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseRows')
      .values(payload)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Finds a string by ID.
   */
  async findById(rowId: string): Promise<DatabaseRow> {
    return this.db
      .selectFrom('databaseRows')
      .selectAll()
      .where('id', '=', rowId)
      .executeTakeFirst();
  }

  /**
   * Returns all rows of a specific database.
   */
  async findByDatabaseId(
    databaseId: string,
    workspaceId: string,
    spaceId: string,
  ): Promise<any[]> {
    return this.buildRowsQuery(databaseId, workspaceId, spaceId)
      /**
       * The order of rows in the tree is determined by the page position,
       * and not the creation time of databaseRows.
       *
       * COLLATE "C" provides stable lexicographic collation
       * for fractional indexing of keys.
       */
      .orderBy(sql`"pages"."position" collate "C"`, 'asc')
      .execute();
  }

  async findByDatabaseIdPaginated(
    databaseId: string,
    workspaceId: string,
    spaceId: string,
    options: {
      limit: number;
      cursor?: string;
      sortField?: 'position' | 'title';
      sortDirection?: 'asc' | 'desc';
      sortPropertyId?: string;
      filters?: IDatabaseRowsFilterCondition[];
    },
  ): Promise<{
    items: any[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const sortField = options.sortField ?? 'position';
    const sortDirection = options.sortDirection ?? 'asc';

    let query = this.buildRowsQuery(databaseId, workspaceId, spaceId);
    const filters = options.filters ?? [];

    for (const condition of filters) {
      if (!condition) {
        continue;
      }

      const normalizedFilterValue = condition.value.toLowerCase();
      const cellValueExpression = this.buildRowCellComparableValueExpression({
        rowAlias: 'databaseRows',
        propertyId: condition.propertyId,
      });

      if (condition.operator === 'equals') {
        query = query.where(cellValueExpression, '=', normalizedFilterValue);
        continue;
      }

      if (condition.operator === 'not_equals') {
        query = query.where(cellValueExpression, '!=', normalizedFilterValue);
        continue;
      }

      const likePattern = `%${this.escapeLikePattern(normalizedFilterValue)}%`;
      query = query.where(
        sql<boolean>`${cellValueExpression} like ${likePattern} escape '\\'`,
      );
    }

    const pagePositionExpression =
      sql<string>`coalesce(${sql.ref('pages.position')}, '') collate "C"`;
    const pageIdExpression =
      sql<string>`${sql.ref('databaseRows.pageId')}::text collate "C"`;

    const isPropertySort = Boolean(options.sortPropertyId);
    const isTitleSort = !isPropertySort && sortField === 'title';

    if (isPropertySort || isTitleSort) {
      const sortValueExpression = isPropertySort
        ? sql<string>`(${this.buildRowCellComparableValueExpression({
            rowAlias: 'databaseRows',
            propertyId: options.sortPropertyId as string,
          })}) collate "C"`
        : sql<string>`lower(coalesce(${sql.ref('pages.title')}, '')) collate "C"`;

      query = query.select(sortValueExpression.as('sortValue'));

      const executeCursorPagination = executeWithCursorPagination as any;
      const paginated = await executeCursorPagination(query as any, {
        perPage: options.limit,
        cursor: options.cursor,
        fields: [
          { expression: sortValueExpression, direction: sortDirection, key: 'sortValue' },
          { expression: pagePositionExpression, direction: sortDirection, key: 'pagePosition' },
          { expression: pageIdExpression, direction: sortDirection, key: 'pageId' },
        ] as const,
        parseCursor: (cursor) => ({
          sortValue: cursor.sortValue,
          pagePosition: cursor.pagePosition,
          pageId: cursor.pageId,
        }),
      });

      const items = paginated.items.map((item) => {
        const { sortValue: _sortValue, ...row } = item as Record<string, unknown>;
        return row;
      });

      return {
        items,
        nextCursor: paginated.meta.nextCursor,
        hasMore: paginated.meta.hasNextPage,
      };
    }

    let normalizedCursor = options.cursor;
    if (normalizedCursor) {
      try {
        defaultDecodeCursor(normalizedCursor, ['pagePosition', 'pageId'] as any);
      } catch {
        normalizedCursor = defaultEncodeCursor([
          ['pagePosition', normalizedCursor],
          ['pageId', ''],
        ] as any);
      }
    }

    const executeCursorPagination = executeWithCursorPagination as any;
    const paginated = await executeCursorPagination(query as any, {
      perPage: options.limit,
      cursor: normalizedCursor,
      fields: [
        { expression: pagePositionExpression, direction: sortDirection, key: 'pagePosition' },
        { expression: pageIdExpression, direction: sortDirection, key: 'pageId' },
      ] as const,
      parseCursor: (cursor) => ({
        pagePosition: cursor.pagePosition,
        pageId: cursor.pageId,
      }),
    });

    return {
      items: paginated.items as any[],
      nextCursor: paginated.meta.nextCursor,
      hasMore: paginated.meta.hasNextPage,
    };
  }


  async findActiveByPageId(
    pageId: string,
    workspaceId: string,
  ): Promise<DatabaseRow> {
    return this.db
      .selectFrom('databaseRows')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Finds a row based on the databaseId/pageId pair.
   */
  async findByDatabaseAndPage(
    databaseId: string,
    pageId: string,
  ): Promise<DatabaseRow> {
    return this.db
      .selectFrom('databaseRows')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .where('pageId', '=', pageId)
      .executeTakeFirst();
  }

  /**
   * Updates row data.
   */
  async updateRow(
    id: string,
    payload: UpdatableDatabaseRow,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRow> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({ ...payload, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async archiveByPageIds(
    databaseId: string,
    workspaceId: string,
    pageIds: string[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }

    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('pageId', 'in', pageIds)
      .where('archivedAt', 'is', null)
      .execute();
  }

  /**
   * Archives all database rows while archiving the database itself.
   */
  async archiveByDatabaseId(
    databaseId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is', null)
      .execute();
  }

  /**
   * Gently unbinds a row from the active state of the database.
   *
   * The physical record is not deleted and the pageId is saved as a snapshot of the connection.
   * which allows you to restore the string during reverse conversion.
   */
  async softDetachRowLink(
    databaseId: string,
    pageId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is', null)
      .execute();
  }

  /**
   * Restores a previously unlinked database row.
   */
  async restoreRowLink(
    databaseId: string,
    pageId: string,
    workspaceId: string,
    actorId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({
        archivedAt: null,
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where('databaseId', '=', databaseId)
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is not', null)
      .execute();
  }

  /**
   * Restores references of all database rows.
   */
  async restoreByDatabaseId(
    databaseId: string,
    workspaceId: string,
    actorId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({
        archivedAt: null,
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is not', null)
      .execute();
  }

}
