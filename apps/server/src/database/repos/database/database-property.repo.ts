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
   * Добавляет новое свойство (колонку) в базу данных.
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
   * Возвращает активные свойства базы данных, отсортированные по позиции.
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
   * Возвращает одно свойство по идентификатору.
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
   * Обновляет свойство базы данных.
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
   * Мягко удаляет свойство.
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
   * Восстанавливает свойства базы данных, ранее скрытые при конвертации в страницу.
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
