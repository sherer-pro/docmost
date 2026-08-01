import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_space_configs')
    .dropConstraint('ai_space_configs_retrieval_adapter_check')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropConstraint('ai_space_configs_retrieval_url_check')
    .execute();

  await db.schema
    .alterTable('ai_space_configs')
    .addColumn('retrieval_open_webui_base_url', 'text')
    .addColumn('retrieval_open_webui_api_key_encrypted', 'text')
    .addColumn('retrieval_open_webui_knowledge_id', 'varchar')
    .execute();

  await db.schema
    .alterTable('ai_space_configs')
    .addCheckConstraint(
      'ai_space_configs_retrieval_adapter_check',
      sql`
        "retrieval_adapter" in (
          'none',
          'http-json-v1',
          'open-webui-knowledge-v1'
        )
      `,
    )
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .addCheckConstraint(
      'ai_space_configs_retrieval_url_check',
      sql`
        (
          "retrieval_adapter" <> 'http-json-v1'
          or "retrieval_url" is not null
        )
        and (
          "retrieval_adapter" <> 'open-webui-knowledge-v1'
          or (
            "retrieval_open_webui_base_url" is not null
            and "retrieval_open_webui_knowledge_id" is not null
          )
        )
      `,
    )
    .execute();

  await db.schema
    .createIndex('idx_attachments_space_updated_id')
    .ifNotExists()
    .on('attachments')
    .columns(['space_id', 'updated_at', 'id'])
    .execute();

  await db.schema
    .createIndex('idx_attachments_space_deleted_id')
    .ifNotExists()
    .on('attachments')
    .columns(['space_id', 'deleted_at', 'id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('ai_space_configs')
    .set({ retrieval_adapter: 'none' })
    .where('retrieval_adapter', '=', 'open-webui-knowledge-v1')
    .execute();

  await db.schema
    .dropIndex('idx_attachments_space_deleted_id')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_attachments_space_updated_id')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('ai_space_configs')
    .dropConstraint('ai_space_configs_retrieval_adapter_check')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropConstraint('ai_space_configs_retrieval_url_check')
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .dropColumn('retrieval_open_webui_knowledge_id')
    .dropColumn('retrieval_open_webui_api_key_encrypted')
    .dropColumn('retrieval_open_webui_base_url')
    .execute();

  await db.schema
    .alterTable('ai_space_configs')
    .addCheckConstraint(
      'ai_space_configs_retrieval_adapter_check',
      sql`"retrieval_adapter" in ('none', 'http-json-v1')`,
    )
    .execute();
  await db.schema
    .alterTable('ai_space_configs')
    .addCheckConstraint(
      'ai_space_configs_retrieval_url_check',
      sql`"retrieval_adapter" = 'none' or "retrieval_url" is not null`,
    )
    .execute();
}
