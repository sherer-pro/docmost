import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  DatabaseRow,
  InsertableDatabaseRow,
  UpdatableDatabaseRow,
} from '@docmost/db/types/entity.types';

@Injectable()
export class DatabaseRowRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * Создаёт строку базы данных, привязанную к странице.
   */
  async insertRow(
    payload: InsertableDatabaseRow,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRow> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseRows')
      .values(payload)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Находит строку по идентификатору.
   */
  async findById(rowId: string): Promise<DatabaseRow> {
    return this.db
      .selectFrom('databaseRows')
      .selectAll()
      .where('id', '=', rowId)
      .executeTakeFirst();
  }

  /**
   * Возвращает все строки конкретной базы данных.
   */
  async findByDatabaseId(
    databaseId: string,
    workspaceId: string,
    spaceId: string,
  ): Promise<DatabaseRow[]> {
    return this.db
      .selectFrom('databaseRows')
      .innerJoin('pages', 'pages.id', 'databaseRows.pageId')
      .select('databaseRows.id')
      .select('databaseRows.databaseId')
      .select('databaseRows.workspaceId')
      .select('databaseRows.pageId')
      .select('databaseRows.createdById')
      .select('databaseRows.updatedById')
      .select('databaseRows.createdAt')
      .select('databaseRows.updatedAt')
      .select('databaseRows.archivedAt')
      .where('databaseId', '=', databaseId)
      .where('databaseRows.workspaceId', '=', workspaceId)
      .where('pages.workspaceId', '=', workspaceId)
      .where('pages.spaceId', '=', spaceId)
      .where('pages.deletedAt', 'is', null)
      .orderBy('databaseRows.createdAt', 'desc')
      .execute();
  }

  /**
   * Находит строку по паре databaseId/pageId.
   */
  async findByDatabaseAndPage(
    databaseId: string,
    pageId: string,
  ): Promise<DatabaseRow> {
    return this.db
      .selectFrom('databaseRows')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .where('pageId', '=', pageId)
      .executeTakeFirst();
  }

  /**
   * Обновляет данные строки.
   */
  async updateRow(
    id: string,
    payload: UpdatableDatabaseRow,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRow> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({ ...payload, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }
}
