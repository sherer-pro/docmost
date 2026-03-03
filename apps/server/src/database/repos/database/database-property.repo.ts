import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  DatabaseProperty,
  InsertableDatabaseProperty,
  UpdatableDatabaseProperty,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DatabasePropertyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * Adds a new property (column) to the database.
   */
  async insertProperty(
    payload: InsertableDatabaseProperty,
    trx?: KyselyTransaction,
  ): Promise<DatabaseProperty> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseProperties')
      .values(payload)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Returns active database properties, sorted by position.
   */
  async findByDatabaseId(databaseId: string): Promise<DatabaseProperty[]> {
    return this.db
      .selectFrom('databaseProperties')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .execute();
  }

  /**
   * Returns one property by identifier.
   */
  async findById(propertyId: string): Promise<DatabaseProperty> {
    return this.db
      .selectFrom('databaseProperties')
      .selectAll()
      .where('id', '=', propertyId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Updates a database property.
   */
  async updateProperty(
    propertyId: string,
    payload: UpdatableDatabaseProperty,
    trx?: KyselyTransaction,
  ): Promise<DatabaseProperty> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseProperties')
      .set({ ...payload, updatedAt: new Date() })
      .where('id', '=', propertyId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Gently removes the property.
   */
  async softDeleteProperty(
    propertyId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseProperty> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseProperties')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', propertyId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }
  /**
   * Restores database properties previously hidden when converted to a page.
   */
  async restoreByDatabaseId(
    databaseId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseProperties')
      .set({ deletedAt: null, updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is not', null)
      .execute();
  }

}
