import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE attachments
    SET content_index_status = 'pending',
        content_index_error = NULL,
        content_index_started_at = NULL
    WHERE deleted_at IS NULL
      AND lower(coalesce(file_ext, '')) IN ('.md', '.txt')
      AND (
        content_index_status IS NULL
        OR (
          content_index_status = 'skipped'
          AND content_index_error = 'unsupported_type'
        )
      )
  `.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Preserve extracted text and worker claims; the previous worker skips these formats.
}
