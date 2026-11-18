import { type Kysely, sql } from 'kysely';

// Keep the historical migration independent of future catalog changes.
const writesAndReads = JSON.stringify([
  'page.create',
  'page.title.write',
  'page.content.write',
  'page.image.upload',
  'page.comment.reply',
  'page.comment.resolve',
  'page.comments.read',
  'page.comment.read',
]);
const outboxKinds = [
  'workspace_invitation_email',
  'workspace_invitation_accepted_email',
  'duplicate_page_attachments',
  'page_template_sync',
  'notification_email',
  'notification_dispatch',
  'attachment_cleanup',
  'file_import',
];

async function setOutboxKinds(db: Kysely<any>, kinds: string[]) {
  await sql`
    alter table queue_outbox
      drop constraint if exists queue_outbox_kind_check,
      add constraint queue_outbox_kind_check check (kind in (${sql.join(kinds.map(sql.lit))}))
  `.execute(db);
}
export async function up(db: Kysely<any>): Promise<void> {
  await setOutboxKinds(db, [...outboxKinds, 'mcp_page_mutation']);
  await sql`
    create table mcp_write_legacy_capabilities (
      scope text not null,
      id uuid not null,
      previous jsonb,
      expanded jsonb not null,
      primary key (scope, id)
    )
  `.execute(db);
  await sql`
    insert into mcp_write_legacy_capabilities (scope, id, previous, expanded)
    select 'key', id, allowed_capabilities,
      coalesce(allowed_capabilities, '[]'::jsonb) ||
      (select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
       from jsonb_array_elements(${sql.lit(writesAndReads)}::jsonb) with ordinality as addition(value, ordinal)
       where not coalesce(allowed_capabilities, '[]'::jsonb) @> jsonb_build_array(value))
    from api_keys
    where key_type = 'mcp'
    on conflict do nothing
  `.execute(db);
  await sql`
    update api_keys as k set allowed_capabilities = l.expanded
    from mcp_write_legacy_capabilities as l
    where l.scope = 'key' and l.id = k.id and k.key_type = 'mcp'
      and k.allowed_capabilities is not distinct from l.previous
  `.execute(db);
  await sql`
    create table mcp_write_operations (
      key_id uuid not null references api_keys(id) on delete cascade,
      operation_id uuid not null,
      actor_id uuid not null,
      tool text not null,
      space_id uuid not null,
      page_id uuid,
      thread_id uuid,
      expected_revision text not null,
      payload_hash text not null,
      preview_hash text not null,
      started_at timestamptz,
      result jsonb,
      created_at timestamptz not null default now(),
      primary key (key_id, operation_id)
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`delete from queue_outbox where kind = 'mcp_page_mutation'`.execute(
    db,
  );
  await setOutboxKinds(db, outboxKinds);
  // Keep later administrator edits and remove write capabilities from those lists.
  await sql`
    update api_keys as k set allowed_capabilities = l.previous
    from mcp_write_legacy_capabilities as l
    where l.scope = 'key' and l.id = k.id and k.key_type = 'mcp'
      and k.allowed_capabilities = l.expanded
  `.execute(db);
  for (const table of [
    'api_keys',
    'ai_builtin_tool_workspace_policies',
    'ai_builtin_tool_space_policies',
  ]) {
    await sql`
      update ${sql.table(table)}
      set allowed_capabilities = allowed_capabilities - array[
        'page.create', 'page.title.write', 'page.content.write',
        'page.image.upload', 'page.comment.reply', 'page.comment.resolve'
      ]::text[]
      where allowed_capabilities ?| array[
        'page.create', 'page.title.write', 'page.content.write',
        'page.image.upload', 'page.comment.reply', 'page.comment.resolve'
      ]::text[]
    `.execute(db);
  }
  await db.schema.dropTable('mcp_write_operations').execute();
  await db.schema.dropTable('mcp_write_legacy_capabilities').execute();
}
