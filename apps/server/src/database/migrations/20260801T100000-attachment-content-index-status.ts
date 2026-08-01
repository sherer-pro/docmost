import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE attachments
      ADD COLUMN IF NOT EXISTS content_index_status varchar,
      ADD COLUMN IF NOT EXISTS content_index_error varchar,
      ADD COLUMN IF NOT EXISTS content_index_started_at timestamptz,
      ADD COLUMN IF NOT EXISTS content_indexed_at timestamptz,
      ADD COLUMN IF NOT EXISTS content_index_version integer
  `.execute(db);

  // Before this migration the absence of extracted text was the only marker of
  // unprocessed content, which made permanently unreadable files retry forever.
  await sql`
    UPDATE attachments
    SET content_index_status = CASE
          WHEN text_content IS NOT NULL THEN 'ready'
          ELSE 'pending'
        END,
        content_index_version = CASE
          WHEN text_content IS NOT NULL THEN 1
          ELSE NULL
        END,
        content_indexed_at = CASE
          WHEN text_content IS NOT NULL THEN updated_at
          ELSE NULL
        END
    WHERE deleted_at IS NULL
      AND lower(coalesce(file_ext, '')) IN ('.pdf', '.docx')
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS attachments_content_index_status_idx
    ON attachments (workspace_id, id)
    WHERE content_index_status IN ('pending', 'processing', 'failed')
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS attachments_content_index_status_idx
  `.execute(db);
  await sql`
    ALTER TABLE attachments
      DROP COLUMN IF EXISTS content_index_status,
      DROP COLUMN IF EXISTS content_index_error,
      DROP COLUMN IF EXISTS content_index_started_at,
      DROP COLUMN IF EXISTS content_indexed_at,
      DROP COLUMN IF EXISTS content_index_version
  `.execute(db);
}
