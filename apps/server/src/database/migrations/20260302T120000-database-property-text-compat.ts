import { type Kysely, sql } from 'kysely';

/**
 * Compatibility Migration:
 * We replace the historical type `text` with the supported `multiline_text`.
 * This syncs the old data with the new API/UI contract.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE database_properties
    SET type = 'multiline_text'
    WHERE type = 'text'
  `.execute(db);
}

/**
 * Rollback returns the previous value for compatibility of rollback scripts.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE database_properties
    SET type = 'text'
    WHERE type = 'multiline_text'
  `.execute(db);
}
