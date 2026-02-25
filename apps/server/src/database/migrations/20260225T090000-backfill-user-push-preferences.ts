import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE users
    SET settings = jsonb_set(
      jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{preferences,pushEnabled}',
        to_jsonb(COALESCE((settings #>> '{preferences,pushEnabled}')::boolean, false)),
        true
      ),
      '{preferences,pushFrequency}',
      to_jsonb(COALESCE(settings #>> '{preferences,pushFrequency}', 'immediate')),
      true
    )
    WHERE settings IS NULL
      OR settings->'preferences' IS NULL
      OR settings->'preferences'->'pushEnabled' IS NULL
      OR settings->'preferences'->'pushFrequency' IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`SELECT 1`.execute(db);
}
