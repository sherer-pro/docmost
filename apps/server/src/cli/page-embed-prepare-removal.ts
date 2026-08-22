import {
  createCliDatabase,
  loadCliEnv,
  parseCliArgs,
  runCli,
} from './cli.util';
import {
  applyPageEmbedRemoval,
  parsePageEmbedRemovalInvocation,
  planPageEmbedRemoval,
  withPageEmbedRemovalLock,
} from './page-embed-removal';
import { createPageEmbedAttachmentCloneStorageFromEnvironment } from './page-embed-attachment-clones';

const USAGE = `Usage:
  corepack pnpm --filter ./apps/server page-embed:prepare-removal

  corepack pnpm --filter ./apps/server page-embed:prepare-removal -- \\
    --apply --yes \\
    --maintenance-ack=api-collab-workers-stopped \\
    --backup-ack=<backup-id> \\
    [explicit policies reported by plan]

The default invocation is read-only. Apply mode is bounded to 1..500 rows per
transaction and requires an explicit policy for every affected surface.`;

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help !== undefined) {
    if (args.help !== true) throw new Error('--help must not have a value');
    console.log(USAGE);
    return;
  }
  const invocation = parsePageEmbedRemovalInvocation(args);
  loadCliEnv();
  const { db, close } = createCliDatabase();
  let attachmentStorageRuntime:
    | ReturnType<typeof createPageEmbedAttachmentCloneStorageFromEnvironment>
    | undefined;

  try {
    if (invocation.mode === 'apply') {
      attachmentStorageRuntime =
        createPageEmbedAttachmentCloneStorageFromEnvironment();
    }
    const report =
      invocation.mode === 'plan'
        ? await withPageEmbedRemovalLock(db, (lockedDb) =>
            planPageEmbedRemoval(lockedDb, {
              batchSize: invocation.batchSize,
              contextPageLimit: invocation.contextPageLimit,
            }),
          )
        : await withPageEmbedRemovalLock(db, (lockedDb) =>
            applyPageEmbedRemoval(lockedDb, {
              policies: invocation.policies,
              batchSize: invocation.batchSize,
              contextPageLimit: invocation.contextPageLimit,
              attachmentStorage: attachmentStorageRuntime?.storage,
            }),
          );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await attachmentStorageRuntime?.close();
    await close();
  }
}

void runCli(main);
