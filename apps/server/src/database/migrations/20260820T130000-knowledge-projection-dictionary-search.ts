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

  await sql`
    CREATE INDEX idx_dictionary_terms_term_trgm
    ON dictionary_terms
    USING GIN (LOWER(f_unaccent(term)) gin_trgm_ops)
    WHERE deleted_at IS NULL
  `.execute(db);
  await sql`
    CREATE INDEX idx_dictionary_terms_definition_trgm
    ON dictionary_terms
    USING GIN (LOWER(f_unaccent(definition_markdown)) gin_trgm_ops)
    WHERE deleted_at IS NULL
  `.execute(db);
  await sql`
    CREATE INDEX idx_dictionary_term_aliases_normalized_trgm
    ON dictionary_term_aliases
    USING GIN (normalized_alias gin_trgm_ops)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_dictionary_term_aliases_normalized_trgm')
    .execute();
  await db.schema.dropIndex('idx_dictionary_terms_definition_trgm').execute();
  await db.schema.dropIndex('idx_dictionary_terms_term_trgm').execute();

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
