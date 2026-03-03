import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  Database,
  InsertableDatabase,
  UpdatableDatabase,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DatabaseRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * Creates a new database entry in the space.
   */
  async insertDatabase(
    payload: InsertableDatabase,
    trx?: KyselyTransaction,
  ): Promise<Database> {
    return dbOrTx(this.db, trx)
      .insertInto('databases')
      .values(payload)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Returns a database by identifier taking into account the workspace.
   */
  async findById(id: string, workspaceId: string): Promise<Database> {
    return this.db
      .selectFrom('databases')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Returns the active database by pageId within the workspace.
   */
  async findByPageId(pageId: string, workspaceId: string): Promise<Database> {
    return this.db
      .selectFrom('databases')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Returns the database by pageId without filtering by deletedAt.
   *
   * Used for reversible page↔database conversion,
   * when you need to restore a previously deactivated database.
   */
  async findByPageIdIncludingDeleted(
    pageId: string,
    workspaceId: string,
  ): Promise<Database> {
    return this.db
      .selectFrom('databases')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  /**
   * Returns a list of databases in the specified space.
   */
  async findBySpaceId(spaceId: string, workspaceId: string): Promise<Database[]> {
    return this.db
      .selectFrom('databases')
      .selectAll()
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  /**
   * Updates database fields.
   */
  async updateDatabase(
    id: string,
    workspaceId: string,
    payload: UpdatableDatabase,
    trx?: KyselyTransaction,
  ): Promise<Database> {
    return dbOrTx(this.db, trx)
      .updateTable('databases')
      .set({ ...payload, updatedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Performs a soft delete of the database.
   *
   * We do not physically delete the record so as not to lose the audit and not break connections.
   */
  async softDeleteDatabase(
    id: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<Database> {
    return dbOrTx(this.db, trx)
      .updateTable('databases')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Recovers a previously soft-deleted database.
   */
  async restoreDatabase(
    id: string,
    workspaceId: string,
    payload: Pick<UpdatableDatabase, 'lastUpdatedById'>,
    trx?: KyselyTransaction,
  ): Promise<Database> {
    return dbOrTx(this.db, trx)
      .updateTable('databases')
      .set({
        deletedAt: null,
        lastUpdatedById: payload.lastUpdatedById,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }
}
