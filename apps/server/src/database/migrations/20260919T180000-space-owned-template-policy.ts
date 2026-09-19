import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`lock table page_template_space_policies, page_template_workspace_policies, page_template_group_policies in share row exclusive mode`.execute(
    db,
  );
  await sql`create table page_template_workspace_gate_backup as
    select p.space_id, p.templates_enabled, p.revision, p.updated_at, to_jsonb(p) as original_policy,
      p.templates_enabled and coalesce(w.enabled, false) as migrated_enabled,
      p.revision + 1 as migrated_revision
    from page_template_space_policies p
    left join page_template_workspace_policies w on w.workspace_id = p.workspace_id`.execute(
    db,
  );
  await sql`alter table page_template_workspace_gate_backup add primary key (space_id)`.execute(
    db,
  );
  await sql`create table page_template_workspace_gate_context as select
    (select coalesce(jsonb_agg(to_jsonb(w) order by w.workspace_id), '[]'::jsonb) from page_template_workspace_policies w) as workspace_policies,
    (select coalesce(jsonb_agg(to_jsonb(g) order by g.space_id, g.group_id), '[]'::jsonb) from page_template_group_policies g) as group_policies`.execute(
    db,
  );
  await sql`update page_template_space_policies p
    set templates_enabled = b.migrated_enabled, revision = b.migrated_revision
    from page_template_workspace_gate_backup b where b.space_id = p.space_id`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`lock table page_template_space_policies, page_template_workspace_policies, page_template_group_policies, page_template_workspace_gate_backup, page_template_workspace_gate_context in share row exclusive mode`.execute(
    db,
  );
  const changed = await sql<{ changed: boolean }>`select exists (
    select 1 from page_template_workspace_gate_backup b
    full join page_template_space_policies p on p.space_id = b.space_id
    where p.space_id is null or b.space_id is null or to_jsonb(p) <> b.original_policy ||
      jsonb_build_object('templates_enabled', b.migrated_enabled, 'revision', b.migrated_revision)
  ) or exists (
    select 1 from page_template_workspace_gate_context b where
      b.workspace_policies <> (select coalesce(jsonb_agg(to_jsonb(w) order by w.workspace_id), '[]'::jsonb) from page_template_workspace_policies w)
      or b.group_policies <> (select coalesce(jsonb_agg(to_jsonb(g) order by g.space_id, g.group_id), '[]'::jsonb) from page_template_group_policies g)
  ) as changed`.execute(db);
  if (changed.rows[0]?.changed) {
    throw new Error(
      'Template policies changed after migration; restore a coordinated backup instead',
    );
  }
  await sql`update page_template_space_policies p
    set templates_enabled = b.templates_enabled, revision = b.revision, updated_at = b.updated_at
    from page_template_workspace_gate_backup b where b.space_id = p.space_id`.execute(
    db,
  );
  await sql`drop table page_template_workspace_gate_backup`.execute(db);
  await sql`drop table page_template_workspace_gate_context`.execute(db);
}
