import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sso_login_states')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('state_hash', 'varchar', (col) => col.notNull().unique())
    .addColumn('auth_provider_id', 'uuid', (col) =>
      col.references('auth_providers.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('code_verifier', 'text')
    .addColumn('nonce', 'varchar')
    .addColumn('request_id', 'varchar')
    .addColumn('request_value', 'text')
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('sso_login_states_provider_request_id_idx')
    .on('sso_login_states')
    .columns(['auth_provider_id', 'request_id'])
    .execute();

  await db.schema
    .createIndex('sso_login_states_expires_at_idx')
    .on('sso_login_states')
    .column('expires_at')
    .execute();

  await db.schema
    .createTable('auth_provider_group_mappings')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('auth_provider_id', 'uuid', (col) =>
      col.references('auth_providers.id').onDelete('cascade').notNull(),
    )
    .addColumn('group_id', 'uuid', (col) =>
      col.references('groups.id').onDelete('cascade').notNull(),
    )
    .addColumn('external_group_id', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint(
      'auth_provider_group_mappings_provider_external_unique',
      ['auth_provider_id', 'external_group_id'],
    )
    .execute();

  await db.schema
    .createTable('auth_provider_group_memberships')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('auth_provider_id', 'uuid', (col) =>
      col.references('auth_providers.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('group_id', 'uuid', (col) =>
      col.references('groups.id').onDelete('cascade').notNull(),
    )
    .addColumn('owns_group_membership', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint(
      'auth_provider_group_memberships_provider_user_group_unique',
      ['auth_provider_id', 'user_id', 'group_id'],
    )
    .execute();

  await db.schema
    .createIndex('auth_provider_group_memberships_user_group_idx')
    .on('auth_provider_group_memberships')
    .columns(['user_id', 'group_id'])
    .execute();

  await sql`
    WITH duplicate_external_identities AS (
      SELECT auth_provider_id, provider_user_id
      FROM auth_accounts
      WHERE deleted_at IS NULL
      GROUP BY auth_provider_id, provider_user_id
      HAVING count(*) > 1
    )
    UPDATE auth_accounts AS account
    SET deleted_at = now(),
        updated_at = now()
    FROM duplicate_external_identities AS duplicate
    WHERE account.auth_provider_id = duplicate.auth_provider_id
      AND account.provider_user_id = duplicate.provider_user_id
      AND account.deleted_at IS NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX auth_accounts_provider_external_user_unique
    ON auth_accounts (auth_provider_id, provider_user_id)
    WHERE deleted_at IS NULL
  `.execute(db);

  await sql`
    UPDATE auth_providers
    SET is_enabled = false,
        updated_at = now()
    WHERE type NOT IN ('saml', 'oidc', 'ldap')
      AND is_enabled = true
  `.execute(db);

  // Endpoint allowlisting is an application environment policy and cannot be
  // validated inside a database migration. Reset enforcement to prevent an
  // upgrade lockout; an administrator can re-enable it after endpoint checks.
  await sql`
    UPDATE workspaces
    SET enforce_sso = false,
        updated_at = now()
    WHERE enforce_sso = true
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('auth_accounts_provider_external_user_unique')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('auth_provider_group_memberships')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('auth_provider_group_mappings')
    .ifExists()
    .execute();
  await db.schema.dropTable('sso_login_states').ifExists().execute();
}
