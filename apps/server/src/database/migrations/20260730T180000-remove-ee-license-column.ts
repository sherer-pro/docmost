import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE workspaces
    DROP COLUMN IF EXISTS license_key
  `.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Removed license data and schema are intentionally not recreated.
}
