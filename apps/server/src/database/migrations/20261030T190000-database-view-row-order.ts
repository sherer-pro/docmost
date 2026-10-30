import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('database_view_row_positions')
    .addColumn('view_id', 'uuid', (c) =>
      c.notNull().references('database_views.id').onDelete('cascade'),
    )
    .addColumn('page_id', 'uuid', (c) =>
      c.notNull().references('pages.id').onDelete('cascade'),
    )
    .addColumn('position', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('database_view_row_positions_pk', [
      'view_id',
      'page_id',
    ])
    .execute();
  await sql`create index database_view_row_positions_order on database_view_row_positions(view_id, position collate "C", page_id)`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('database_view_row_positions').execute();
}
