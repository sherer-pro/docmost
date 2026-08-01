import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE auth_providers
      ADD COLUMN IF NOT EXISTS verified_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_successful_login_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_error_code varchar
  `.execute(db);

  // A provider with linked accounts has demonstrably completed a login, so an
  // upgrade must not force administrators to re-verify a working provider.
  await sql`
    UPDATE auth_providers AS provider
    SET verified_at = linked.first_linked_at,
        last_successful_login_at = linked.first_linked_at
    FROM (
      SELECT auth_provider_id, min(created_at) AS first_linked_at
      FROM auth_accounts
      WHERE deleted_at IS NULL
      GROUP BY auth_provider_id
    ) AS linked
    WHERE provider.id = linked.auth_provider_id
      AND provider.deleted_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE auth_providers
      DROP COLUMN IF EXISTS verified_at,
      DROP COLUMN IF EXISTS last_successful_login_at,
      DROP COLUMN IF EXISTS last_error_code
  `.execute(db);
}
