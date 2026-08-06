import { Kysely, sql } from 'kysely';

/**
 * Per-space configuration for the built-in Open WebUI writer.
 *
 * The migration creates no bindings. The deployment and every space therefore
 * remain disabled until an administrator explicitly configures and enables it.
 * Rolling this migration back deletes encrypted writer credentials.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(db);

  await db.schema
    .createTable('rag_sync_target_claims')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    // Claims deliberately do not have owner FKs: an orphaned claim must keep
    // reserving its target even after its former space or workspace is gone.
    .addColumn('workspace_id', 'uuid', (col) => col.notNull())
    .addColumn('space_id', 'uuid', (col) => col.notNull())
    .addColumn('binding_id', 'uuid', (col) => col.notNull())
    .addColumn('target_fingerprint', 'varchar', (col) => col.notNull())
    .addColumn('state', 'varchar', (col) => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('rag_sync_target_claims_fingerprint_unique', [
      'target_fingerprint',
    ])
    .addCheckConstraint(
      'rag_sync_target_claims_fingerprint_check',
      sql`length("target_fingerprint") = 64 and "target_fingerprint" ~ '^[0-9a-f]+$'`,
    )
    .addCheckConstraint(
      'rag_sync_target_claims_state_check',
      sql`"state" in ('active', 'orphaned')`,
    )
    .execute();

  await db.schema
    .createIndex('idx_rag_sync_target_claims_owner')
    .on('rag_sync_target_claims')
    .columns(['workspace_id', 'space_id', 'binding_id', 'state'])
    .execute();

  await db.schema
    .createTable('rag_sync_bindings')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('state', 'varchar', (col) => col.notNull().defaultTo('disabled'))
    .addColumn('adapter', 'varchar', (col) =>
      col.notNull().defaultTo('open-webui-knowledge-v1'),
    )
    .addColumn('base_url', 'text')
    .addColumn('knowledge_id', 'varchar')
    .addColumn('writer_api_key_encrypted', 'text')
    .addColumn('config_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('target_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('target_claim_id', 'uuid', (col) =>
      col.references('rag_sync_target_claims.id').onDelete('restrict'),
    )
    .addColumn('cleanup_required', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addUniqueConstraint('rag_sync_bindings_space_unique', ['space_id'])
    .addUniqueConstraint('rag_sync_bindings_target_claim_unique', [
      'target_claim_id',
    ])
    .addCheckConstraint(
      'rag_sync_bindings_state_check',
      sql`"state" in ('disabled', 'enabled', 'draining')`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_adapter_check',
      sql`"adapter" = 'open-webui-knowledge-v1'`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_config_version_check',
      sql`"config_version" >= 1`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_target_version_check',
      sql`"target_version" >= 1`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_base_url_check',
      sql`"base_url" is null or (length("base_url") <= 2048 and "base_url" ~* '^https?://')`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_knowledge_id_check',
      sql`"knowledge_id" is null or (length("knowledge_id") between 1 and 200 and "knowledge_id" ~ '^[A-Za-z0-9_-]+$')`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_writer_key_encrypted_check',
      sql`"writer_api_key_encrypted" is null or "writer_api_key_encrypted" like 'enc:v1:%'`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_enabled_config_check',
      sql`"state" = 'disabled' or ("base_url" is not null and "knowledge_id" is not null and "writer_api_key_encrypted" is not null and "target_claim_id" is not null)`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_state_cleanup_check',
      sql`("state" <> 'enabled' or "cleanup_required" = false) and ("state" <> 'draining' or "cleanup_required" = true)`,
    )
    .addCheckConstraint(
      'rag_sync_bindings_cleanup_config_check',
      sql`"cleanup_required" = false or ("base_url" is not null and "knowledge_id" is not null and "writer_api_key_encrypted" is not null and "target_claim_id" is not null)`,
    )
    .execute();

  await db.schema
    .createIndex('idx_rag_sync_bindings_runtime')
    .on('rag_sync_bindings')
    .columns(['state', 'updated_at'])
    .execute();
  await db.schema
    .createIndex('idx_rag_sync_bindings_workspace')
    .on('rag_sync_bindings')
    .columns(['workspace_id', 'space_id'])
    .execute();

  await sql`
    create function rag_sync_validate_binding_owner()
    returns trigger
    language plpgsql
    as $$
    declare
      owner_workspace_id uuid;
      claim_fingerprint text;
    begin
      select workspace_id into owner_workspace_id
      from spaces
      where id = new.space_id;

      if owner_workspace_id is null or owner_workspace_id <> new.workspace_id then
        raise exception 'RAG sync binding space must belong to its workspace'
          using errcode = '23514';
      end if;

      if new.target_claim_id is not null then
        select target_fingerprint into claim_fingerprint
        from rag_sync_target_claims
        where id = new.target_claim_id
          and state = 'active'
          and workspace_id = new.workspace_id
          and space_id = new.space_id
          and binding_id = new.id;

        if claim_fingerprint is null then
          raise exception 'RAG sync binding target claim owner is invalid'
            using errcode = '23514';
        end if;

        if new.base_url is null
           or new.knowledge_id is null
           or claim_fingerprint <> encode(
             digest(
               lower(regexp_replace(new.base_url, '/+$', '')) || chr(10) || new.knowledge_id,
               'sha256'
             ),
             'hex'
           ) then
          raise exception 'RAG sync binding target claim fingerprint is invalid'
            using errcode = '23514';
        end if;
      end if;

      if new.cleanup_required and new.target_claim_id is null then
        raise exception 'RAG sync cleanup requires a target claim'
          using errcode = '23514';
      end if;

      return new;
    end;
    $$
  `.execute(db);
  await sql`
    create trigger rag_sync_validate_binding_owner
    before insert or update of workspace_id, space_id, target_claim_id, base_url, knowledge_id, cleanup_required
    on rag_sync_bindings
    for each row execute function rag_sync_validate_binding_owner()
  `.execute(db);

  await sql`
    create function rag_sync_validate_active_claim_owner()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.state = 'active' and not exists (
        select 1
        from rag_sync_bindings
        where id = new.binding_id
          and workspace_id = new.workspace_id
          and space_id = new.space_id
      ) then
        raise exception 'RAG sync active target claim owner is invalid'
          using errcode = '23514';
      end if;

      if new.state = 'active' and exists (
        select 1
        from rag_sync_bindings
        where id = new.binding_id
          and target_claim_id = new.id
          and (
            base_url is null
            or knowledge_id is null
            or new.target_fingerprint <> encode(
              digest(
                lower(regexp_replace(base_url, '/+$', '')) || chr(10) || knowledge_id,
                'sha256'
              ),
              'hex'
            )
          )
      ) then
        raise exception 'RAG sync active target claim fingerprint is invalid'
          using errcode = '23514';
      end if;

      return new;
    end;
    $$
  `.execute(db);
  await sql`
    create trigger rag_sync_validate_active_claim_owner
    before insert or update of workspace_id, space_id, binding_id, target_fingerprint, state
    on rag_sync_target_claims
    for each row execute function rag_sync_validate_active_claim_owner()
  `.execute(db);

  await sql`
    create function rag_sync_prevent_unsafe_owner_delete()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_table_name = 'spaces' then
        perform 1
        from rag_sync_bindings
        where space_id = old.id
        for update;
      elsif tg_table_name = 'workspaces' then
        perform 1
        from rag_sync_bindings
        where workspace_id = old.id
        for update;
      end if;

      if exists (
        select 1
        from rag_sync_bindings
        where (
          (tg_table_name = 'spaces' and space_id = old.id)
          or (tg_table_name = 'workspaces' and workspace_id = old.id)
        )
          and (state in ('enabled', 'draining') or cleanup_required = true)
      ) then
        raise exception 'RAG sync cleanup must complete before deleting %', tg_table_name
          using errcode = '23514';
      end if;
      return old;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger rag_sync_prevent_space_delete
    before delete on spaces
    for each row execute function rag_sync_prevent_unsafe_owner_delete()
  `.execute(db);
  await sql`
    create trigger rag_sync_prevent_workspace_delete
    before delete on workspaces
    for each row execute function rag_sync_prevent_unsafe_owner_delete()
  `.execute(db);

  await sql`
    create function rag_sync_prevent_unsafe_binding_delete()
    returns trigger
    language plpgsql
    as $$
    begin
      if old.state in ('enabled', 'draining') or old.cleanup_required = true then
        raise exception 'RAG sync cleanup must complete before deleting binding'
          using errcode = '23514';
      end if;
      return old;
    end;
    $$
  `.execute(db);
  await sql`
    create trigger rag_sync_prevent_unsafe_binding_delete
    before delete on rag_sync_bindings
    for each row execute function rag_sync_prevent_unsafe_binding_delete()
  `.execute(db);

  await sql`
    create function rag_sync_release_clean_binding_claim()
    returns trigger
    language plpgsql
    as $$
    begin
      if old.state = 'disabled'
         and old.cleanup_required = false
         and old.target_claim_id is not null then
        delete from rag_sync_target_claims
        where id = old.target_claim_id and state = 'active';
      end if;
      return old;
    end;
    $$
  `.execute(db);
  await sql`
    create trigger rag_sync_release_clean_binding_claim
    after delete on rag_sync_bindings
    for each row execute function rag_sync_release_clean_binding_claim()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop trigger if exists rag_sync_validate_active_claim_owner on rag_sync_target_claims`.execute(
    db,
  );
  await sql`drop function if exists rag_sync_validate_active_claim_owner()`.execute(
    db,
  );
  await sql`drop trigger if exists rag_sync_validate_binding_owner on rag_sync_bindings`.execute(
    db,
  );
  await sql`drop function if exists rag_sync_validate_binding_owner()`.execute(
    db,
  );
  await sql`drop trigger if exists rag_sync_prevent_unsafe_binding_delete on rag_sync_bindings`.execute(
    db,
  );
  await sql`drop function if exists rag_sync_prevent_unsafe_binding_delete()`.execute(
    db,
  );
  await sql`drop trigger if exists rag_sync_release_clean_binding_claim on rag_sync_bindings`.execute(
    db,
  );
  await sql`drop function if exists rag_sync_release_clean_binding_claim()`.execute(
    db,
  );
  await sql`drop trigger if exists rag_sync_prevent_space_delete on spaces`.execute(
    db,
  );
  await sql`drop trigger if exists rag_sync_prevent_workspace_delete on workspaces`.execute(
    db,
  );
  await sql`drop function if exists rag_sync_prevent_unsafe_owner_delete()`.execute(
    db,
  );
  await db.schema.dropTable('rag_sync_bindings').execute();
  await db.schema.dropTable('rag_sync_target_claims').execute();
}
