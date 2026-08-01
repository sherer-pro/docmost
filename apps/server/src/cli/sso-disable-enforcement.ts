import {
  createCliDatabase,
  loadCliEnv,
  parseCliArgs,
  requireStringArg,
  runCli,
} from './cli.util';

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
    let query = db
      .updateTable('workspaces')
      .set({ enforceSso: false, updatedAt: new Date() })
      .where('enforceSso', '=', true);

    if (workspace !== 'all') {
      query = query.where('id', '=', workspace);
    }

    const updated = await query.returning(['id', 'name']).execute();

    if (updated.length === 0) {
      console.log('No workspace had SSO enforcement enabled.');
      return;
    }

    for (const row of updated) {
      console.log(`Disabled SSO enforcement for workspace ${row.id} (${row.name})`);
    }
  } finally {
    await close();
  }
}

void runCli(main);
