import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('billing').ifExists().execute();
  await sql`
    ALTER TABLE workspaces
      DROP COLUMN IF EXISTS stripe_customer_id,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS plan,
      DROP COLUMN IF EXISTS billing_email,
      DROP COLUMN IF EXISTS trial_end_at
  `.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Removed billing data and schema are intentionally not recreated.
}
