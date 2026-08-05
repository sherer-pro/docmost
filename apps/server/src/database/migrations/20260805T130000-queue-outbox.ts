import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('queue_outbox')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('secret_payload', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('available_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('lease_token', 'uuid')
    .addColumn('lease_expires_at', 'timestamptz')
    .addColumn('dedupe_key', 'text', (col) => col.notNull())
    .addColumn('last_error_code', 'text')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('cancelled_at', 'timestamptz')
    .addColumn('failed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('queue_outbox_dedupe_key_unique', ['dedupe_key'])
    .addCheckConstraint(
      'queue_outbox_kind_check',
      sql`kind in ('workspace_invitation_email', 'workspace_invitation_accepted_email', 'duplicate_page_attachments')`,
    )
    .addCheckConstraint(
      'queue_outbox_status_check',
      sql`status in ('pending', 'processing', 'completed', 'cancelled', 'failed')`,
    )
    .addCheckConstraint(
      'queue_outbox_attempt_count_check',
      sql`attempt_count >= 0`,
    )
    .addCheckConstraint(
      'queue_outbox_lease_check',
      sql`(
        status = 'processing'
        and lease_token is not null
        and lease_expires_at is not null
      ) or (
        status <> 'processing'
        and lease_token is null
        and lease_expires_at is null
      )`,
    )
    .execute();

  await db.schema
    .createIndex('idx_queue_outbox_due')
    .on('queue_outbox')
    .columns(['status', 'available_at'])
    .execute();

  await db.schema
    .createIndex('idx_queue_outbox_expired_leases')
    .on('queue_outbox')
    .columns(['status', 'lease_expires_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('queue_outbox').execute();
}
