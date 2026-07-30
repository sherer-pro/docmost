import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ai_space_content_policies')
    .addColumn('space_id', 'uuid', (col) =>
      col.primaryKey().references('spaces.id').onDelete('cascade'),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('revision', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('fingerprint', 'varchar', (col) =>
      col.notNull().defaultTo('empty'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'ai_space_content_policies_revision_check',
      sql`"revision" >= 0`,
    )
    .execute();

  await db.schema
    .createTable('ai_space_content_exclusions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col
        .references('ai_space_content_policies.space_id')
        .onDelete('cascade')
        .notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('include_descendants', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_space_content_exclusions_page_unique', [
      'space_id',
      'page_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_ai_space_content_exclusions_workspace')
    .on('ai_space_content_exclusions')
    .columns(['workspace_id', 'space_id'])
    .execute();

  await db.schema
    .alterTable('ai_conversations')
    .addColumn('current_document_descendant_mode', 'varchar', (col) =>
      col.notNull().defaultTo('none'),
    )
    .addColumn('current_document_selected_page_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .addColumn('prompt_history_cutoff_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('ai_conversations')
    .addCheckConstraint(
      'ai_conversations_descendant_mode_check',
      sql`"current_document_descendant_mode" in ('none', 'all', 'selected')`,
    )
    .execute();

  await db.schema
    .alterTable('ai_conversation_context_sources')
    .addColumn('descendant_mode', 'varchar', (col) =>
      col.notNull().defaultTo('none'),
    )
    .addColumn('selected_descendant_page_ids', sql`uuid[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::uuid[]`),
    )
    .execute();

  await db.schema
    .alterTable('ai_conversation_context_sources')
    .addCheckConstraint(
      'ai_conversation_context_sources_descendant_mode_check',
      sql`"descendant_mode" in ('none', 'all', 'selected')`,
    )
    .execute();

  await db.schema
    .alterTable('ai_run_context_sources')
    .dropConstraint('ai_run_context_sources_position_check')
    .execute();
  await db.schema
    .alterTable('ai_run_context_sources')
    .addCheckConstraint(
      'ai_run_context_sources_position_check',
      sql`"position" >= 0 and "position" < 50`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_run_context_sources')
    .dropConstraint('ai_run_context_sources_position_check')
    .execute();
  await db.schema
    .alterTable('ai_run_context_sources')
    .addCheckConstraint(
      'ai_run_context_sources_position_check',
      sql`"position" >= 0`,
    )
    .execute();

  await db.schema
    .alterTable('ai_conversation_context_sources')
    .dropConstraint('ai_conversation_context_sources_descendant_mode_check')
    .execute();
  await db.schema
    .alterTable('ai_conversation_context_sources')
    .dropColumn('selected_descendant_page_ids')
    .dropColumn('descendant_mode')
    .execute();

  await db.schema
    .alterTable('ai_conversations')
    .dropConstraint('ai_conversations_descendant_mode_check')
    .execute();
  await db.schema
    .alterTable('ai_conversations')
    .dropColumn('prompt_history_cutoff_at')
    .dropColumn('current_document_selected_page_ids')
    .dropColumn('current_document_descendant_mode')
    .execute();

  await db.schema.dropTable('ai_space_content_exclusions').execute();
  await db.schema.dropTable('ai_space_content_policies').execute();
}
