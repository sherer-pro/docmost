import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
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
    USING GIN (LOWER(f_unaccent(normalized_alias)) gin_trgm_ops)
  `.execute(db);

  await db.schema
    .alterTable('pages')
    .addColumn('database_search_text', 'text', (column) =>
      column.notNull().defaultTo(''),
    )
    .addColumn('database_search_tsv', sql`tsvector`)
    .execute();

  await sql`
    CREATE OR REPLACE FUNCTION pages_database_search_tsvector_trigger()
    RETURNS trigger AS $$
    BEGIN
      NEW.database_search_tsv := setweight(
        to_tsvector(
          'english',
          f_unaccent(
            translate(
              substring(coalesce(NEW.database_search_text, '') FROM 1 FOR 1000000),
              '«»',
              '  '
            )
          )
        ),
        'C'
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER pages_database_search_tsvector_update
    BEFORE INSERT OR UPDATE OF database_search_text ON pages
    FOR EACH ROW EXECUTE FUNCTION pages_database_search_tsvector_trigger()
  `.execute(db);

  await sql`
    UPDATE pages
    SET database_search_tsv = setweight(
      to_tsvector(
        'english',
        f_unaccent(
          translate(
            substring(coalesce(database_search_text, '') FROM 1 FOR 1000000),
            '«»',
            '  '
          )
        )
      ),
      'C'
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_pages_database_search_tsv
    ON pages USING GIN (database_search_tsv)
    WHERE deleted_at IS NULL AND database_search_text <> ''
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_pages_database_search_tsv').execute();
  await sql`DROP TRIGGER IF EXISTS pages_database_search_tsvector_update ON pages`.execute(
    db,
  );
  await sql`DROP FUNCTION IF EXISTS pages_database_search_tsvector_trigger()`.execute(
    db,
  );
  await db.schema
    .alterTable('pages')
    .dropColumn('database_search_tsv')
    .dropColumn('database_search_text')
    .execute();
  await db.schema
    .dropIndex('idx_dictionary_term_aliases_normalized_trgm')
    .execute();
  await db.schema.dropIndex('idx_dictionary_terms_definition_trgm').execute();
  await db.schema.dropIndex('idx_dictionary_terms_term_trgm').execute();
}
