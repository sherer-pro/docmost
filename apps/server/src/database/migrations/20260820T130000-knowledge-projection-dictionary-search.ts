import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_source_type_check')
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .addCheckConstraint(
      'ai_message_sources_source_type_check',
      sql`source_type in ('page', 'database', 'database_row', 'attachment', 'dictionary_term', 'chat_file')`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // The previous constraint cannot represent dictionary citations.
  await sql`
    DELETE FROM ai_message_sources
    WHERE source_type = 'dictionary_term'
  `.execute(db);
  await db.schema
    .alterTable('ai_message_sources')
    .dropConstraint('ai_message_sources_source_type_check')
    .execute();
  await db.schema
    .alterTable('ai_message_sources')
    .addCheckConstraint(
      'ai_message_sources_source_type_check',
      sql`source_type in ('page', 'database', 'database_row', 'attachment', 'chat_file')`,
    )
    .execute();
}
