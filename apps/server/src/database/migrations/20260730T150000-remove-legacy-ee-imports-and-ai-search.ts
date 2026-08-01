import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE file_tasks
    SET status = 'failed',
        error_message = 'Confluence import is no longer supported',
        updated_at = now()
    WHERE source = 'confluence'
      AND status IN ('pending', 'processing')
  `.execute(db);

  await sql`
    UPDATE file_tasks
    SET status = 'failed',
        error_message = 'Microsoft Word import is no longer supported',
        updated_at = now()
    WHERE source = 'generic'
      AND type = 'import'
      AND status IN ('pending', 'processing')
      AND (
        lower(coalesce(file_ext, '')) = '.docx'
        OR lower(file_name) LIKE '%.docx'
      )
  `.execute(db);

  await sql`
    UPDATE workspaces
    SET settings = CASE
      WHEN (settings #- '{ai,search}') -> 'ai' = '{}'::jsonb
        THEN (settings #- '{ai,search}') - 'ai'
      ELSE settings #- '{ai,search}'
    END
    WHERE settings #> '{ai,search}' IS NOT NULL
  `.execute(db);

  await sql`DROP TABLE IF EXISTS page_embeddings CASCADE`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // The removed legacy search data and in-flight imports are not restorable.
}
