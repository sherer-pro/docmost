import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('page_template_operations')
    .addColumn('apply_metadata', 'jsonb')
    .execute();
  await sql`alter table page_template_operations
    drop constraint page_template_operations_kind_check,
    add constraint page_template_operations_kind_check check (
      operation_kind in ('snapshot','page_duplicate','embed_insert','embed_detach',
        'template_sync','template_detach','legacy_embed_migration','template_apply')
    )`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  const used = await db
    .selectFrom('page_template_operations')
    .select('id')
    .where('operation_kind', '=', 'template_apply')
    .limit(1)
    .executeTakeFirst();
  if (used)
    throw new Error(
      'Template application receipts must be retained; disable creation instead of rolling this migration back',
    );
  await sql`alter table page_template_operations
    drop constraint page_template_operations_kind_check,
    add constraint page_template_operations_kind_check check (
      operation_kind in ('snapshot','page_duplicate','embed_insert','embed_detach',
        'template_sync','template_detach','legacy_embed_migration')
    )`.execute(db);
  await db.schema
    .alterTable('page_template_operations')
    .dropColumn('apply_metadata')
    .execute();
}
