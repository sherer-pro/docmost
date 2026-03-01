import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  DatabaseCell,
  InsertableDatabaseCell,
  UpdatableDatabaseCell,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DatabaseCellRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * Создаёт значение ячейки для конкретной строки и свойства.
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
   * Возвращает все ячейки страницы в рамках базы данных.
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
   * Обновляет содержимое ячейки.
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
   * Создаёт или обновляет ячейку по уникальному ключу (databaseId, pageId, propertyId).
   */
  async upsertCell(
    payload: InsertableDatabaseCell,
    trx?: KyselyTransaction,
  ): Promise<DatabaseCell> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseCells')
      .values(payload)
      .onConflict((oc) =>
        oc
          .columns(['databaseId', 'pageId', 'propertyId'])
          .doUpdateSet({
            value: payload.value ?? null,
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
   * Мягко удаляет все ячейки базы данных при её архивировании.
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
   * Восстанавливает ячейки базы данных после обратной конвертации в table-view.
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
