import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  DatabaseView,
  InsertableDatabaseView,
  UpdatableDatabaseView,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DatabaseViewRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * Creates a view (for example, table/board/calendar) for the database.
   */
  async insertView(
    payload: InsertableDatabaseView,
    trx?: KyselyTransaction,
  ): Promise<DatabaseView> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseViews')
      .values(payload)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Returns a list of database views.
   */
  async findByDatabaseId(databaseId: string): Promise<DatabaseView[]> {
    return this.db
      .selectFrom('databaseViews')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  /**
   * Returns one view by id.
   */
  async findById(viewId: string): Promise<DatabaseView> {
    return this.db
      .selectFrom('databaseViews')
      .selectAll()
      .where('id', '=', viewId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Updates view settings.
   */
  async updateView(
    id: string,
    payload: UpdatableDatabaseView,
    trx?: KyselyTransaction,
  ): Promise<DatabaseView> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseViews')
      .set({ ...payload, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Gently deletes the view.
   */
  async softDeleteView(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseView> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseViews')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }
  /**
   * Gently deletes all database views when archiving.
   */
  async softDeleteByDatabaseId(
    databaseId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseViews')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  /**
   * Restores database views after conversion back to database.
   */
  async restoreByDatabaseId(
    databaseId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseViews')
      .set({ deletedAt: null, updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is not', null)
      .execute();
  }

}
