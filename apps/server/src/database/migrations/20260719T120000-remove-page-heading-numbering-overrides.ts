import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE pages
    SET settings = settings - 'headingNumbering'
    WHERE jsonb_typeof(settings) = 'object'
      AND settings ? 'headingNumbering'
  `.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Removed shared overrides cannot be reconstructed as personal preferences.
}
