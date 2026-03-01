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
   * Создаёт новую запись базы данных в пространстве.
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
   * Возвращает базу данных по идентификатору с учётом workspace.
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
   * Возвращает активную базу данных по pageId в пределах workspace.
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
   * Возвращает базу данных по pageId без фильтра по deletedAt.
   *
   * Используется для обратимой конвертации page↔database,
   * когда нужно восстановить ранее деактивированную базу.
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
   * Возвращает список баз данных в указанном пространстве.
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
   * Обновляет поля базы данных.
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
   * Выполняет мягкое удаление базы данных.
   *
   * Мы не удаляем запись физически, чтобы не терять аудит и не ломать связи.
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
   * Восстанавливает ранее мягко удалённую базу данных.
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
