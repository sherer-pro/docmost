import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE spaces AS space
    SET settings = COALESCE(space.settings, '{}'::jsonb)
      || jsonb_build_object(
        'tags',
        jsonb_build_object(
          'disabled',
          CASE
            WHEN jsonb_typeof(workspace.settings #> '{tags,disabled}') = 'array'
              THEN workspace.settings #> '{tags,disabled}'
            ELSE '[]'::jsonb
          END
        )
      )
    FROM workspaces AS workspace
    WHERE workspace.id = space.workspace_id
  `.execute(db);

  await sql`
    UPDATE workspaces
    SET settings = COALESCE(settings, '{}'::jsonb) - 'tags'
    WHERE COALESCE(settings, '{}'::jsonb) ? 'tags'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DO $$
    DECLARE
      divergent_workspace_id uuid;
    BEGIN
      SELECT space.workspace_id
      INTO divergent_workspace_id
      FROM spaces AS space
      GROUP BY space.workspace_id
      HAVING COUNT(
        DISTINCT COALESCE(
          space.settings -> 'tags',
          '{"disabled":[]}'::jsonb
        )
      ) > 1
      LIMIT 1;

      IF divergent_workspace_id IS NOT NULL THEN
        RAISE EXCEPTION
          'Cannot move tag settings back to workspace % because space settings differ',
          divergent_workspace_id;
      END IF;
    END
    $$
  `.execute(db);

  await sql`
    UPDATE workspaces AS workspace
    SET settings = COALESCE(workspace.settings, '{}'::jsonb)
      || jsonb_build_object(
        'tags',
        COALESCE(
          (
            SELECT space.settings -> 'tags'
            FROM spaces AS space
            WHERE space.workspace_id = workspace.id
            ORDER BY space.created_at, space.id
            LIMIT 1
          ),
          '{"disabled":[]}'::jsonb
        )
      )
  `.execute(db);

  await sql`
    UPDATE spaces
    SET settings = COALESCE(settings, '{}'::jsonb) - 'tags'
    WHERE COALESCE(settings, '{}'::jsonb) ? 'tags'
  `.execute(db);
}
