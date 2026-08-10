import { Queue } from 'bullmq';
import { validate as isUuid } from 'uuid';
import { createRetryStrategy, parseRedisUrl } from '../common/helpers';
import { QueueJob, QueueName } from '../integrations/queue/constants';
import { CONTENT_INDEXABLE_EXTENSIONS } from '../core/attachment/attachment.constants';
import {
  CliArgs,
  createCliDatabase,
  loadCliEnv,
  parseCliArgs,
  requireEnv,
  requireStringArg,
  runCli,
} from './cli.util';

const VALID_ENTITIES = ['pages', 'attachments'] as const;
type Entity = (typeof VALID_ENTITIES)[number];

const SEARCH_REINDEX_USAGE = `Usage:
  pnpm --filter ./apps/server search:reindex -- \\
    --workspace=<uuid|all> \\
    [--entities=pages,attachments] \\
    [--reextract-attachments] \\
    [--retry-failed]

Options:
  --workspace=<uuid|all>       Required workspace scope.
  --entities=<list>            pages, attachments, or both (default: both).
  --reextract-attachments      Reset supported ready/skipped files and queue extraction.
  --retry-failed               Also reset failed files; requires --reextract-attachments.
  --help                       Show this help without connecting to services.`;

/**
 * Queues a full search rebuild and, optionally, attachment text re-extraction.
 *
 * pnpm --filter ./apps/server search:reindex -- \
 *   --workspace=<uuid|all> \
 *   --entities=pages,attachments \
 *   --reextract-attachments \
 *   --retry-failed
 */
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help === true) {
    console.log(SEARCH_REINDEX_USAGE);
    return;
  }

  loadCliEnv();

  const workspace = requireStringArg(args, 'workspace');
  if (workspace !== 'all' && !isUuid(workspace)) {
    throw new Error('--workspace must be a UUID or "all"');
  }
  const entities = parseEntities(args);
  const reextractAttachments = args['reextract-attachments'] === true;
  const retryFailed = args['retry-failed'] === true;

  if (retryFailed && !reextractAttachments) {
    throw new Error('--retry-failed requires --reextract-attachments');
  }
  if (reextractAttachments && !entities.includes('attachments')) {
    throw new Error(
      '--reextract-attachments requires attachments in --entities',
    );
  }

  const redisConfig = parseRedisUrl(requireEnv('REDIS_URL'));
  const connection = {
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    db: redisConfig.db,
    family: redisConfig.family,
    retryStrategy: createRetryStrategy(),
  };
  const searchQueue = new Queue(QueueName.SEARCH_QUEUE, { connection });
  const attachmentQueue = new Queue(QueueName.ATTACHMENT_QUEUE, { connection });
  const { db, close } = createCliDatabase();

  try {
    const workspaceIds = await resolveWorkspaceIds(db, workspace);
    if (reextractAttachments) {
      const resettableStatuses = retryFailed
        ? ['ready', 'skipped', 'failed']
        : ['ready', 'skipped'];
      const reset = await db
        .updateTable('attachments')
        .set({
          contentIndexStatus: 'pending',
          contentIndexError: null,
          contentIndexStartedAt: null,
          contentIndexedAt: null,
          contentIndexVersion: null,
        })
        .where('contentIndexStatus', 'in', resettableStatuses)
        .where('fileExt', 'in', [...CONTENT_INDEXABLE_EXTENSIONS])
        .where('deletedAt', 'is', null)
        .$if(workspace !== 'all', (qb) =>
          qb.where('workspaceId', 'in', workspaceIds),
        )
        .returning('id')
        .execute();
      console.log(`Reset ${reset.length} attachment extraction state(s).`);

      for (const workspaceId of workspaceIds) {
        await attachmentQueue.add(
          QueueJob.ATTACHMENT_INDEXING,
          { workspaceId, retryFailed },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 20_000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      }
      console.log(
        `Queued attachment text extraction for ${workspaceIds.length} workspace(s).`,
      );
    }

    if (process.env.SEARCH_DRIVER === 'typesense') {
      await searchQueue.add(
        QueueJob.TYPESENSE_FLUSH,
        {
          entities,
          ...(workspace === 'all' ? {} : { workspaceId: workspaceIds[0] }),
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 20_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      console.log(
        `Queued a Typesense rebuild for ${entities.join(' and ')} in ${workspace === 'all' ? 'all workspaces' : `workspace ${workspaceIds[0]}`}.`,
      );
    } else {
      console.log(
        'SEARCH_DRIVER is not "typesense"; skipped the search index rebuild.',
      );
    }
  } finally {
    await Promise.all([searchQueue.close(), attachmentQueue.close(), close()]);
  }
}

function parseEntities(args: CliArgs): Entity[] {
  const raw = args.entities;
  if (typeof raw !== 'string' || !raw.trim()) {
    return [...VALID_ENTITIES];
  }

  const entities = raw
    .split(',')
    .map((entity) => entity.trim())
    .filter(Boolean);
  const invalid = entities.filter(
    (entity) => !VALID_ENTITIES.includes(entity as Entity),
  );
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported --entities value(s): ${invalid.join(', ')}. Valid values: ${VALID_ENTITIES.join(', ')}`,
    );
  }

  return entities as Entity[];
}

async function resolveWorkspaceIds(
  db: ReturnType<typeof createCliDatabase>['db'],
  workspace: string,
): Promise<string[]> {
  if (workspace !== 'all') {
    const row = await db
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', workspace)
      .executeTakeFirst();
    if (!row) {
      throw new Error(`Workspace ${workspace} was not found`);
    }
    return [row.id];
  }

  const rows = await db.selectFrom('workspaces').select('id').execute();
  return rows.map((row) => row.id);
}

void runCli(main);
