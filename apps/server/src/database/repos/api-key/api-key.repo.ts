import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  ApiKey,
  InsertableApiKey,
  UpdatableApiKey,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder } from 'kysely';
import { DB } from '@docmost/db/types/db';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

@Injectable()
export class ApiKeyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private baseFields: Array<keyof ApiKey> = [
    'id',
    'name',
    'creatorId',
    'workspaceId',
    'spaceId',
    'expiresAt',
    'lastUsedAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];

  async findById(
    apiKeyId: string,
    opts?: {
      includeCreator?: boolean;
      includeSpace?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<ApiKey> {
    const db = dbOrTx(this.db, opts?.trx);

    let query = db
      .selectFrom('apiKeys')
      .select(this.baseFields)
      .where('id', '=', apiKeyId);

    if (opts?.includeCreator) {
      query = query.select((eb) => this.withCreator(eb));
    }

    if (opts?.includeSpace) {
      query = query.select((eb) => this.withSpace(eb));
    }

    return query.executeTakeFirst();
  }

  async insertApiKey(
    payload: InsertableApiKey,
    trx?: KyselyTransaction,
  ): Promise<ApiKey> {
    const db = dbOrTx(this.db, trx);

    return db
      .insertInto('apiKeys')
      .values(payload)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async updateApiKey(
    apiKeyId: string,
    payload: UpdatableApiKey,
    trx?: KyselyTransaction,
  ): Promise<ApiKey> {
    const db = dbOrTx(this.db, trx);

    return db
      .updateTable('apiKeys')
      .set({ ...payload, updatedAt: new Date() })
      .where('id', '=', apiKeyId)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async listApiKeys(
    workspaceId: string,
    pagination: PaginationOptions,
    opts?: {
      creatorId?: string;
    },
  ) {
    let query = this.db
      .selectFrom('apiKeys')
      .select(this.baseFields)
      .select((eb) => this.withCreator(eb))
      .select((eb) => this.withSpace(eb))
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .$if(Boolean(opts?.creatorId), (qb) =>
        qb.where('creatorId', '=', opts?.creatorId),
      )
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc');

    if (pagination.query?.trim()) {
      query = query.where('name', 'ilike', `%${pagination.query.trim()}%`);
    }

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        { expression: 'createdAt', direction: 'desc' },
        { expression: 'id', direction: 'desc' },
      ],
      parseCursor: (cursor) => ({
        createdAt: new Date(cursor.createdAt),
        id: cursor.id,
      }),
    });
  }

  withCreator(eb: ExpressionBuilder<DB, 'apiKeys'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'apiKeys.creatorId'),
    ).as('creator');
  }

  withSpace(eb: ExpressionBuilder<DB, 'apiKeys'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('spaces')
        .select(['spaces.id', 'spaces.name', 'spaces.slug'])
        .whereRef('spaces.id', '=', 'apiKeys.spaceId'),
    ).as('space');
  }
}
