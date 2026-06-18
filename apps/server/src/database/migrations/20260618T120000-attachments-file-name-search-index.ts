import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

  await sql`
    DO $$
    DECLARE
      unaccent_schema text;
      unaccent_dictionary text;
    BEGIN
      SELECT n.nspname
      INTO unaccent_schema
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'unaccent'
        AND pg_get_function_identity_arguments(p.oid) = 'regdictionary, text'
      LIMIT 1;

      IF unaccent_schema IS NULL THEN
        RAISE EXCEPTION 'unaccent(regdictionary, text) function not found';
      END IF;

      SELECT quote_ident(n.nspname) || '.' || quote_ident(d.dictname)
      INTO unaccent_dictionary
      FROM pg_ts_dict d
      JOIN pg_namespace n ON n.oid = d.dictnamespace
      WHERE d.dictname = 'unaccent'
      ORDER BY (n.nspname = unaccent_schema) DESC
      LIMIT 1;

      IF unaccent_dictionary IS NULL THEN
        RAISE EXCEPTION 'unaccent text search dictionary not found';
      END IF;

      EXECUTE format($function$
        CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
        AS $body$
          SELECT %I.unaccent(%L::regdictionary, $1);
        $body$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
      $function$, unaccent_schema, unaccent_dictionary);
    END
    $$;
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS attachments_file_name_trgm_idx
    ON attachments
    USING GIN (LOWER(f_unaccent(file_name)) gin_trgm_ops)
    WHERE deleted_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS attachments_file_name_trgm_idx`.execute(db);
}
