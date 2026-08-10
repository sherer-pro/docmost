import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  Comment,
  InsertableComment,
  UpdatableComment,
} from '@docmost/db/types/entity.types';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder } from 'kysely';
import type { DB } from '@docmost/db/types/db';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

type CommentPaginationOptions = {
  limit: number;
  cursor?: string;
  beforeCursor?: string;
};

export type CommentActor = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type CommentWithActors = Comment & {
  creator: CommentActor | null;
  resolvedBy: CommentActor | null;
};

@Injectable()
export class CommentRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  // todo, add workspaceId
  async findById(
    commentId: string,
    opts?: {
      includeCreator?: boolean;
      includeResolvedBy?: boolean;
      trx?: KyselyTransaction;
      withLock?: boolean;
    },
  ): Promise<Comment> {
    return await dbOrTx(this.db, opts?.trx)
      .selectFrom('comments')
      .selectAll('comments')
      .$if(opts?.includeCreator, (qb) => qb.select(this.withCreator))
      .$if(opts?.includeResolvedBy, (qb) => qb.select(this.withResolvedBy))
      .where('id', '=', commentId)
      .$if(opts?.withLock, (qb) => qb.forUpdate())
      .executeTakeFirst();
  }

  async findPageComments(pageId: string, pagination: CommentPaginationOptions) {
    const query = this.db
      .selectFrom('comments')
      .selectAll('comments')
      .select((eb) => this.withCreator(eb))
      .select((eb) => this.withResolvedBy(eb))
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'asc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  async findAllPageCommentsWithActors(
    pageId: string,
  ): Promise<CommentWithActors[]> {
    return this.db
      .selectFrom('comments')
      .selectAll('comments')
      .select((eb) => this.withCreator(eb))
      .select((eb) => this.withResolvedBy(eb))
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute() as Promise<CommentWithActors[]>;
  }

  async updateComment(
    updatableComment: UpdatableComment,
    commentId: string,
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('comments')
      .set(updatableComment)
      .where('id', '=', commentId)
      .execute();
  }

  async insertComment(
    insertableComment: InsertableComment,
    trx?: KyselyTransaction,
  ): Promise<Comment> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('comments')
      .values(insertableComment)
      .returningAll()
      .executeTakeFirst();
  }

  async countPageComments(
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const result = await dbOrTx(this.db, trx)
      .selectFrom('comments')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  withCreator(eb: ExpressionBuilder<DB, 'comments'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'comments.creatorId'),
    ).as('creator');
  }

  withResolvedBy(eb: ExpressionBuilder<DB, 'comments'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'comments.resolvedById'),
    ).as('resolvedBy');
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.db.deleteFrom('comments').where('id', '=', commentId).execute();
  }

  async hasChildren(commentId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('comments')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('parentCommentId', '=', commentId)
      .executeTakeFirst();

    return Number(result?.count) > 0;
  }

  async hasChildrenFromOtherUsers(
    commentId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.db
      .selectFrom('comments')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('parentCommentId', '=', commentId)
      .where('creatorId', '!=', userId)
      .executeTakeFirst();

    return Number(result?.count) > 0;
  }
}
