import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('push_notification_jobs')
    .addColumn('revision', 'integer', (column) => column.notNull().defaultTo(1))
    .addColumn('lease_token', 'uuid')
    .addColumn('lease_expires_at', 'timestamptz')
    .execute();

  // A process may have disappeared while a legacy row was in `processing`.
  // Return those rows to the only recoverable pre-lease state before enforcing
  // the ownership invariant.
  await db
    .updateTable('push_notification_jobs')
    .set({ status: 'pending', updated_at: sql`now()` })
    .where('status', '=', 'processing')
    .execute();

  await db.schema
    .alterTable('push_notification_jobs')
    .addCheckConstraint(
      'push_notification_jobs_processing_lease_check',
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
    .createIndex('idx_push_notification_jobs_processing_lease')
    .on('push_notification_jobs')
    .columns(['status', 'lease_expires_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_push_notification_jobs_processing_lease')
    .execute();
  await db.schema
    .alterTable('push_notification_jobs')
    .dropConstraint('push_notification_jobs_processing_lease_check')
    .execute();
  await db.schema
    .alterTable('push_notification_jobs')
    .dropColumn('lease_expires_at')
    .dropColumn('lease_token')
    .dropColumn('revision')
    .execute();
}
