import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  DatabaseCell,
  InsertableDatabaseCell,
  UpdatableDatabaseCell,
} from '@docmost/db/types/entity.types';
import { RawBuilder, sql } from 'kysely';

@Injectable()
export class DatabaseCellRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * Converts any cell value into a jsonb expression to keep insert and
   * conflict-update branches on the same PostgreSQL serialization strategy.
   */
  private toJsonbValue(value: InsertableDatabaseCell['value']): RawBuilder<unknown> {
    return sql`${JSON.stringify(value ?? null)}::jsonb`;
  }

  /**
   * Creates a cell value for a specific row and property.
   */
  async insertCell(
    payload: InsertableDatabaseCell,
    trx?: KyselyTransaction,
  ): Promise<DatabaseCell> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseCells')
      .values(payload)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Returns all page cells within the database.
   */
  async findByDatabaseAndPage(
    databaseId: string,
    pageId: string,
  ): Promise<DatabaseCell[]> {
    return this.db
      .selectFrom('databaseCells')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  /**
   * Updates the contents of a cell.
   */
  async updateCell(
    id: string,
    payload: UpdatableDatabaseCell,
    trx?: KyselyTransaction,
  ): Promise<DatabaseCell> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseCells')
      .set({ ...payload, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Creates or updates a cell using a unique key (databaseId, pageId, propertyId).
   */
  async upsertCell(
    payload: InsertableDatabaseCell,
    trx?: KyselyTransaction,
  ): Promise<DatabaseCell> {
    const serializedValue = this.toJsonbValue(payload.value);

    return dbOrTx(this.db, trx)
      .insertInto('databaseCells')
      .values({
        ...payload,
        value: serializedValue as never,
      })
      .onConflict((oc) =>
        oc
          .columns(['databaseId', 'pageId', 'propertyId'])
          .doUpdateSet({
            value: serializedValue as never,
            attachmentId: payload.attachmentId ?? null,
            updatedById: payload.updatedById ?? null,
            updatedAt: new Date(),
            deletedAt: null,
          }),
      )
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Gently deletes all database cells when archiving it.
   */
  async softDeleteByDatabaseId(
    databaseId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseCells')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  /**
   * Restores database cells after converting back to table-view.
   */
  async restoreByDatabaseId(
    databaseId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseCells')
      .set({ deletedAt: null, updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is not', null)
      .execute();
  }

}
