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
   * Создаёт представление (например, table/board/calendar) для базы данных.
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
   * Возвращает список представлений базы данных.
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
   * Возвращает одно представление по идентификатору.
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
   * Обновляет настройки представления.
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
   * Мягко удаляет представление.
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
   * Мягко удаляет все представления базы данных при архивировании.
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

}
