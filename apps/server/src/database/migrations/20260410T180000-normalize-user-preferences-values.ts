import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    WITH normalized_preferences AS (
      SELECT
        id,
        CASE
          WHEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,pushEnabled}', ''))) = 'true' THEN true
          WHEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,pushEnabled}', ''))) = 'false' THEN false
          ELSE false
        END AS push_enabled,
        CASE
          WHEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,emailEnabled}', ''))) = 'true' THEN true
          WHEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,emailEnabled}', ''))) = 'false' THEN false
          ELSE true
        END AS email_enabled,
        CASE
          WHEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,pushFrequency}', ''))) IN ('immediate', '1h', '3h', '6h', '24h')
            THEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,pushFrequency}', '')))
          ELSE 'immediate'
        END AS push_frequency,
        CASE
          WHEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,emailFrequency}', ''))) IN ('immediate', '1h', '3h', '6h', '24h')
            THEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,emailFrequency}', '')))
          ELSE 'immediate'
        END AS email_frequency,
        CASE
          WHEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,pageEditMode}', ''))) IN ('read', 'edit')
            THEN LOWER(TRIM(BOTH '"' FROM COALESCE(settings #>> '{preferences,pageEditMode}', '')))
          ELSE 'edit'
        END AS page_edit_mode
      FROM users
    )
    UPDATE users
    SET settings = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(users.settings, '{}'::jsonb),
              '{preferences,pushEnabled}',
              to_jsonb(normalized_preferences.push_enabled),
              true
            ),
            '{preferences,emailEnabled}',
            to_jsonb(normalized_preferences.email_enabled),
            true
          ),
          '{preferences,pushFrequency}',
          to_jsonb(normalized_preferences.push_frequency),
          true
        ),
        '{preferences,emailFrequency}',
        to_jsonb(normalized_preferences.email_frequency),
        true
      ),
      '{preferences,pageEditMode}',
      to_jsonb(normalized_preferences.page_edit_mode),
      true
    )
    FROM normalized_preferences
    WHERE users.id = normalized_preferences.id
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`SELECT 1`.execute(db);
}
