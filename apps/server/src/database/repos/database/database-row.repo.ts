import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  DatabaseRow,
  InsertableDatabaseRow,
  UpdatableDatabaseRow,
} from '@docmost/db/types/entity.types';
import { sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';

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
  ): Promise<any[]> {
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
      .select('pages.title as pageTitle')
      .select('pages.slugId as pageSlugId')
      .select('pages.position as pagePosition')
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('pages as p')
            .innerJoin('spaces as s', 's.id', 'p.spaceId')
            .select(['p.id', 'p.slugId', 'p.title', 'p.icon', 'p.parentPageId', 'p.position'])
            /**
             * Формируем customFields по той же схеме, что и page API:
             * источник данных — page.settings.
             *
             * Дополнительно применяем правила видимости для полей assignee/stakeholders
             * на основании settings.documentFields конкретного пространства.
             */
            .select(
              sql`jsonb_build_object(
                'status', p.settings -> 'status',
                'assigneeId', CASE
                  WHEN COALESCE((s.settings -> 'documentFields' ->> 'assignee')::boolean, false)
                    THEN p.settings -> 'assigneeId'
                  ELSE 'null'::jsonb
                END,
                'stakeholderIds', CASE
                  WHEN COALESCE((s.settings -> 'documentFields' ->> 'stakeholders')::boolean, false)
                    THEN COALESCE(p.settings -> 'stakeholderIds', '[]'::jsonb)
                  ELSE '[]'::jsonb
                END
              )`.as('customFields'),
            )
            .whereRef('p.id', '=', 'databaseRows.pageId'),
        ).as('page'),
      )
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('databaseCells')
            .select([
              'id',
              'databaseId',
              'workspaceId',
              'pageId',
              'propertyId',
              'value',
              'attachmentId',
              'createdById',
              'updatedById',
              'createdAt',
              'updatedAt',
              'deletedAt',
            ])
            .whereRef('databaseCells.databaseId', '=', 'databaseRows.databaseId')
            .whereRef('databaseCells.pageId', '=', 'databaseRows.pageId')
            .where('databaseCells.deletedAt', 'is', null),
        ).as('cells'),
      )
      .where('databaseId', '=', databaseId)
      .where('databaseRows.workspaceId', '=', workspaceId)
      .where('pages.workspaceId', '=', workspaceId)
      .where('pages.spaceId', '=', spaceId)
      .where('pages.deletedAt', 'is', null)
      .where('databaseRows.archivedAt', 'is', null)
      /**
       * Порядок строк в дереве определяется позицией страницы,
       * а не временем создания databaseRows.
       *
       * COLLATE "C" обеспечивает стабильную лексикографическую сортировку
       * для fractional indexing ключей.
       */
      .orderBy(sql`"pages"."position" collate "C"`, 'desc')
      .execute();
  }


  async findActiveByPageId(
    pageId: string,
    workspaceId: string,
  ): Promise<DatabaseRow> {
    return this.db
      .selectFrom('databaseRows')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is', null)
      .executeTakeFirst();
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

  async archiveByPageIds(
    databaseId: string,
    workspaceId: string,
    pageIds: string[],
    trx?: KyselyTransaction,
  ): Promise<void> {
    if (pageIds.length === 0) {
      return;
    }

    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('pageId', 'in', pageIds)
      .where('archivedAt', 'is', null)
      .execute();
  }

  /**
   * Архивирует все строки базы данных при архивировании самой базы.
   */
  async archiveByDatabaseId(
    databaseId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is', null)
      .execute();
  }

  /**
   * Мягко отвязывает строку от активного состояния базы.
   *
   * Физическая запись не удаляется и pageId сохраняется как снимок связи,
   * что позволяет восстановить строку при обратной конвертации.
   */
  async softDetachRowLink(
    databaseId: string,
    pageId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is', null)
      .execute();
  }

  /**
   * Восстанавливает ранее отвязанную строку базы.
   */
  async restoreRowLink(
    databaseId: string,
    pageId: string,
    workspaceId: string,
    actorId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({
        archivedAt: null,
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where('databaseId', '=', databaseId)
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is not', null)
      .execute();
  }

  /**
   * Восстанавливает ссылки всех строк базы данных.
   */
  async restoreByDatabaseId(
    databaseId: string,
    workspaceId: string,
    actorId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRows')
      .set({
        archivedAt: null,
        updatedAt: new Date(),
        updatedById: actorId,
      })
      .where('databaseId', '=', databaseId)
      .where('workspaceId', '=', workspaceId)
      .where('archivedAt', 'is not', null)
      .execute();
  }

}
