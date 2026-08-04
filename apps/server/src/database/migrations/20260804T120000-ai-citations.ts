import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_message_sources')
    .addColumn('candidate_key', 'varchar')
    .addColumn('citation_key', 'varchar')
    .addColumn('citation_state', 'varchar', (col) =>
      col.notNull().defaultTo('legacy'),
    )
    .addColumn('section_id', 'varchar')
    .addColumn('section_title', 'text')
    .addColumn('display_position', 'integer')
    .execute();

  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_source_type_check')
    .execute();
  await sql`
    update ai_message_sources
    set source_type = 'page', source_id = coalesce(page_id, source_id)
    where source_type = 'database'
  `.execute(db);
  await db.schema
    .alterTable('ai_message_sources')
    .addCheckConstraint(
      'ai_message_sources_source_type_check',
      sql`source_type in ('page', 'database', 'database_row', 'attachment', 'chat_file')`,
    )
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .addCheckConstraint(
      'ai_message_sources_citation_state_check',
      sql`citation_state in ('candidate', 'cited', 'context', 'legacy')`,
    )
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .addCheckConstraint(
      'ai_message_sources_display_position_check',
      sql`display_position is null or display_position >= 0`,
    )
    .execute();

  await db.schema
    .createIndex('uniq_ai_message_sources_run_candidate')
    .on('ai_message_sources')
    .columns(['run_id', 'candidate_key'])
    .unique()
    .where('candidate_key', 'is not', null)
    .execute();

  await db.schema
    .createIndex('uniq_ai_message_sources_run_citation')
    .on('ai_message_sources')
    .columns(['run_id', 'citation_key'])
    .unique()
    .where('citation_key', 'is not', null)
    .execute();

  await db.schema
    .alterTable('ai_run_context_sources')
    .addColumn('citation_headings', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_run_context_sources')
    .dropColumn('citation_headings')
    .execute();
  await db.schema.dropIndex('uniq_ai_message_sources_run_citation').execute();
  await db.schema.dropIndex('uniq_ai_message_sources_run_candidate').execute();
  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_display_position_check')
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_citation_state_check')
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .dropColumn('display_position')
    .dropColumn('section_title')
    .dropColumn('section_id')
    .dropColumn('citation_state')
    .dropColumn('citation_key')
    .dropColumn('candidate_key')
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_source_type_check')
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .addCheckConstraint(
      'ai_message_sources_source_type_check',
      sql`source_type in ('page', 'database_row', 'attachment', 'chat_file')`,
    )
    .execute();
}
