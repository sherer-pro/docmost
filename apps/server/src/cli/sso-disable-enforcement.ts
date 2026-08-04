import {
  createCliDatabase,
  loadCliEnv,
  parseCliArgs,
  requireStringArg,
  runCli,
} from './cli.util';
import { sql } from 'kysely';

/**
 * Recovery path for a workspace whose SSO providers stopped working while
 * `enforce_sso` is on. It is console-only and adds no HTTP bypass.
 *
 * pnpm --filter ./apps/server sso:disable-enforcement -- --workspace=<uuid|all>
 */
async function main(): Promise<void> {
  loadCliEnv();

  const args = parseCliArgs(process.argv.slice(2));
  const workspace = requireStringArg(args, 'workspace');
  const { db, close } = createCliDatabase();

  try {
    const updated = await db.transaction().execute(async (trx) => {
      let workspaceQuery = trx
        .selectFrom('workspaces')
        .select(['id', 'name'])
        .forUpdate();
      if (workspace !== 'all') {
        workspaceQuery = workspaceQuery.where('id', '=', workspace);
      }
      const targets = await workspaceQuery.execute();
      const targetIds = targets.map((target) => target.id);
      if (targetIds.length === 0) {
        return [];
      }

      await trx
        .updateTable('workspaces')
        .set({ enforceSso: false, updatedAt: new Date() })
        .where('id', 'in', targetIds)
        .execute();
      await trx
        .updateTable('spaces')
        .set({
          settings: sql`settings #- '{security,enforceSso}'`,
          updatedAt: new Date(),
        })
        .where('workspaceId', 'in', targetIds)
        .where(sql<boolean>`settings #>> '{security,enforceSso}' = 'true'`)
        .execute();
      return targets;
    });

    if (updated.length === 0) {
      console.log('No matching workspace was found.');
      return;
    }

    for (const row of updated) {
      console.log(
        `Disabled SSO enforcement for workspace ${row.id} (${row.name})`,
      );
    }
  } finally {
    await close();
  }
}

void runCli(main);
