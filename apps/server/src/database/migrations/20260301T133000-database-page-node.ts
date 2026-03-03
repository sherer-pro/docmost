import { Kysely, sql } from 'kysely';

/**
 * Adds a canonical database node binding to the tree page.
 *
 * page_id points to the “container node” of the database in the pages table,
 * which allows you to use a single parent/position mechanism for the sidebar.
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
