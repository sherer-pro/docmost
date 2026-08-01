import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION attachments_tsvector_trigger()
    RETURNS trigger AS $$
    BEGIN
      NEW.tsv :=
        setweight(
          to_tsvector('english', f_unaccent(coalesce(NEW.file_name, ''))),
          'A'
        ) ||
        setweight(
          to_tsvector(
            'english',
            f_unaccent(substring(coalesce(NEW.text_content, '') FROM 1 FOR 1000000))
          ),
          'B'
        );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    DROP TRIGGER IF EXISTS attachments_tsvector_update ON attachments
  `.execute(db);
  await sql`
    CREATE TRIGGER attachments_tsvector_update
    BEFORE INSERT OR UPDATE OF file_name, text_content
    ON attachments
    FOR EACH ROW
    EXECUTE FUNCTION attachments_tsvector_trigger()
  `.execute(db);

  await sql`
    UPDATE attachments
    SET text_content = text_content
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DROP TRIGGER IF EXISTS attachments_tsvector_update ON attachments
  `.execute(db);
  await sql`
    DROP FUNCTION IF EXISTS attachments_tsvector_trigger()
  `.execute(db);
}
