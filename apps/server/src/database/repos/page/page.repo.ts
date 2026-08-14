import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx, executeTx } from '../../utils';
import {
  InsertablePage,
  Page,
  UpdatablePage,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder, sql } from 'kysely';
import type { DB } from '@docmost/db/types/db';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import { MAX_PAGE_TREE_DEPTH } from '../../../common/config/page-tree.constants';
import {
  getPageIdentifierColumn,
  PageIdentifier,
  resolveCanonicalPageId,
  splitPageIdentifiers,
} from './page-identifier.util';

/**
 * Identifier strategy in PageRepo:
 * - read/update/delete accept mixed identifiers (UUID + slugId);
 * - remove/restore accept mixed identifiers but always resolve to UUID,
 *   because recursive CTE queries and relations operate on `pages.id`.
 */

@Injectable()
export class PageRepo {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private spaceMemberRepo: SpaceMemberRepo,
    private eventEmitter: EventEmitter2,
  ) {}

  private baseFields: Array<keyof Page> = [
    'id',
    'slugId',
    'title',
    'icon',
    'coverPhoto',
    'position',
    'parentPageId',
    'creatorId',
    'lastUpdatedById',
    'spaceId',
    'workspaceId',
    'settings',
    'isLocked',
    'templateKind',
    'templateArchivedAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'contributorIds',
  ];

  /**
   * Normalizes page jsonb settings before writing to the database.
   */
  private normalizeSettings<T extends InsertablePage | UpdatablePage>(
    payload: T,
  ): T {
    if (!('settings' in payload) || payload.settings === undefined) {
      return payload;
    }

    if (payload.settings === null || typeof payload.settings === 'object') {
      return payload;
    }

    return {
      ...payload,
      settings: null,
    };
  }

  /**
   * Resolves a mixed page identifier into UUID `pages.id`.
   *
   * UUID input is returned as-is, while `slugId` is resolved via lookup.
   */
  private async resolvePageId(
    pageIdentifier: PageIdentifier,
    trx?: KyselyTransaction,
  ): Promise<string | null> {
    return resolveCanonicalPageId(pageIdentifier, async (slugId) => {
      const page = await this.findBySlugId(slugId, { trx });
      return page?.id ?? null;
    });
  }

  async findById(
    pageId: string,
    opts?: {
      includeContent?: boolean;
      includeTextContent?: boolean;
      includeYdoc?: boolean;
      includeSpace?: boolean;
      includeCreator?: boolean;
      includeLastUpdatedBy?: boolean;
      includeContributors?: boolean;
      includeHasChildren?: boolean;
      withLock?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<Page> {
    /**
     * Compatibility with old clients:
     * endpoint /api/pages/info can historically receive both the UUID `id`,
     * and the short route identifier `slugId`.
     */
    return this.findByIdentifier(getPageIdentifierColumn(pageId), pageId, opts);
  }

  /**
   * Searches for a page by route/public identifier `slugId`.
   *
   * Use this method for input parameters from URLs and public APIs,
   * so as not to mix them with the internal UUID of the `id` field.
   */
  async findBySlugId(
    pageSlugId: string,
    opts?: {
      includeContent?: boolean;
      includeTextContent?: boolean;
      includeYdoc?: boolean;
      includeSpace?: boolean;
      includeCreator?: boolean;
      includeLastUpdatedBy?: boolean;
      includeContributors?: boolean;
      includeHasChildren?: boolean;
      withLock?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<Page> {
    return this.findByIdentifier('slugId', pageSlugId, opts);
  }

  /**
   * General implementation of searching a page using a specific identifier field.
   */
  private async findByIdentifier(
    identifierColumn: 'id' | 'slugId',
    identifierValue: string,
    opts?: {
      includeContent?: boolean;
      includeTextContent?: boolean;
      includeYdoc?: boolean;
      includeSpace?: boolean;
      includeCreator?: boolean;
      includeLastUpdatedBy?: boolean;
      includeContributors?: boolean;
      includeHasChildren?: boolean;
      withLock?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<Page> {
    const db = dbOrTx(this.db, opts?.trx);

    let query = db
      .selectFrom('pages')
      .select(this.baseFields)
      .$if(opts?.includeContent, (qb) => qb.select('content'))
      .$if(opts?.includeYdoc, (qb) => qb.select('ydoc'))
      .$if(opts?.includeTextContent, (qb) => qb.select('textContent'))
      .$if(opts?.includeHasChildren, (qb) =>
        qb.select((eb) => this.withHasChildren(eb)),
      );

    if (opts?.includeCreator) {
      query = query.select((eb) => this.withCreator(eb));
    }

    if (opts?.includeLastUpdatedBy) {
      query = query.select((eb) => this.withLastUpdatedBy(eb));
    }

    if (opts?.includeContributors) {
      query = query.select((eb) => this.withContributors(eb));
    }

    if (opts?.includeSpace) {
      query = query.select((eb) => this.withSpace(eb));
    }

    if (opts?.withLock && opts?.trx) {
      query = query.forUpdate();
    }

    query = query.where(identifierColumn, '=', identifierValue);

    return query.executeTakeFirst();
  }

  async updatePage(
    updatablePage: UpdatablePage,
    pageId: PageIdentifier,
    trx?: KyselyTransaction,
    emitEvent = true,
  ) {
    return this.updatePages(
      this.normalizeSettings(updatablePage),
      [pageId],
      trx,
      emitEvent,
    );
  }

  /**
   * Updates pages based on a set of mixed identifiers:
   * UUID of the `id` field and/or string `slugId`.
   */
  async updatePages(
    updatePageData: UpdatablePage,
    pageIds: PageIdentifier[],
    trx?: KyselyTransaction,
    emitEvent = true,
  ) {
    const { uuidIds, slugIds } = splitPageIdentifiers(pageIds);

    if (uuidIds.length === 0 && slugIds.length === 0) {
      return {
        numUpdatedRows: BigInt(0),
      };
    }

    const result = await dbOrTx(this.db, trx)
      .updateTable('pages')
      .set({ ...this.normalizeSettings(updatePageData), updatedAt: new Date() })
      .where((eb) => {
        const conditions = [];

        if (uuidIds.length > 0) {
          conditions.push(eb('id', 'in', uuidIds));
        }

        if (slugIds.length > 0) {
          conditions.push(eb('slugId', 'in', slugIds));
        }

        if (conditions.length === 1) {
          return conditions[0];
        }

        return eb.or(conditions);
      })
      .executeTakeFirst();

    if (emitEvent) {
      this.eventEmitter.emit(EventName.PAGE_UPDATED, {
        pageIds: pageIds,
        workspaceId: updatePageData.workspaceId,
      });
    }

    return result;
  }

  async insertPage(
    insertablePage: InsertablePage,
    trx?: KyselyTransaction,
    emitEvent = true,
  ): Promise<Page> {
    const db = dbOrTx(this.db, trx);
    const result = await db
      .insertInto('pages')
      .values(this.normalizeSettings(insertablePage))
      .returning(this.baseFields)
      .executeTakeFirst();

    if (emitEvent) {
      this.eventEmitter.emit(EventName.PAGE_CREATED, {
        pageIds: [result.id],
        workspaceId: result.workspaceId,
      });
    }

    return result;
  }

  async deletePage(pageId: string): Promise<void> {
    let query = this.db.deleteFrom('pages');

    query = query.where(getPageIdentifierColumn(pageId), '=', pageId);

    await query.execute();
  }

  async removePage(
    pageIdentifier: PageIdentifier,
    deletedById: string,
    workspaceId: string,
  ): Promise<void> {
    const pageId = await this.resolvePageId(pageIdentifier);

    if (!pageId) {
      return;
    }

    const currentDate = new Date();

    const descendants = await this.db
      .withRecursive('page_descendants', (db) =>
        db
          .selectFrom('pages')
          .select(['id', sql<number>`0`.as('level')])
          .where('id', '=', pageId)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select(['p.id', sql<number>`pd.level + 1`.as('level')])
              .innerJoin('page_descendants as pd', 'pd.id', 'p.parentPageId')
              .where(sql`pd.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
          ),
      )
      .selectFrom('page_descendants')
      .select(['id'])
      .execute();

    const pageIds = descendants.map((d) => d.id);

    if (pageIds.length > 0) {
      await executeTx(this.db, async (trx) => {
        await trx
          .updateTable('pages')
          .set({
            deletedById: deletedById,
            deletedAt: currentDate,
          })
          .where('id', 'in', pageIds)
          .execute();

        await trx.deleteFrom('shares').where('pageId', 'in', pageIds).execute();
      });

      this.eventEmitter.emit(EventName.PAGE_SOFT_DELETED, {
        pageIds: pageIds,
        workspaceId,
      });
    }
  }

  async restorePage(
    pageIdentifier: PageIdentifier,
    workspaceId: string,
  ): Promise<string[]> {
    let restoredPageIds: string[] = [];

    await executeTx(this.db, async (trx) => {
      const pageId = await this.resolvePageId(pageIdentifier, trx);
      if (!pageId) {
        return;
      }

      const pageToRestore = await trx
        .selectFrom('pages')
        .select(['id', 'parentPageId', 'spaceId'])
        .where('id', '=', pageId)
        .where('workspaceId', '=', workspaceId)
        .executeTakeFirst();

      if (!pageToRestore) {
        return;
      }

      let shouldDetachFromParent = false;
      if (pageToRestore.parentPageId) {
        const parent = await trx
          .selectFrom('pages')
          .select(['id', 'deletedAt', 'spaceId', 'workspaceId'])
          .where('id', '=', pageToRestore.parentPageId)
          .executeTakeFirst();

        shouldDetachFromParent =
          !parent ||
          parent.deletedAt !== null ||
          parent.spaceId !== pageToRestore.spaceId ||
          parent.workspaceId !== workspaceId;
      }

      const pages = await trx
        .withRecursive('page_descendants', (db) =>
          db
            .selectFrom('pages')
            .select(['id', sql<number>`0`.as('level')])
            .where('id', '=', pageId)
            .unionAll((exp) =>
              exp
                .selectFrom('pages as p')
                .select(['p.id', sql<number>`pd.level + 1`.as('level')])
                .innerJoin('page_descendants as pd', 'pd.id', 'p.parentPageId')
                .where(sql`pd.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
            ),
        )
        .selectFrom('page_descendants')
        .select(['id'])
        .execute();

      restoredPageIds = pages.map((page) => page.id);
      if (restoredPageIds.length === 0) {
        return;
      }

      await trx
        .updateTable('pages')
        .set({ deletedById: null, deletedAt: null })
        .where('id', 'in', restoredPageIds)
        .execute();

      if (shouldDetachFromParent) {
        await trx
          .updateTable('pages')
          .set({ parentPageId: null })
          .where('id', '=', pageId)
          .execute();
      }
    });

    if (restoredPageIds.length > 0) {
      this.eventEmitter.emit(EventName.PAGE_RESTORED, {
        pageIds: restoredPageIds,
        workspaceId,
      });
    }
    return restoredPageIds;
  }

  async getRecentPagesInSpace(spaceId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('pages')
      .select(this.baseFields)
      .select((eb) => this.withSpace(eb))
      .select((eb) => this.withDatabaseId(eb))
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .where('templateKind', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        { expression: 'updatedAt', direction: 'desc' },
        { expression: 'id', direction: 'desc' },
      ],
      parseCursor: (cursor) => ({
        updatedAt: new Date(cursor.updatedAt),
        id: cursor.id,
      }),
    });
  }

  async getRecentPages(userId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('pages')
      .select(this.baseFields)
      .select((eb) => this.withSpace(eb))
      .select((eb) => this.withDatabaseId(eb))
      .where('spaceId', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(userId))
      .where('deletedAt', 'is', null)
      .where('templateKind', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        { expression: 'updatedAt', direction: 'desc' },
        { expression: 'id', direction: 'desc' },
      ],
      parseCursor: (cursor) => ({
        updatedAt: new Date(cursor.updatedAt),
        id: cursor.id,
      }),
    });
  }

  async getDeletedPagesInSpace(spaceId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('pages')
      .select(this.baseFields)
      .select('content')
      .select((eb) => this.withSpace(eb))
      .select((eb) => this.withDeletedBy(eb))
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is not', null)
      // Only include pages that are either root pages (no parent) or whose parent is not deleted
      // This prevents showing orphaned pages when their parent has been soft-deleted
      .where((eb) =>
        eb.or([
          eb('parentPageId', 'is', null),
          eb.not(
            eb.exists(
              eb
                .selectFrom('pages as parent')
                .select('parent.id')
                .where('parent.id', '=', eb.ref('pages.parentPageId'))
                .where('parent.deletedAt', 'is not', null),
            ),
          ),
        ]),
      );

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        { expression: 'deletedAt', direction: 'desc' },
        { expression: 'id', direction: 'desc' },
      ],
      parseCursor: (cursor) => ({
        deletedAt: new Date(cursor.deletedAt),
        id: cursor.id,
      }),
    });
  }

  withSpace(eb: ExpressionBuilder<DB, 'pages'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('spaces')
        // Include space settings so the page can access
        // custom document fields enabled at the space level (space.settings.documentFields).
        .select(['spaces.id', 'spaces.name', 'spaces.slug', 'spaces.settings'])
        .whereRef('spaces.id', '=', 'pages.spaceId'),
    ).as('space');
  }

  withDatabaseId(eb: ExpressionBuilder<DB, 'pages'>) {
    return eb
      .selectFrom('databases')
      .select('databases.id')
      .whereRef('databases.pageId', '=', 'pages.id')
      .where('databases.deletedAt', 'is', null)
      .limit(1)
      .as('databaseId');
  }

  withCreator(eb: ExpressionBuilder<DB, 'pages'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'pages.creatorId'),
    ).as('creator');
  }

  withLastUpdatedBy(eb: ExpressionBuilder<DB, 'pages'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'pages.lastUpdatedById'),
    ).as('lastUpdatedBy');
  }

  withDeletedBy(eb: ExpressionBuilder<DB, 'pages'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'pages.deletedById'),
    ).as('deletedBy');
  }

  withContributors(eb: ExpressionBuilder<DB, 'pages'>) {
    return jsonArrayFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', sql`ANY(${eb.ref('pages.contributorIds')})`),
    ).as('contributors');
  }

  withHasChildren(eb: ExpressionBuilder<DB, 'pages'>) {
    return eb
      .selectFrom('pages as child')
      .select((eb) =>
        eb
          .case()
          .when(eb.fn.countAll(), '>', 0)
          .then(true)
          .else(false)
          .end()
          .as('count'),
      )
      .whereRef('child.parentPageId', '=', 'pages.id')
      .where('child.deletedAt', 'is', null)
      .where('child.templateKind', 'is', null)
      .limit(1)
      .as('hasChildren');
  }

  /**
   * Checks whether `ancestorPageId` is `pageId` itself or one of its ancestors.
   *
   * Used to reject moves that would place a page under its own descendant,
   * which would create a cycle in `pages.parent_page_id`. The traversal is
   * depth-bounded so it terminates even if a cycle already exists.
   */
  async hasSelfOrAncestor(
    pageId: string,
    ancestorPageId: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    const db = dbOrTx(this.db, trx);

    const match = await db
      .withRecursive('page_ancestors', (qb) =>
        qb
          .selectFrom('pages')
          .select(['id', 'parentPageId', sql<number>`0`.as('level')])
          .where('id', '=', pageId)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select([
                'p.id',
                'p.parentPageId',
                sql<number>`pa.level + 1`.as('level'),
              ])
              .innerJoin('page_ancestors as pa', 'pa.parentPageId', 'p.id')
              .where(sql`pa.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
          ),
      )
      .selectFrom('page_ancestors')
      .select('id')
      .where('id', '=', ancestorPageId)
      .limit(1)
      .executeTakeFirst();

    return Boolean(match);
  }

  /**
   * Returns the zero-based depth of a page in its ancestor chain.
   *
   * The extra traversal level lets callers detect an already malformed chain
   * instead of treating the configured limit as a valid truncated result.
   */
  async getPageDepth(pageId: string, trx?: KyselyTransaction): Promise<number> {
    const db = dbOrTx(this.db, trx);

    const result = await db
      .withRecursive('page_ancestors', (qb) =>
        qb
          .selectFrom('pages')
          .select(['id', 'parentPageId', sql<number>`0`.as('level')])
          .where('id', '=', pageId)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select([
                'p.id',
                'p.parentPageId',
                sql<number>`pa.level + 1`.as('level'),
              ])
              .innerJoin('page_ancestors as pa', 'pa.parentPageId', 'p.id')
              .where(sql`pa.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH + 1)),
          ),
      )
      .selectFrom('page_ancestors')
      .select((eb) => eb.fn.max<number>('level').as('depth'))
      .executeTakeFirst();

    return Number(result?.depth ?? 0);
  }

  /**
   * Returns the zero-based height of a page subtree, including deleted pages.
   *
   * Deleted descendants still keep their parent relation and may be restored,
   * so a move must account for them when enforcing the structural depth cap.
   */
  async getSubtreeHeight(
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const db = dbOrTx(this.db, trx);

    const result = await db
      .withRecursive('page_descendants', (qb) =>
        qb
          .selectFrom('pages')
          .select(['id', sql<number>`0`.as('level')])
          .where('id', '=', pageId)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select(['p.id', sql<number>`pd.level + 1`.as('level')])
              .innerJoin('page_descendants as pd', 'p.parentPageId', 'pd.id')
              .where(sql`pd.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH + 1)),
          ),
      )
      .selectFrom('page_descendants')
      .select((eb) => eb.fn.max<number>('level').as('height'))
      .executeTakeFirst();

    return Number(result?.height ?? 0);
  }

  async getPageAndDescendants(
    parentPageId: string,
    opts: {
      includeContent: boolean;
      includeDeleted?: boolean;
      trx?: KyselyTransaction;
    },
  ) {
    const db = dbOrTx(this.db, opts.trx);
    return (
      db
        .withRecursive('page_hierarchy', (db) =>
          db
            .selectFrom('pages')
            .select([
              'id',
              'slugId',
              'title',
              'icon',
              'position',
              'parentPageId',
              'spaceId',
              'workspaceId',
              'settings',
              'createdAt',
              'updatedAt',
              sql<number>`0`.as('level'),
            ])
            .$if(opts?.includeContent, (qb) => qb.select('content'))
            .where('id', '=', parentPageId)
            .$if(!opts.includeDeleted, (qb) =>
              qb.where('deletedAt', 'is', null),
            )
            .where('templateKind', 'is', null)
            .unionAll((exp) =>
              exp
                .selectFrom('pages as p')
                .select([
                  'p.id',
                  'p.slugId',
                  'p.title',
                  'p.icon',
                  'p.position',
                  'p.parentPageId',
                  'p.spaceId',
                  'p.workspaceId',
                  'p.settings',
                  'p.createdAt',
                  'p.updatedAt',
                  sql<number>`ph.level + 1`.as('level'),
                ])
                .$if(opts?.includeContent, (qb) => qb.select('p.content'))
                .innerJoin('page_hierarchy as ph', 'p.parentPageId', 'ph.id')
                .$if(!opts.includeDeleted, (qb) =>
                  qb.where('p.deletedAt', 'is', null),
                )
                .where('p.templateKind', 'is', null)
                .where(sql`ph.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
            ),
        )
        .selectFrom('page_hierarchy')
        // `level` only bounds the traversal; it must not leak into page payloads.
        .select([
          'id',
          'slugId',
          'title',
          'icon',
          'position',
          'parentPageId',
          'spaceId',
          'workspaceId',
          'settings',
          'createdAt',
          'updatedAt',
        ])
        .$if(opts?.includeContent, (qb) => qb.select('content'))
        .execute()
    );
  }
}
