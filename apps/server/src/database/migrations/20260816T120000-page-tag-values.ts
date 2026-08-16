import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION extract_page_tag_values(page_content jsonb)
    RETURNS text[]
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $$
      WITH RECURSIVE nodes(value) AS (
        SELECT CASE
          WHEN jsonb_typeof(page_content) IN ('object', 'array') THEN page_content
          ELSE '{}'::jsonb
        END
        UNION ALL
        SELECT child.value
        FROM nodes AS parent
        CROSS JOIN LATERAL (
          SELECT item.value
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(parent.value) = 'array' THEN parent.value
              ELSE '[]'::jsonb
            END
          ) AS item(value)
          UNION ALL
          SELECT entry.value
          FROM jsonb_each(
            CASE
              WHEN jsonb_typeof(parent.value) = 'object' THEN parent.value
              ELSE '{}'::jsonb
            END
          ) AS entry(key, value)
        ) AS child
      ), normalized_tags AS (
        SELECT lower(btrim(value #>> '{attrs,value}')) AS value
        FROM nodes
        WHERE value ->> 'type' = 'tag'
      )
      SELECT coalesce(array_agg(DISTINCT value ORDER BY value), ARRAY[]::text[])
      FROM normalized_tags
      WHERE value ~ '^[a-z][a-z0-9_-]{0,31}$'
    $$
  `.execute(db);

  await db.schema
    .alterTable('pages')
    .addColumn('tag_values', sql`text[]`, (column) =>
      column.notNull().defaultTo(sql`ARRAY[]::text[]`),
    )
    .execute();

  await sql`
    CREATE OR REPLACE FUNCTION pages_tag_values_trigger()
    RETURNS trigger AS $$
    BEGIN
      NEW.tag_values := extract_page_tag_values(NEW.content);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE TRIGGER pages_tag_values_update
    BEFORE INSERT OR UPDATE OF content ON pages
    FOR EACH ROW
    EXECUTE FUNCTION pages_tag_values_trigger()
  `.execute(db);

  await sql`
    UPDATE pages
    SET tag_values = extract_page_tag_values(content)
  `.execute(db);

  await sql`
    CREATE INDEX pages_tag_values_search_idx
    ON pages USING gin (tag_values)
    WHERE deleted_at IS NULL AND template_kind IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS pages_tag_values_search_idx`.execute(db);
  await sql`DROP TRIGGER IF EXISTS pages_tag_values_update ON pages`.execute(
    db,
  );
  await sql`DROP FUNCTION IF EXISTS pages_tag_values_trigger()`.execute(db);
  await db.schema.alterTable('pages').dropColumn('tag_values').execute();
  await sql`DROP FUNCTION IF EXISTS extract_page_tag_values(jsonb)`.execute(db);
}
