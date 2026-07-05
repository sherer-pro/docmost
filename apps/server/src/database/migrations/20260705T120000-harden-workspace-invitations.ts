import { Kysely, sql } from 'kysely';
import { createHash } from 'node:crypto';

const LEGACY_INVITATION_TTL_SQL = sql`now() + interval '14 days'`;

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('workspace_invitations')
    .addColumn('token_hash', 'varchar')
    .addColumn('expires_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('workspace_invitations')
    .alterColumn('token', (col) => col.dropNotNull())
    .execute();

  const legacyInvitations = await db
    .selectFrom('workspace_invitations')
    .select(['id', 'token'])
    .where('token', 'is not', null)
    .execute();

  for (const invitation of legacyInvitations) {
    if (!invitation.token) {
      continue;
    }

    await db
      .updateTable('workspace_invitations')
      .set({
        token: null,
        token_hash: createHash('sha256')
          .update(invitation.token)
          .digest('hex'),
        expires_at: LEGACY_INVITATION_TTL_SQL,
      })
      .where('id', '=', invitation.id)
      .execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('workspace_invitations')
    .set({ token: sql`coalesce(token, token_hash, '')` })
    .where('token', 'is', null)
    .execute();

  await db.schema
    .alterTable('workspace_invitations')
    .alterColumn('token', (col) => col.setNotNull())
    .execute();

  await db.schema
    .alterTable('workspace_invitations')
    .dropColumn('expires_at')
    .dropColumn('token_hash')
    .execute();
}
