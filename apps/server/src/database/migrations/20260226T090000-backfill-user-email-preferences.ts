import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE users
    SET settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      '{preferences,emailEnabled}',
      to_jsonb(COALESCE((settings #>> '{preferences,emailEnabled}')::boolean, true)),
      true
    )
    WHERE settings IS NULL
      OR settings->'preferences' IS NULL
      OR settings->'preferences'->'emailEnabled' IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`SELECT 1`.execute(db);
}
