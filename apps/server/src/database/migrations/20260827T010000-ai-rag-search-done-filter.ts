import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_space_content_policies')
    .addColumn('rag_search_done_only', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .execute();

  await sql`
    create index idx_pages_active_space_status
    on pages (workspace_id, space_id, ((settings ->> 'status')))
    where deleted_at is null and template_kind is null
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_pages_active_space_status').execute();
  await db.schema
    .alterTable('ai_space_content_policies')
    .dropColumn('rag_search_done_only')
    .execute();
}
