import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('user_sessions')
    .addColumn('sso_verified_at', 'timestamptz')
    .addColumn('sso_auth_provider_id', 'uuid', (col) =>
      col.references('auth_providers.id').onDelete('set null'),
    )
    .addColumn('mfa_verified_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('sso_login_states')
    .addColumn('purpose', 'varchar', (col) =>
      col.notNull().defaultTo('login'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade'),
    )
    .addColumn('session_id', 'uuid', (col) =>
      col.references('user_sessions.id').onDelete('cascade'),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('set null'),
    )
    .addColumn('return_to', 'text')
    .execute();

  await db.schema
    .alterTable('sso_login_states')
    .addCheckConstraint(
      'sso_login_states_purpose_check',
      sql`purpose in ('login', 'step_up')`,
    )
    .execute();

  await db.schema
    .alterTable('sso_login_states')
    .addCheckConstraint(
      'sso_login_states_step_up_binding_check',
      sql`
        purpose = 'login'
        or (user_id is not null and session_id is not null)
      `,
    )
    .execute();

  await db.schema
    .createIndex('sso_login_states_session_id_idx')
    .on('sso_login_states')
    .column('session_id')
    .where('session_id', 'is not', null)
    .execute();

  await sql`
    UPDATE spaces
    SET settings = settings #- '{sharing,disabled}',
        updated_at = now()
    WHERE settings #>> '{sharing,disabled}' = 'false'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('sso_login_states_session_id_idx')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('sso_login_states')
    .dropConstraint('sso_login_states_step_up_binding_check')
    .execute();

  await db.schema
    .alterTable('sso_login_states')
    .dropConstraint('sso_login_states_purpose_check')
    .execute();

  await db.schema
    .alterTable('sso_login_states')
    .dropColumn('return_to')
    .dropColumn('space_id')
    .dropColumn('session_id')
    .dropColumn('user_id')
    .dropColumn('purpose')
    .execute();

  await db.schema
    .alterTable('user_sessions')
    .dropColumn('mfa_verified_at')
    .dropColumn('sso_auth_provider_id')
    .dropColumn('sso_verified_at')
    .execute();
}
