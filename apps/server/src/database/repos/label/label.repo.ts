import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { Label } from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { normalizeLabelName } from '../../../common/domain/label-name';
import { sql } from 'kysely';

export const LabelType = {
  PAGE: 'page',
} as const;

export type LabelType = (typeof LabelType)[keyof typeof LabelType];

@Injectable()
export class LabelRepo {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async findById(
    labelId: string,
    trx?: KyselyTransaction,
  ): Promise<Label | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('labels')
      .selectAll()
      .where('id', '=', labelId)
      .executeTakeFirst();
  }

  async findByNameAndSpace(
    name: string,
    workspaceId: string,
    spaceId: string,
    type: LabelType,
    trx?: KyselyTransaction,
  ): Promise<Label | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('labels')
      .selectAll()
      .where('name', '=', normalizeLabelName(name))
      .where('type', '=', type)
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .executeTakeFirst();
  }

  async findOrCreate(
    name: string,
    workspaceId: string,
    spaceId: string,
    type: LabelType,
    trx?: KyselyTransaction,
  ): Promise<Label> {
    const db = dbOrTx(this.db, trx);
    const normalizedName = normalizeLabelName(name);

    return db
      .insertInto('labels')
      .values({ name: normalizedName, type, workspaceId, spaceId })
      .onConflict((oc) =>
        oc
          .columns(['workspaceId', 'spaceId', 'type', 'name'])
          .doUpdateSet({ name: normalizedName }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findLabelsByPageId(pageId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('labels')
      .innerJoin('pageLabels', 'pageLabels.labelId', 'labels.id')
      .select([
        'labels.id',
        'labels.name',
        'labels.type',
        'labels.createdAt',
        'labels.updatedAt',
        'labels.workspaceId',
        'labels.spaceId',
        'pageLabels.id as joinId',
      ])
      .where('pageLabels.pageId', '=', pageId)
      .where('labels.type', '=', LabelType.PAGE);

    const result = await executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        { expression: 'pageLabels.id', direction: 'asc', key: 'joinId' },
      ],
      parseCursor: (cursor) => ({
        joinId: cursor.joinId,
      }),
    });

    return {
      ...result,
      items: result.items.map(({ joinId: _joinId, ...rest }) => rest),
    };
  }

  async findLabels(
    workspaceId: string,
    spaceId: string,
    type: LabelType,
    readablePageIds: ReadonlySet<string>,
    pagination: PaginationOptions,
  ) {
    let query = this.db
      .selectFrom('labels')
      .select([
        'id',
        'name',
        'type',
        'createdAt',
        'updatedAt',
        'workspaceId',
        'spaceId',
      ])
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('type', '=', type)
      .where(
        'id',
        'in',
        this.db
          .selectFrom('pageLabels')
          .innerJoin('pages', 'pages.id', 'pageLabels.pageId')
          .select('pageLabels.labelId')
          .where('pages.deletedAt', 'is', null)
          .where('pages.spaceId', '=', spaceId)
          .$if(readablePageIds.size > 0, (qb) =>
            qb.where('pages.id', 'in', Array.from(readablePageIds)),
          )
          .$if(readablePageIds.size === 0, (qb) =>
            qb.where(sql<boolean>`false`),
          ),
      );

    if (pagination.query) {
      query = query.where(
        'name',
        'like',
        `%${pagination.query.toLowerCase()}%`,
      );
    }

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        { expression: 'name', direction: 'asc' },
        { expression: 'id', direction: 'asc' },
      ],
      parseCursor: (cursor) => ({
        name: cursor.name,
        id: cursor.id,
      }),
    });
  }

  async findLabelRegistry(
    workspaceId: string,
    spaceId: string,
    type: LabelType,
    pagination: PaginationOptions,
  ) {
    let query = this.db
      .selectFrom('labels')
      .leftJoin('pageLabels', 'pageLabels.labelId', 'labels.id')
      .select((eb) => [
        'labels.id',
        'labels.name',
        'labels.type',
        'labels.createdAt',
        'labels.updatedAt',
        'labels.workspaceId',
        'labels.spaceId',
        eb.fn.count('pageLabels.id').as('pageCount'),
      ])
      .where('labels.workspaceId', '=', workspaceId)
      .where('labels.spaceId', '=', spaceId)
      .where('labels.type', '=', type)
      .groupBy([
        'labels.id',
        'labels.name',
        'labels.type',
        'labels.createdAt',
        'labels.updatedAt',
        'labels.workspaceId',
        'labels.spaceId',
      ]);

    if (pagination.query) {
      query = query.where(
        'labels.name',
        'like',
        `%${pagination.query.toLowerCase()}%`,
      );
    }

    const result = await executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        { expression: 'labels.name', direction: 'asc', key: 'name' },
        { expression: 'labels.id', direction: 'asc', key: 'id' },
      ],
      parseCursor: (cursor) => ({
        name: cursor.name,
        id: cursor.id,
      }),
    });

    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        pageCount: Number(item.pageCount),
      })),
    };
  }

  async renameLabel(
    labelId: string,
    name: string,
    workspaceId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<Label | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('labels')
      .set({ name: normalizeLabelName(name), updatedAt: new Date() })
      .where('id', '=', labelId)
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('type', '=', LabelType.PAGE)
      .returningAll()
      .executeTakeFirst();
  }

  async addLabelToPage(
    pageId: string,
    labelId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .insertInto('pageLabels')
      .values({ pageId, labelId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async removeLabelFromPage(
    pageId: string,
    labelId: string,
    workspaceId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .deleteFrom('pageLabels')
      .where('pageId', '=', pageId)
      .where('labelId', '=', labelId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('labels')
            .select('id')
            .whereRef('labels.id', '=', 'pageLabels.labelId')
            .where('labels.workspaceId', '=', workspaceId)
            .where('labels.spaceId', '=', spaceId),
        ),
      )
      .execute();
  }

  async getLabelPageCount(
    labelId: string,
    workspaceId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const db = dbOrTx(this.db, trx);
    const result = await db
      .selectFrom('pageLabels')
      .innerJoin('labels', 'labels.id', 'pageLabels.labelId')
      .select((eb) => eb.fn.count('pageLabels.id').as('count'))
      .where('pageLabels.labelId', '=', labelId)
      .where('labels.workspaceId', '=', workspaceId)
      .where('labels.spaceId', '=', spaceId)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  async deleteLabel(
    labelId: string,
    workspaceId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .deleteFrom('labels')
      .where('id', '=', labelId)
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .execute();
  }

  async findPagesByLabelId(
    labelId: string,
    userId: string,
    opts: {
      workspaceId: string;
      spaceId?: string;
      query?: string;
      readablePageIds?: ReadonlySet<string>;
      pagination: PaginationOptions;
    },
  ) {
    let query = this.db
      .selectFrom('pages')
      .innerJoin('pageLabels', 'pageLabels.pageId', 'pages.id')
      .innerJoin(
        'labels as filterLabel',
        'filterLabel.id',
        'pageLabels.labelId',
      )
      .select((eb) => [
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.icon',
        'pages.spaceId',
        'pages.createdAt',
        'pages.updatedAt',
        jsonObjectFrom(
          eb
            .selectFrom('spaces')
            .select(['spaces.id', 'spaces.name', 'spaces.slug', 'spaces.logo'])
            .whereRef('spaces.id', '=', 'pages.spaceId'),
        ).as('space'),
        jsonObjectFrom(
          eb
            .selectFrom('users')
            .select(['users.id', 'users.name', 'users.avatarUrl'])
            .whereRef('users.id', '=', 'pages.creatorId'),
        ).as('creator'),
        jsonArrayFrom(
          eb
            .selectFrom('labels')
            .innerJoin('pageLabels as pl', 'pl.labelId', 'labels.id')
            .select(['labels.id', 'labels.name', 'labels.spaceId'])
            .whereRef('pl.pageId', '=', 'pages.id')
            .whereRef('labels.spaceId', '=', 'pages.spaceId')
            .where('labels.type', '=', LabelType.PAGE)
            .orderBy('pl.id', 'asc'),
        ).as('labels'),
      ])
      .where('pageLabels.labelId', '=', labelId)
      .where('filterLabel.workspaceId', '=', opts.workspaceId)
      .where('filterLabel.type', '=', LabelType.PAGE)
      .whereRef('filterLabel.spaceId', '=', 'pages.spaceId')
      .where('pages.deletedAt', 'is', null);

    if (opts.spaceId) {
      query = query.where('pages.spaceId', '=', opts.spaceId);
    } else {
      query = query.where(
        'pages.spaceId',
        'in',
        this.spaceMemberRepo.getUserSpaceIdsQuery(userId),
      );
    }

    if (opts.readablePageIds) {
      query = query
        .$if(opts.readablePageIds.size > 0, (qb) =>
          qb.where('pages.id', 'in', Array.from(opts.readablePageIds!)),
        )
        .$if(opts.readablePageIds.size === 0, (qb) =>
          qb.where(sql<boolean>`false`),
        );
    }

    if (opts.query) {
      query = query.where('pages.title', 'ilike', `%${opts.query}%`);
    }

    return executeWithCursorPagination(query, {
      perPage: opts.pagination.limit,
      cursor: opts.pagination.cursor,
      beforeCursor: opts.pagination.beforeCursor,
      fields: [
        { expression: 'pages.updatedAt', direction: 'desc', key: 'updatedAt' },
        { expression: 'pages.id', direction: 'desc', key: 'id' },
      ],
      parseCursor: (cursor) => ({
        updatedAt: new Date(cursor.updatedAt),
        id: cursor.id,
      }),
    });
  }
}
