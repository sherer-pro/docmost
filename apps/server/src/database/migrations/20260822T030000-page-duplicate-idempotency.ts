import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    alter table page_template_operations
      drop constraint if exists page_template_operations_kind_check,
      add constraint page_template_operations_kind_check check (
        operation_kind in (
          'snapshot',
          'page_duplicate',
          'embed_insert',
          'embed_detach',
          'template_sync',
          'template_detach',
          'legacy_embed_migration'
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    delete from page_template_operations
    where operation_kind = 'page_duplicate'
  `.execute(db);

  await sql`
    alter table page_template_operations
      drop constraint if exists page_template_operations_kind_check,
      add constraint page_template_operations_kind_check check (
        operation_kind in (
          'snapshot',
          'embed_insert',
          'embed_detach',
          'template_sync',
          'template_detach',
          'legacy_embed_migration'
        )
      )
  `.execute(db);
}
