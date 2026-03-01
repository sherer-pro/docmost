import { Kysely, sql } from 'kysely';

/**
 * Добавляет каноническую привязку database-узла к странице дерева.
 *
 * page_id указывает на «узел-контейнер» базы в таблице pages,
 * что позволяет использовать единый механизм parent/position для sidebar.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('databases')
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('databases_page_id_idx')
    .on('databases')
    .column('page_id')
    .execute();

  await db.schema
    .createIndex('databases_page_id_unique_idx')
    .on('databases')
    .column('page_id')
    .where('page_id', 'is not', null)
    .unique()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('databases_page_id_unique_idx').execute();
  await db.schema.dropIndex('databases_page_id_idx').execute();
  await db.schema.alterTable('databases').dropColumn('page_id').execute();
}
