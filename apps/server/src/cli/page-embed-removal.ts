import { createHash } from 'node:crypto';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { type Kysely, sql } from 'kysely';
import { v5 as uuid5 } from 'uuid';
import * as Y from 'yjs';
import { createYdocFromJson } from '../common/helpers/prosemirror/utils';
import { jsonToText } from '../collaboration/collaboration.util';
import {
  pageEmbedAttachmentCloneId,
  preparePageEmbedAttachmentClones,
  rewriteMaterializedAttachmentReferences,
  type PageEmbedAttachmentCloneRequest,
  type PageEmbedAttachmentCloneStorage,
} from './page-embed-attachment-clones';

const PAGE_EMBED_LOCK_KEY = 'docmost-page-embed-removal';
const PAGE_EMBED_PATH = '$.** ? (@.type == "pageEmbed")';
const MAX_EMBED_DEPTH = 20;
const MAX_ANCESTRY_DEPTH = 100;
const DEFAULT_CONTEXT_PAGE_LIMIT = 5_000;
const MAX_CONTEXT_PAGE_LIMIT = 50_000;
const MAX_CONTEXT_ATTACHMENT_IDS = 100_000;
const MAX_PLAN_IDS = 25;
const MATERIALIZED_ID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

type JsonRecord = Record<string, any>;

type LegacySurfaceName =
  | 'pages.content'
  | 'pages.ydoc'
  | 'pages.ydoc_decode_error'
  | 'pages.materialization_context_limit'
  | 'page_history.content'
  | 'page_history.change_data'
  | 'page_transclusions.content'
  | 'page_template_revisions.content'
  | 'page_template_operations.staged_content'
  | 'databases.description_content'
  | 'database_cells.value'
  | 'comments.content'
  | 'page_transclusion_references'
  | 'orphan_block_transclusion_references'
  | 'inconsistent_transclusion_references'
  | 'pending_retired_operations'
  | 'failed_retired_cleanup_ledgers';

export interface PageEmbedRemovalPolicies {
  pages?: 'materialize-safe';
  unsafePages?: 'neutralize';
  ydocOnly?: 'clear';
  ydocDecode?: 'rebuild-from-content';
  pageHistory?: 'neutralize' | 'purge';
  pageTransclusions?: 'neutralize';
  templateRevisions?: 'neutralize';
  stagedOperations?: 'neutralize';
  databases?: 'neutralize';
  databaseCells?: 'neutralize';
  comments?: 'neutralize';
  references?: 'delete-after-clean';
  orphanReferences?: 'delete-after-clean';
}

interface LegacySurfacePlan {
  surface: LegacySurfaceName;
  kind: 'content' | 'ydoc' | 'reference' | 'operation';
  status: 'clean' | 'requires_policy' | 'hard_blocker';
  count: number;
  opaqueIds: string[];
  idsTruncated: boolean;
}

interface PageEmbedClassification {
  materializable: number;
  unavailable: number;
  unsafeAudience: number;
  unsafeAttachmentOwnership: number;
  invalidSourceContent: number;
}

export interface PageEmbedRemovalPlan {
  contractVersion: 1;
  mode: 'plan';
  legacySchemaPresent: boolean;
  surfaces: LegacySurfacePlan[];
  pageEmbeds: PageEmbedClassification;
  requiredPolicies: string[];
  hardBlockerCount: number;
  batching: {
    batchSize: number;
    contextPageLimit: number;
    semanticScanBatches: number;
    maxDecodedPageBatch: number;
    maxMaterializationContextPages: number;
  };
}

export interface PageEmbedRemovalApplyReport {
  contractVersion: 1;
  mode: 'apply';
  before: PageEmbedRemovalPlan;
  processed: Record<string, number>;
  after: PageEmbedRemovalPlan;
}

export interface PageEmbedRemovalInvocation {
  mode: 'plan' | 'apply';
  batchSize: number;
  contextPageLimit: number;
  policies: PageEmbedRemovalPolicies;
}

const POLICY_ARGUMENTS: Record<
  string,
  {
    policy: keyof PageEmbedRemovalPolicies;
    values: readonly string[];
  }
> = {
  'pages-policy': { policy: 'pages', values: ['materialize-safe'] },
  'unsafe-page-policy': { policy: 'unsafePages', values: ['neutralize'] },
  'ydoc-only-policy': { policy: 'ydocOnly', values: ['clear'] },
  'ydoc-decode-policy': {
    policy: 'ydocDecode',
    values: ['rebuild-from-content'],
  },
  'page-history-policy': {
    policy: 'pageHistory',
    values: ['neutralize', 'purge'],
  },
  'page-transclusions-policy': {
    policy: 'pageTransclusions',
    values: ['neutralize'],
  },
  'template-revisions-policy': {
    policy: 'templateRevisions',
    values: ['neutralize'],
  },
  'staged-operations-policy': {
    policy: 'stagedOperations',
    values: ['neutralize'],
  },
  'databases-policy': { policy: 'databases', values: ['neutralize'] },
  'database-cells-policy': {
    policy: 'databaseCells',
    values: ['neutralize'],
  },
  'comments-policy': { policy: 'comments', values: ['neutralize'] },
  'reference-policy': {
    policy: 'references',
    values: ['delete-after-clean'],
  },
  'orphan-reference-policy': {
    policy: 'orphanReferences',
    values: ['delete-after-clean'],
  },
};

export function parsePageEmbedRemovalInvocation(
  args: Record<string, string | boolean>,
): PageEmbedRemovalInvocation {
  const knownArguments = new Set([
    'apply',
    'yes',
    'maintenance-ack',
    'backup-ack',
    'batch-size',
    'context-page-limit',
    ...Object.keys(POLICY_ARGUMENTS),
  ]);
  const unknown = Object.keys(args).filter((name) => !knownArguments.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown option(s): ${unknown.map((name) => `--${name}`).join(', ')}`);
  }

  const apply = args.apply === true;
  if (args.apply !== undefined && !apply) {
    throw new Error('--apply must not have a value');
  }
  if (!apply && (args.yes !== undefined || args['maintenance-ack'] || args['backup-ack'])) {
    throw new Error('Mutation acknowledgements require --apply');
  }
  if (apply) {
    if (args.yes !== true) throw new Error('--apply requires --yes');
    if (args['maintenance-ack'] !== 'api-collab-workers-stopped') {
      throw new Error(
        '--apply requires --maintenance-ack=api-collab-workers-stopped',
      );
    }
    if (
      typeof args['backup-ack'] !== 'string' ||
      !args['backup-ack'].trim()
    ) {
      throw new Error('--apply requires --backup-ack=<backup-id>');
    }
  }

  const policies: PageEmbedRemovalPolicies = {};
  for (const [argument, definition] of Object.entries(POLICY_ARGUMENTS)) {
    const value = args[argument];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !definition.values.includes(value)) {
      throw new Error(
        `--${argument} must be one of: ${definition.values.join(', ')}`,
      );
    }
    (policies as Record<string, string>)[definition.policy] = value;
  }

  const rawBatchSize = args['batch-size'];
  if (rawBatchSize === true) {
    throw new Error('--batch-size=<1..500> requires a value');
  }
  const batchSize = normalizeBatchSize(
    rawBatchSize === undefined ? undefined : Number(rawBatchSize),
  );
  const rawContextPageLimit = args['context-page-limit'];
  if (rawContextPageLimit === true) {
    throw new Error('--context-page-limit=<batchSize..50000> requires a value');
  }
  const contextPageLimit = normalizeContextPageLimit(
    rawContextPageLimit === undefined
      ? undefined
      : Number(rawContextPageLimit),
    batchSize,
  );
  return {
    mode: apply ? 'apply' : 'plan',
    batchSize,
    contextPageLimit,
    policies,
  };
}

export interface PageRow {
  id: string;
  workspaceId: string;
  spaceId: string;
  parentPageId: string | null;
  deletedAt: Date | string | null;
  content: unknown;
  ydoc: Buffer | null;
  ydocContent?: unknown;
  ydocDecodeError?: boolean;
  authoritativeContent?: unknown;
}

interface AttachmentRow {
  id: string;
  pageId: string | null;
  deletedAt: Date | string | null;
}

export interface PageMaterializationContext {
  dirtyPages: PageRow[];
  pages: Map<string, PageRow>;
  accessRulePageIds: Set<string>;
  sharesByPageId: Map<string, boolean[]>;
  attachments: Map<string, AttachmentRow>;
  limitExceeded: boolean;
}

interface PageScanSummary {
  content: LegacySurfacePlan;
  ydoc: LegacySurfacePlan;
  ydocDecodeError: LegacySurfacePlan;
  contextLimit: LegacySurfacePlan;
  pageEmbeds: PageEmbedClassification;
  hasDecodeErrorWithContent: boolean;
  hasDecodeErrorWithoutContent: boolean;
  batches: number;
  maxDecodedPageBatch: number;
  maxMaterializationContextPages: number;
}

interface SurfaceAccumulator {
  count: number;
  ids: string[];
}

interface MaterializationReport extends PageEmbedClassification {
  blocked: Array<{
    consumerPageId: string;
    reason: 'audience' | 'attachment';
  }>;
  attachmentCloneRequests: PageEmbedAttachmentCloneRequest[];
}

interface JsonSurfaceDefinition {
  name: Exclude<
    LegacySurfaceName,
    | 'pages.content'
    | 'pages.ydoc'
    | 'pages.ydoc_decode_error'
    | 'pages.materialization_context_limit'
    | 'page_transclusion_references'
    | 'orphan_block_transclusion_references'
    | 'inconsistent_transclusion_references'
    | 'pending_retired_operations'
    | 'failed_retired_cleanup_ledgers'
  >;
  table: string;
  column: string;
  policy: keyof PageEmbedRemovalPolicies;
  allowPurge: boolean;
}

const JSON_SURFACES: JsonSurfaceDefinition[] = [
  {
    name: 'page_history.content',
    table: 'page_history',
    column: 'content',
    policy: 'pageHistory',
    allowPurge: true,
  },
  {
    name: 'page_history.change_data',
    table: 'page_history',
    column: 'change_data',
    policy: 'pageHistory',
    allowPurge: true,
  },
  {
    name: 'page_transclusions.content',
    table: 'page_transclusions',
    column: 'content',
    policy: 'pageTransclusions',
    allowPurge: false,
  },
  {
    name: 'page_template_revisions.content',
    table: 'page_template_revisions',
    column: 'content',
    policy: 'templateRevisions',
    allowPurge: false,
  },
  {
    name: 'page_template_operations.staged_content',
    table: 'page_template_operations',
    column: 'staged_content',
    policy: 'stagedOperations',
    allowPurge: false,
  },
  {
    name: 'databases.description_content',
    table: 'databases',
    column: 'description_content',
    policy: 'databases',
    allowPurge: false,
  },
  {
    name: 'database_cells.value',
    table: 'database_cells',
    column: 'value',
    policy: 'databaseCells',
    allowPurge: false,
  },
  {
    name: 'comments.content',
    table: 'comments',
    column: 'content',
    policy: 'comments',
    allowPurge: false,
  },
];

export async function withPageEmbedRemovalLock<T>(
  database: Kysely<any>,
  callback: (db: Kysely<any>) => Promise<T>,
): Promise<T> {
  return database.connection().execute(async (connection) => {
    const db = connection.withoutPlugins();
    const lock = await sql<{ locked: boolean }>`
      select pg_try_advisory_lock(
        hashtextextended(${PAGE_EMBED_LOCK_KEY}, 0)
      ) as locked
    `.execute(db);
    if (!lock.rows[0]?.locked) {
      throw new Error('Another pageEmbed removal command is already running');
    }
    try {
      return await callback(db);
    } finally {
      await sql`
        select pg_advisory_unlock(
          hashtextextended(${PAGE_EMBED_LOCK_KEY}, 0)
        )
      `.execute(db);
    }
  });
}

export async function planPageEmbedRemoval(
  inputDb: Kysely<any>,
  options: { batchSize?: number; contextPageLimit?: number } = {},
): Promise<PageEmbedRemovalPlan> {
  const db = inputDb.withoutPlugins();
  const batchSize = normalizeBatchSize(options.batchSize);
  const contextPageLimit = normalizeContextPageLimit(
    options.contextPageLimit,
    batchSize,
  );
  const legacySchemaPresent = await hasLegacyReferenceSchema(db);
  if (!legacySchemaPresent) {
    return {
      contractVersion: 1,
      mode: 'plan',
      legacySchemaPresent: false,
      surfaces: [],
      pageEmbeds: emptyClassification(),
      requiredPolicies: [],
      hardBlockerCount: 0,
      batching: {
        batchSize,
        contextPageLimit,
        semanticScanBatches: 0,
        maxDecodedPageBatch: 0,
        maxMaterializationContextPages: 0,
      },
    };
  }

  const pageScan = await scanPagesBounded(
    db,
    batchSize,
    contextPageLimit,
  );
  const surfaces: LegacySurfacePlan[] = [
    pageScan.content,
    pageScan.ydoc,
    pageScan.ydocDecodeError,
    pageScan.contextLimit,
  ];
  for (const definition of JSON_SURFACES) {
    surfaces.push(await scanJsonSurface(db, definition));
  }
  surfaces.push(
    await scanReferenceSurface(db),
    await scanOrphanBlockReferenceSurface(db),
    await scanInconsistentReferenceSurface(db),
    await scanPendingOperationSurface(db),
    await scanFailedCleanupSurface(db),
  );

  const pageEmbeds = pageScan.pageEmbeds;
  const requiredPolicies = requiredPoliciesFor(
    surfaces,
    pageEmbeds,
    pageScan.hasDecodeErrorWithContent,
    pageScan.hasDecodeErrorWithoutContent,
  );

  return {
    contractVersion: 1,
    mode: 'plan',
    legacySchemaPresent: true,
    surfaces,
    pageEmbeds,
    requiredPolicies,
    hardBlockerCount: surfaces
      .filter((surface) => surface.status === 'hard_blocker')
      .reduce((total, surface) => total + surface.count, 0),
    batching: {
      batchSize,
      contextPageLimit,
      semanticScanBatches: pageScan.batches,
      maxDecodedPageBatch: pageScan.maxDecodedPageBatch,
      maxMaterializationContextPages:
        pageScan.maxMaterializationContextPages,
    },
  };
}

export async function applyPageEmbedRemoval(
  inputDb: Kysely<any>,
  options: {
    policies: PageEmbedRemovalPolicies;
    batchSize?: number;
    contextPageLimit?: number;
    createYdoc?: (content: unknown) => Buffer | null;
    toText?: (content: unknown) => string;
    attachmentStorage?: PageEmbedAttachmentCloneStorage;
  },
): Promise<PageEmbedRemovalApplyReport> {
  const db = inputDb.withoutPlugins();
  const batchSize = normalizeBatchSize(options.batchSize);
  const contextPageLimit = normalizeContextPageLimit(
    options.contextPageLimit,
    batchSize,
  );
  const before = await planPageEmbedRemoval(db, {
    batchSize,
    contextPageLimit,
  });
  if (!before.legacySchemaPresent) {
    throw new Error('Legacy pageEmbed schema is not present');
  }
  if (before.hardBlockerCount > 0) {
    throw new Error(
      'Pending or failed retired operations must be reconciled with the previous compatible release before cleanup',
    );
  }
  assertPolicies(before, options.policies);

  const processed: Record<string, number> = {};
  processed.pages = 0;
  await scanPagesBounded(
    db,
    batchSize,
    contextPageLimit,
    async (context) => {
      if (context.limitExceeded) {
        throw new Error(
          'Materialization context exceeded --context-page-limit; no pages were changed in this batch',
        );
      }
      processed.pages += await cleanPages(
        db,
        context,
        options.policies,
        batchSize,
        options.createYdoc ?? createYdocFromJson,
        options.toText ?? ((content) => jsonToText(content as any)),
        options.attachmentStorage,
      );
    },
  );

  for (const definition of JSON_SURFACES) {
    const policy = options.policies[definition.policy] as
      | 'neutralize'
      | 'purge'
      | undefined;
    if (!policy) continue;
    processed[definition.name] = await cleanJsonSurface(
      db,
      definition,
      policy,
      batchSize,
    );
  }

  const beforeReferenceCleanup = await planPageEmbedRemoval(db, {
    batchSize,
    contextPageLimit,
  });
  const contentRemaining = beforeReferenceCleanup.surfaces
    .filter(
      (surface) =>
        surface.kind === 'content' || surface.kind === 'ydoc',
    )
    .reduce((total, surface) => total + surface.count, 0);
  if (contentRemaining > 0 || beforeReferenceCleanup.hardBlockerCount > 0) {
    throw new Error(
      'Content verification failed; legacy reference rows were not removed',
    );
  }

  if (options.policies.references === 'delete-after-clean') {
    processed.page_transclusion_references = await deleteLegacyReferences(
      db,
      batchSize,
    );
  }
  if (options.policies.orphanReferences === 'delete-after-clean') {
    processed.orphan_block_transclusion_references =
      await deleteOrphanBlockReferences(db, batchSize);
  }

  const verified = await planPageEmbedRemoval(db, {
    batchSize,
    contextPageLimit,
  });
  const remaining = verified.surfaces.reduce(
    (total, surface) => total + surface.count,
    0,
  );
  if (remaining > 0) {
    throw new Error(
      'Final verification still finds legacy pageEmbed state; rerun plan before retrying',
    );
  }
  processed.page_embed_removal_ledger = await writeRemovalLedger(
    db,
    batchSize,
  );

  return {
    contractVersion: 1,
    mode: 'apply',
    before,
    processed,
    after: verified,
  };
}

async function hasLegacyReferenceSchema(db: Kysely<any>): Promise<boolean> {
  const result = await sql<{ present: boolean }>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'page_transclusion_references'
        and column_name = 'reference_kind'
    ) as present
  `.execute(db);
  return Boolean(result.rows[0]?.present);
}

async function scanPagesBounded(
  db: Kysely<any>,
  batchSize: number,
  contextPageLimit: number,
  onDirtyBatch?: (context: PageMaterializationContext) => Promise<void>,
): Promise<PageScanSummary> {
  const content: SurfaceAccumulator = { count: 0, ids: [] };
  const ydoc: SurfaceAccumulator = { count: 0, ids: [] };
  const ydocDecodeError: SurfaceAccumulator = { count: 0, ids: [] };
  const contextLimit: SurfaceAccumulator = { count: 0, ids: [] };
  const pageEmbeds = emptyClassification();
  let hasDecodeErrorWithContent = false;
  let hasDecodeErrorWithoutContent = false;
  let batches = 0;
  let maxDecodedPageBatch = 0;
  let maxMaterializationContextPages = 0;
  let lastId: string | null = null;

  while (true) {
    const result = await sql<PageRow>`
      select
        id::text as "id",
        workspace_id::text as "workspaceId",
        space_id::text as "spaceId",
        parent_page_id::text as "parentPageId",
        deleted_at as "deletedAt",
        content,
        ydoc
      from pages
      where (${lastId}::uuid is null or id > ${lastId}::uuid)
        and (
          ydoc is not null
          or jsonb_path_exists(
            coalesce(content, 'null'::jsonb),
            ${PAGE_EMBED_PATH}::jsonpath
          )
        )
      order by id
      limit ${batchSize}
    `.execute(db);
    if (result.rows.length === 0) break;
    batches += 1;
    maxDecodedPageBatch = Math.max(maxDecodedPageBatch, result.rows.length);
    const decoded = result.rows.map(decodePageYdoc);

    for (const page of decoded) {
      if (containsPageEmbed(page.content)) addSurfaceId(content, page.id);
      if (
        page.ydoc &&
        !page.ydocDecodeError &&
        containsPageEmbed(page.ydocContent)
      ) {
        addSurfaceId(ydoc, page.id);
      }
      if (page.ydocDecodeError) {
        addSurfaceId(ydocDecodeError, page.id);
        if (page.content == null) hasDecodeErrorWithoutContent = true;
        else hasDecodeErrorWithContent = true;
      }
    }

    const dirtyPages = decoded.filter(
      (page) =>
        containsPageEmbed(page.content) ||
        containsPageEmbed(page.ydocContent) ||
        page.ydocDecodeError,
    );
    if (dirtyPages.length > 0) {
      const context = await loadPageMaterializationContext(
        db,
        dirtyPages,
        contextPageLimit,
      );
      maxMaterializationContextPages = Math.max(
        maxMaterializationContextPages,
        context.pages.size,
      );
      if (context.limitExceeded) {
        for (const page of dirtyPages) addSurfaceId(contextLimit, page.id);
      } else {
        addClassification(pageEmbeds, classifyPageEmbeds(context));
      }
      await onDirtyBatch?.(context);
    }
    lastId = result.rows[result.rows.length - 1].id;
  }

  return {
    content: surfaceFromAccumulator('pages.content', 'content', content),
    ydoc: surfaceFromAccumulator('pages.ydoc', 'ydoc', ydoc),
    ydocDecodeError: surfaceFromAccumulator(
      'pages.ydoc_decode_error',
      'ydoc',
      ydocDecodeError,
    ),
    contextLimit: surfaceFromAccumulator(
      'pages.materialization_context_limit',
      'content',
      contextLimit,
      true,
    ),
    pageEmbeds,
    hasDecodeErrorWithContent,
    hasDecodeErrorWithoutContent,
    batches,
    maxDecodedPageBatch,
    maxMaterializationContextPages,
  };
}

async function scanJsonSurface(
  db: Kysely<any>,
  definition: JsonSurfaceDefinition,
): Promise<LegacySurfacePlan> {
  const table = sql.table(definition.table);
  const column = sql.ref(definition.column);
  return scanStaticSurface(
    db,
    definition.name,
    'content',
    sql`from ${table} where jsonb_path_exists(
      coalesce(${column}, 'null'::jsonb),
      ${PAGE_EMBED_PATH}::jsonpath
    )`,
  );
}

async function scanReferenceSurface(
  db: Kysely<any>,
): Promise<LegacySurfacePlan> {
  return scanStaticSurface(
    db,
    'page_transclusion_references',
    'reference',
    sql`from page_transclusion_references
      where reference_kind = 'page'
        or transclusion_id is null
        or reference_node_id is not null`,
  );
}

async function scanOrphanBlockReferenceSurface(
  db: Kysely<any>,
): Promise<LegacySurfacePlan> {
  return scanStaticSurface(
    db,
    'orphan_block_transclusion_references',
    'reference',
    sql`from page_transclusion_references as reference
      where reference.reference_kind = 'block'
        and not exists (
          select 1 from pages as source
          where source.id = reference.source_page_id
        )`,
  );
}

async function scanInconsistentReferenceSurface(
  db: Kysely<any>,
): Promise<LegacySurfacePlan> {
  return scanStaticSurface(
    db,
    'inconsistent_transclusion_references',
    'reference',
    sql`from (
      select reference.id
      from page_transclusion_references as reference
      left join pages as consumer on consumer.id = reference.reference_page_id
      left join pages as source on source.id = reference.source_page_id
      where consumer.id is null
        or (
          source.id is not null
          and (
            reference.workspace_id <> consumer.workspace_id
            or reference.workspace_id <> source.workspace_id
          )
        )
    ) as inconsistent_reference`,
    true,
  );
}

async function scanPendingOperationSurface(
  db: Kysely<any>,
): Promise<LegacySurfacePlan> {
  return scanStaticSurface(
    db,
    'pending_retired_operations',
    'operation',
    sql`from page_template_operations
      where operation_kind in (
        'embed_insert', 'embed_detach', 'legacy_embed_migration'
      ) and status = 'pending'`,
    true,
  );
}

async function scanFailedCleanupSurface(
  db: Kysely<any>,
): Promise<LegacySurfacePlan> {
  return scanStaticSurface(
    db,
    'failed_retired_cleanup_ledgers',
    'operation',
    sql`from page_template_operations
      where operation_kind in (
        'embed_insert', 'embed_detach', 'legacy_embed_migration'
      )
        and status = 'failed'
        and (
          coalesce(attachment_mapping, 'null'::jsonb)
            not in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)
          or coalesce(staged_content, 'null'::jsonb)
            not in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)
        )`,
    true,
  );
}

async function scanStaticSurface(
  db: Kysely<any>,
  surface: LegacySurfaceName,
  kind: LegacySurfacePlan['kind'],
  fromAndWhere: ReturnType<typeof sql>,
  hardBlocker = false,
): Promise<LegacySurfacePlan> {
  const countResult = await sql<{ count: string | number }>`
    select count(*) as count ${fromAndWhere}
  `.execute(db);
  const count = Number(countResult.rows[0]?.count ?? 0);
  const idsResult = await sql<{ id: string }>`
    select id::text as id ${fromAndWhere}
    order by id
    limit ${MAX_PLAN_IDS}
  `.execute(db);
  return {
    surface,
    kind,
    status:
      count === 0 ? 'clean' : hardBlocker ? 'hard_blocker' : 'requires_policy',
    count,
    opaqueIds: idsResult.rows.map((row) => opaqueId(row.id)),
    idsTruncated: count > idsResult.rows.length,
  };
}

function addSurfaceId(accumulator: SurfaceAccumulator, id: string): void {
  accumulator.count += 1;
  if (accumulator.ids.length < MAX_PLAN_IDS) accumulator.ids.push(id);
}

function surfaceFromAccumulator(
  surface: LegacySurfaceName,
  kind: LegacySurfacePlan['kind'],
  accumulator: SurfaceAccumulator,
  hardBlocker = false,
): LegacySurfacePlan {
  return {
    surface,
    kind,
    status:
      accumulator.count === 0
        ? 'clean'
        : hardBlocker
          ? 'hard_blocker'
          : 'requires_policy',
    count: accumulator.count,
    opaqueIds: accumulator.ids.map(opaqueId),
    idsTruncated: accumulator.count > accumulator.ids.length,
  };
}

async function loadPageMaterializationContext(
  db: Kysely<any>,
  dirtyPages: PageRow[],
  contextPageLimit: number,
): Promise<PageMaterializationContext> {
  const pages = new Map(dirtyPages.map((page) => [page.id, page]));
  const consideredPageIds = new Set(pages.keys());
  let limitExceeded = false;
  const sourceQueue = new Map<string, number>();
  const enqueuePage = (
    queue: Map<string, number>,
    id: string,
    depth: number,
    maxDepth: number,
  ) => {
    if (depth > maxDepth || pages.has(id) || consideredPageIds.has(id)) return;
    if (consideredPageIds.size >= contextPageLimit) {
      limitExceeded = true;
      return;
    }
    consideredPageIds.add(id);
    queue.set(id, depth);
  };
  for (const page of dirtyPages) {
    for (const reference of collectPageEmbedReferences(
      page.authoritativeContent,
    )) {
      enqueuePage(sourceQueue, reference.sourcePageId, 1, MAX_EMBED_DEPTH);
    }
  }
  const attemptedSources = new Set<string>();
  while (sourceQueue.size > 0) {
    const queued = [...sourceQueue].filter(
      ([id]) => !attemptedSources.has(id),
    );
    sourceQueue.clear();
    if (queued.length === 0) break;
    for (const [id] of queued) attemptedSources.add(id);
    const depthById = new Map(queued);
    for (const batch of chunks(
      queued.map(([id]) => id),
      500,
    )) {
      const result = await loadPagesByIds(db, batch);
      for (const page of result) {
        pages.set(page.id, page);
        const depth = depthById.get(page.id) ?? MAX_EMBED_DEPTH;
        if (depth >= MAX_EMBED_DEPTH) continue;
        for (const reference of collectPageEmbedReferences(
          page.authoritativeContent,
        )) {
          if (attemptedSources.has(reference.sourcePageId)) continue;
          enqueuePage(
            sourceQueue,
            reference.sourcePageId,
            depth + 1,
            MAX_EMBED_DEPTH,
          );
        }
      }
    }
  }

  const ancestryQueue = new Map<string, number>();
  for (const page of pages.values()) {
    if (page.parentPageId) {
      enqueuePage(
        ancestryQueue,
        page.parentPageId,
        1,
        MAX_ANCESTRY_DEPTH,
      );
    }
  }
  const attemptedAncestors = new Set<string>();
  while (ancestryQueue.size > 0) {
    const queued = [...ancestryQueue].filter(
      ([id]) => !attemptedAncestors.has(id),
    );
    ancestryQueue.clear();
    if (queued.length === 0) break;
    for (const [id] of queued) attemptedAncestors.add(id);
    const depthById = new Map(queued);
    for (const batch of chunks(
      queued.map(([id]) => id),
      500,
    )) {
      const result = await loadPagesByIds(db, batch);
      for (const page of result) {
        pages.set(page.id, page);
        const depth = depthById.get(page.id) ?? MAX_ANCESTRY_DEPTH;
        if (
          page.parentPageId &&
          depth < MAX_ANCESTRY_DEPTH &&
          !attemptedAncestors.has(page.parentPageId)
        ) {
          enqueuePage(
            ancestryQueue,
            page.parentPageId,
            depth + 1,
            MAX_ANCESTRY_DEPTH,
          );
        }
      }
    }
  }

  const relevantPageIds = [...pages.keys()];
  const accessRulePageIds = new Set<string>();
  const sharesByPageId = new Map<string, boolean[]>();
  for (const batch of chunks(relevantPageIds, 500)) {
    const rules = await sql<{ pageId: string }>`
      select distinct page_id::text as "pageId"
      from page_access_rules
      where page_id in (${sql.join(batch)})
    `.execute(db);
    for (const row of rules.rows) accessRulePageIds.add(row.pageId);

    const shares = await sql<{ pageId: string; includeSubPages: boolean }>`
      select
        page_id::text as "pageId",
        coalesce(include_sub_pages, false) as "includeSubPages"
      from shares
      where deleted_at is null
        and page_id in (${sql.join(batch)})
    `.execute(db);
    for (const share of shares.rows) {
      const values = sharesByPageId.get(share.pageId) ?? [];
      values.push(Boolean(share.includeSubPages));
      sharesByPageId.set(share.pageId, values);
    }
  }

  const attachmentIds = new Set<string>();
  attachmentScan: for (const page of pages.values()) {
    for (const id of collectAttachmentIds(
      page.authoritativeContent,
      MAX_CONTEXT_ATTACHMENT_IDS + 1,
    )) {
      if (!attachmentIds.has(id) && attachmentIds.size >= MAX_CONTEXT_ATTACHMENT_IDS) {
        limitExceeded = true;
        break attachmentScan;
      }
      attachmentIds.add(id);
    }
  }
  const attachments = new Map<string, AttachmentRow>();
  for (const batch of chunks([...attachmentIds], 500)) {
    const result = await sql<AttachmentRow>`
      select
        id::text as "id",
        page_id::text as "pageId",
        deleted_at as "deletedAt"
      from attachments
      where id in (${sql.join(batch)})
    `.execute(db);
    for (const attachment of result.rows) {
      attachments.set(attachment.id, attachment);
    }
  }

  return {
    dirtyPages,
    pages,
    accessRulePageIds,
    sharesByPageId,
    attachments,
    limitExceeded,
  };
}

async function loadPagesByIds(
  db: Kysely<any>,
  ids: string[],
): Promise<PageRow[]> {
  if (ids.length === 0) return [];
  const result = await sql<PageRow>`
    select
      id::text as "id",
      workspace_id::text as "workspaceId",
      space_id::text as "spaceId",
      parent_page_id::text as "parentPageId",
      deleted_at as "deletedAt",
      content,
      ydoc
    from pages
    where id in (${sql.join(ids)})
  `.execute(db);
  return result.rows.map(decodePageYdoc);
}

export function decodePageYdoc(page: PageRow): PageRow {
  const normalizedPage = {
    ...page,
    content: normalizeJsonValue(page.content),
  };
  if (!page.ydoc) {
    return {
      ...normalizedPage,
      authoritativeContent: normalizedPage.content,
    };
  }
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, new Uint8Array(page.ydoc));
    const ydocContent = TiptapTransformer.fromYdoc(document, 'default');
    return {
      ...normalizedPage,
      ydocContent,
      ydocDecodeError: false,
      authoritativeContent: ydocContent,
    };
  } catch {
    return {
      ...normalizedPage,
      ydocDecodeError: true,
      authoritativeContent: normalizedPage.content,
    };
  } finally {
    document.destroy();
  }
}

function classifyPageEmbeds(
  context: PageMaterializationContext,
): PageEmbedClassification {
  const combined = emptyClassification();
  for (const page of context.dirtyPages) {
    if (!containsPageEmbed(page.authoritativeContent)) continue;
    const result = materializePageEmbeds(page, context, 'block');
    addClassification(combined, result.report);
  }
  return combined;
}

export function materializePageEmbeds(
  consumer: PageRow,
  context: PageMaterializationContext,
  unsafePolicy: 'block' | 'neutralize',
): { value: unknown; report: MaterializationReport } {
  const report: MaterializationReport = {
    ...emptyClassification(),
    blocked: [],
    attachmentCloneRequests: [],
  };

  const walk = (
    value: unknown,
    referencePageId: string,
    ancestors: ReadonlySet<string>,
    depth: number,
    path: string,
  ): unknown => {
    if (Array.isArray(value)) {
      return value.flatMap((child, index) => {
        const converted = walk(
          child,
          referencePageId,
          ancestors,
          depth,
          `${path}.${index}`,
        );
        return Array.isArray(converted) ? converted : [converted];
      });
    }
    if (!isRecord(value)) return value;
    if (value.type === 'pageEmbed') {
      const sourcePageId =
        typeof value.attrs?.sourcePageId === 'string'
          ? value.attrs.sourcePageId
          : undefined;
      const source = sourcePageId
        ? context.pages.get(sourcePageId)
        : undefined;
      if (
        !sourcePageId ||
        !source ||
        source.deletedAt ||
        source.authoritativeContent == null ||
        ancestors.has(sourcePageId) ||
        depth >= MAX_EMBED_DEPTH
      ) {
        report.unavailable += 1;
        return unavailableCallout();
      }
      if (!hasCompatibleAudience(consumer, source, context)) {
        report.unsafeAudience += 1;
        report.blocked.push({
          consumerPageId: consumer.id,
          reason: 'audience',
        });
        return unsafePolicy === 'neutralize'
          ? unsafeCallout()
          : structuredClone(value);
      }
      const attachmentPlan = planMaterializedAttachmentClones(
        consumer,
        source,
        context,
      );
      if (!attachmentPlan.safe) {
        report.unsafeAttachmentOwnership += 1;
        report.blocked.push({
          consumerPageId: consumer.id,
          reason: 'attachment',
        });
        return unsafePolicy === 'neutralize'
          ? unsafeCallout()
          : structuredClone(value);
      }
      const document = parseDocument(source.authoritativeContent);
      if (!document) {
        report.invalidSourceContent += 1;
        return unavailableCallout();
      }
      const referenceNodeId =
        typeof value.attrs?.id === 'string' ? value.attrs.id : path;
      const materialized = cloneMaterializedDocument(document, {
        consumerPageId: consumer.id,
        sourcePageId,
        referenceNodeId,
      });
      report.attachmentCloneRequests.push(...attachmentPlan.requests);
      const rewritten = rewriteMaterializedAttachmentReferences(
        materialized,
        attachmentPlan.attachmentIds,
      ) as JsonRecord;
      report.materializable += 1;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(sourcePageId);
      return rewritten.content.flatMap((child: unknown, index: number) => {
        const converted = walk(
          child,
          sourcePageId,
          nextAncestors,
          depth + 1,
          `${path}.materialized.${index}`,
        );
        return Array.isArray(converted) ? converted : [converted];
      });
    }

    const converted: JsonRecord = {};
    for (const [key, child] of Object.entries(value)) {
      converted[key] = walk(
        child,
        referencePageId,
        ancestors,
        depth,
        `${path}.${key}`,
      );
    }
    return converted;
  };

  return {
    value: walk(
      consumer.authoritativeContent,
      consumer.id,
      new Set([consumer.id]),
      0,
      consumer.id,
    ),
    report,
  };
}

async function cleanPages(
  db: Kysely<any>,
  context: PageMaterializationContext,
  policies: PageEmbedRemovalPolicies,
  batchSize: number,
  createYdoc: (content: unknown) => Buffer | null,
  toText: (content: unknown) => string,
  attachmentStorage: PageEmbedAttachmentCloneStorage | undefined,
): Promise<number> {
  let processed = 0;
  const candidates = context.dirtyPages.filter(
    (page) =>
      containsPageEmbed(page.content) ||
      containsPageEmbed(page.ydocContent) ||
      page.ydocDecodeError,
  );
  for (const batch of chunks(candidates, batchSize)) {
    const prepared = batch.map((page) => {
      if (
        page.ydocDecodeError &&
        page.content != null &&
        policies.ydocDecode !== 'rebuild-from-content'
      ) {
        throw new Error(
          `Page ${opaqueId(page.id)} requires --ydoc-decode-policy=rebuild-from-content`,
        );
      }
      let content = page.authoritativeContent;
      let attachmentCloneRequests: PageEmbedAttachmentCloneRequest[] = [];
      if (containsPageEmbed(content)) {
        const materialized = materializePageEmbeds(
          page,
          context,
          policies.unsafePages === 'neutralize' ? 'neutralize' : 'block',
        );
        if (materialized.report.blocked.length > 0 && !policies.unsafePages) {
          throw new Error(
            `Page ${opaqueId(page.id)} requires --unsafe-page-policy=neutralize`,
          );
        }
        content = materialized.value;
        attachmentCloneRequests = materialized.report.attachmentCloneRequests;
      }
      if (containsPageEmbed(content)) {
        throw new Error(
          `Page ${opaqueId(page.id)} still contains pageEmbed after materialization`,
        );
      }
      if (content == null && page.ydoc && policies.ydocOnly !== 'clear') {
        throw new Error(
          `Page ${opaqueId(page.id)} requires --ydoc-only-policy=clear`,
        );
      }
      return { page, content, attachmentCloneRequests };
    });

    const cloneRequests = prepared.flatMap(
      (item) => item.attachmentCloneRequests,
    );
    if (cloneRequests.length > 0) {
      if (!attachmentStorage) {
        throw new Error(
          'Source-owned attachments require apply-only attachment storage',
        );
      }
      await preparePageEmbedAttachmentClones(
        db,
        attachmentStorage,
        cloneRequests,
        {
          batchSize,
          maintenanceFence: 'api-collab-workers-stopped',
        },
      );
    }

    await db.transaction().execute(async (trx) => {
      for (const { page, content } of prepared) {
        if (content == null) {
          const update = await sql<{ id: string }>`
            update pages
            set ydoc = null, updated_at = now()
            where id = ${page.id}::uuid
              and content is null
            returning id::text as id
          `.execute(trx);
          if (update.rows.length !== 1) throw concurrentMutation(page.id);
          processed += 1;
          continue;
        }
        const ydoc = createYdoc(content);
        const textContent = toText(content);
        const originalContent = page.content;
        const update = await sql<{ id: string }>`
          update pages
          set
            content = ${content}::jsonb,
            ydoc = ${ydoc},
            text_content = ${textContent},
            updated_at = now()
          where id = ${page.id}::uuid
            and content is not distinct from ${originalContent}::jsonb
          returning id::text as id
        `.execute(trx);
        if (update.rows.length !== 1) throw concurrentMutation(page.id);
        processed += 1;
      }
    });
  }
  return processed;
}

async function cleanJsonSurface(
  db: Kysely<any>,
  definition: JsonSurfaceDefinition,
  policy: 'neutralize' | 'purge',
  batchSize: number,
): Promise<number> {
  if (policy === 'purge' && !definition.allowPurge) {
    throw new Error(`${definition.name} does not support purge`);
  }
  const table = sql.table(definition.table);
  const column = sql.ref(definition.column);
  let processed = 0;
  while (true) {
    const rows = await sql<{ id: string; value: unknown }>`
      select id::text as id, ${column} as value
      from ${table}
      where jsonb_path_exists(
        coalesce(${column}, 'null'::jsonb),
        ${PAGE_EMBED_PATH}::jsonpath
      )
      order by id
      limit ${batchSize}
    `.execute(db);
    if (rows.rows.length === 0) break;

    await db.transaction().execute(async (trx) => {
      for (const row of rows.rows) {
        if (policy === 'purge') {
          await sql`delete from ${table} where id = ${row.id}::uuid`.execute(
            trx,
          );
          processed += 1;
          continue;
        }
        const original = normalizeJsonValue(row.value);
        const neutralized = neutralizePageEmbeds(original);
        if (containsPageEmbed(neutralized)) {
          throw new Error(
            `${definition.name} ${opaqueId(row.id)} could not be neutralized`,
          );
        }
        const update = await sql<{ id: string }>`
          update ${table}
          set ${column} = ${neutralized}::jsonb
          where id = ${row.id}::uuid
            and ${column} is not distinct from ${original}::jsonb
          returning id::text as id
        `.execute(trx);
        if (update.rows.length !== 1) throw concurrentMutation(row.id);
        processed += 1;
      }
    });
  }
  return processed;
}

async function deleteLegacyReferences(
  db: Kysely<any>,
  batchSize: number,
): Promise<number> {
  let processed = 0;
  while (true) {
    const rows = await sql<{ id: string }>`
      select id::text as id
      from page_transclusion_references
      where reference_kind = 'page'
        or transclusion_id is null
        or reference_node_id is not null
      order by id
      limit ${batchSize}
    `.execute(db);
    if (rows.rows.length === 0) break;
    await db.transaction().execute(async (trx) => {
      for (const row of rows.rows) {
        await sql`
          delete from page_transclusion_references
          where id = ${row.id}::uuid
        `.execute(trx);
        processed += 1;
      }
    });
  }
  return processed;
}

async function deleteOrphanBlockReferences(
  db: Kysely<any>,
  batchSize: number,
): Promise<number> {
  let processed = 0;
  while (true) {
    const rows = await sql<{ id: string }>`
      select reference.id::text as id
      from page_transclusion_references as reference
      where reference.reference_kind = 'block'
        and not exists (
          select 1 from pages as source
          where source.id = reference.source_page_id
        )
      order by reference.id
      limit ${batchSize}
    `.execute(db);
    if (rows.rows.length === 0) break;
    await db.transaction().execute(async (trx) => {
      const ids = rows.rows.map((row) => row.id);
      const result = await sql<{ id: string }>`
        delete from page_transclusion_references as reference
        where reference.id in (${sql.join(ids)}::uuid)
          and reference.reference_kind = 'block'
          and not exists (
            select 1 from pages as source
            where source.id = reference.source_page_id
          )
        returning reference.id::text as id
      `.execute(trx);
      processed += result.rows.length;
    });
  }
  return processed;
}

async function writeRemovalLedger(
  db: Kysely<any>,
  batchSize: number,
): Promise<number> {
  await sql`
    create table if not exists page_embed_removal_ledger (
      page_id uuid primary key references pages(id) on delete cascade,
      content_hash varchar not null,
      ydoc_hash varchar,
      contract_version integer not null check (contract_version = 1),
      verified_at timestamptz not null default now()
    )
  `.execute(db);

  let processed = 0;
  let lastId: string | null = null;
  while (true) {
    const batch = await db.transaction().execute(async (trx) => {
      const rows = await sql<PageRow>`
        select
          id::text as "id",
          workspace_id::text as "workspaceId",
          space_id::text as "spaceId",
          parent_page_id::text as "parentPageId",
          deleted_at as "deletedAt",
          content,
          ydoc
        from pages
        where (${lastId}::uuid is null or id > ${lastId}::uuid)
        order by id
        limit ${batchSize}
        for update
      `.execute(trx);
      if (rows.rows.length === 0) return [];

      for (const rawPage of rows.rows) {
        const page = decodePageYdoc(rawPage);
        if (
          page.ydocDecodeError ||
          containsPageEmbed(page.content) ||
          containsPageEmbed(page.ydocContent)
        ) {
          throw new Error(
            `Page ${opaqueId(page.id)} changed after semantic verification; ledger was not updated`,
          );
        }
      }

      const ids = rows.rows.map((row) => row.id);
      const upsert = await sql<{ pageId: string }>`
        insert into page_embed_removal_ledger (
          page_id,
          content_hash,
          ydoc_hash,
          contract_version,
          verified_at
        )
        select
          page.id,
          md5(coalesce(page.content::text, '')),
          case
            when page.ydoc is null then null
            else md5(encode(page.ydoc, 'hex'))
          end,
          1,
          now()
        from pages as page
        where page.id in (${sql.join(ids)}::uuid)
        on conflict (page_id) do update set
          content_hash = excluded.content_hash,
          ydoc_hash = excluded.ydoc_hash,
          contract_version = excluded.contract_version,
          verified_at = excluded.verified_at
        returning page_id::text as "pageId"
      `.execute(trx);
      if (upsert.rows.length !== ids.length) {
        throw new Error('Page ledger update did not cover the locked batch');
      }
      return ids;
    });
    if (batch.length === 0) break;
    processed += batch.length;
    lastId = batch[batch.length - 1];
  }

  await sql`
    delete from page_embed_removal_ledger as ledger
    where not exists (
      select 1 from pages as page where page.id = ledger.page_id
    )
  `.execute(db);
  return processed;
}

function requiredPoliciesFor(
  surfaces: LegacySurfacePlan[],
  pageEmbeds: PageEmbedClassification,
  hasDecodeErrorWithContent: boolean,
  hasDecodeErrorWithoutContent: boolean,
): string[] {
  const count = (name: LegacySurfaceName) =>
    surfaces.find((surface) => surface.surface === name)?.count ?? 0;
  const required = new Set<string>();
  if (count('pages.content') > 0 || count('pages.ydoc') > 0) {
    required.add('--pages-policy=materialize-safe');
  }
  if (
    pageEmbeds.unsafeAudience + pageEmbeds.unsafeAttachmentOwnership >
    0
  ) {
    required.add('--unsafe-page-policy=neutralize');
  }
  if (hasDecodeErrorWithoutContent) {
    required.add('--ydoc-only-policy=clear');
  }
  if (hasDecodeErrorWithContent) {
    required.add('--ydoc-decode-policy=rebuild-from-content');
  }
  for (const definition of JSON_SURFACES) {
    if (count(definition.name) === 0) continue;
    required.add(
      `--${policyFlag(definition.policy)}=${
        definition.allowPurge ? 'neutralize|purge' : 'neutralize'
      }`,
    );
  }
  if (count('page_transclusion_references') > 0) {
    required.add('--reference-policy=delete-after-clean');
  }
  if (count('orphan_block_transclusion_references') > 0) {
    required.add('--orphan-reference-policy=delete-after-clean');
  }
  return [...required].sort();
}

function assertPolicies(
  plan: PageEmbedRemovalPlan,
  policies: PageEmbedRemovalPolicies,
): void {
  const count = (name: LegacySurfaceName) =>
    plan.surfaces.find((surface) => surface.surface === name)?.count ?? 0;
  if (
    (count('pages.content') > 0 || count('pages.ydoc') > 0) &&
    policies.pages !== 'materialize-safe'
  ) {
    throw new Error('--pages-policy=materialize-safe is required');
  }
  if (
    plan.pageEmbeds.unsafeAudience +
      plan.pageEmbeds.unsafeAttachmentOwnership >
      0 &&
    policies.unsafePages !== 'neutralize'
  ) {
    throw new Error('--unsafe-page-policy=neutralize is required');
  }
  if (
    plan.requiredPolicies.includes('--ydoc-only-policy=clear') &&
    policies.ydocOnly !== 'clear'
  ) {
    throw new Error('--ydoc-only-policy=clear is required');
  }
  if (
    plan.requiredPolicies.includes(
      '--ydoc-decode-policy=rebuild-from-content',
    ) && policies.ydocDecode !== 'rebuild-from-content'
  ) {
    throw new Error(
      '--ydoc-decode-policy=rebuild-from-content is required',
    );
  }
  for (const definition of JSON_SURFACES) {
    if (count(definition.name) === 0) continue;
    const policy = policies[definition.policy];
    if (
      policy !== 'neutralize' &&
      !(definition.allowPurge && policy === 'purge')
    ) {
      throw new Error(
        `--${policyFlag(definition.policy)}=${
          definition.allowPurge ? 'neutralize|purge' : 'neutralize'
        } is required`,
      );
    }
  }
  if (
    count('page_transclusion_references') > 0 &&
    policies.references !== 'delete-after-clean'
  ) {
    throw new Error('--reference-policy=delete-after-clean is required');
  }
  if (
    count('orphan_block_transclusion_references') > 0 &&
    policies.orphanReferences !== 'delete-after-clean'
  ) {
    throw new Error(
      '--orphan-reference-policy=delete-after-clean is required',
    );
  }
}

function hasCompatibleAudience(
  consumer: PageRow,
  source: PageRow,
  context: PageMaterializationContext,
): boolean {
  if (
    consumer.workspaceId !== source.workspaceId ||
    consumer.spaceId !== source.spaceId
  ) {
    return false;
  }
  const consumerAncestors = ancestryFor(consumer.id, context.pages);
  const sourceAncestors = ancestryFor(source.id, context.pages);
  if (!consumerAncestors || !sourceAncestors) return false;
  if (
    consumerAncestors.some((id) => context.accessRulePageIds.has(id)) ||
    sourceAncestors.some((id) => context.accessRulePageIds.has(id))
  ) {
    return false;
  }
  return !consumerAncestors.some((pageId, index) => {
    const shares = context.sharesByPageId.get(pageId) ?? [];
    return shares.some((includeSubPages) => index === 0 || includeSubPages);
  });
}

function planMaterializedAttachmentClones(
  consumer: PageRow,
  source: PageRow,
  context: PageMaterializationContext,
): {
  safe: boolean;
  requests: PageEmbedAttachmentCloneRequest[];
  attachmentIds: Map<string, string>;
} {
  const requests: PageEmbedAttachmentCloneRequest[] = [];
  const attachmentIds = new Map<string, string>();
  for (const attachmentId of collectAttachmentIds(
    source.authoritativeContent,
  )) {
    const attachment = context.attachments.get(attachmentId);
    if (!attachment || attachment.deletedAt) {
      return { safe: false, requests: [], attachmentIds: new Map() };
    }
    if (attachment.pageId === consumer.id) continue;
    if (attachment.pageId !== source.id) {
      return { safe: false, requests: [], attachmentIds: new Map() };
    }
    const cloneAttachmentId = pageEmbedAttachmentCloneId(
      consumer.id,
      attachmentId,
    );
    attachmentIds.set(attachmentId, cloneAttachmentId);
    requests.push({
      consumerPageId: consumer.id,
      sourcePageId: source.id,
      sourceAttachmentId: attachmentId,
    });
  }
  return { safe: true, requests, attachmentIds };
}

function ancestryFor(
  pageId: string,
  pages: ReadonlyMap<string, PageRow>,
): string[] | null {
  const result: string[] = [];
  const seen = new Set<string>();
  let currentId: string | null = pageId;
  while (currentId) {
    if (seen.has(currentId) || result.length >= MAX_ANCESTRY_DEPTH) return null;
    seen.add(currentId);
    result.push(currentId);
    const page = pages.get(currentId);
    if (!page) return null;
    currentId = page.parentPageId;
  }
  return result;
}

function cloneMaterializedDocument(
  document: JsonRecord,
  context: {
    consumerPageId: string;
    sourcePageId: string;
    referenceNodeId: string;
  },
): JsonRecord {
  const cloned = structuredClone(document);
  const transclusionIds = new Map<string, string>();
  let ordinal = 0;
  const nextId = () =>
    uuid5(
      `page-embed-removal:${context.consumerPageId}:${context.referenceNodeId}:${context.sourcePageId}:${ordinal++}`,
      MATERIALIZED_ID_NAMESPACE,
    );
  const structuralTypes = new Set([
    'paragraph',
    'heading',
    'transclusionSource',
    'pageEmbed',
  ]);
  const regenerate = (node: unknown): void => {
    if (!isRecord(node)) return;
    if (Array.isArray(node.marks)) {
      node.marks = node.marks.filter((mark: any) => mark?.type !== 'comment');
      if (node.marks.length === 0) delete node.marks;
    }
    if (structuralTypes.has(node.type)) {
      node.attrs = isRecord(node.attrs) ? node.attrs : {};
      const previousId = node.attrs.id;
      const id = nextId();
      node.attrs.id = id;
      if (node.type === 'transclusionSource' && typeof previousId === 'string') {
        transclusionIds.set(previousId, id);
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(regenerate);
  };
  const remap = (node: unknown): void => {
    if (!isRecord(node)) return;
    if (
      node.type === 'transclusionReference' &&
      node.attrs?.sourcePageId === context.sourcePageId
    ) {
      const id = transclusionIds.get(node.attrs.transclusionId);
      if (id) {
        node.attrs.sourcePageId = context.consumerPageId;
        node.attrs.transclusionId = id;
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(remap);
  };
  regenerate(cloned);
  remap(cloned);
  return cloned;
}

export function neutralizePageEmbeds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((child) => {
      const converted = neutralizePageEmbeds(child);
      return Array.isArray(converted) ? converted : [converted];
    });
  }
  if (!isRecord(value)) return value;
  if (value.type === 'pageEmbed') return historicalCallout();
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      neutralizePageEmbeds(child),
    ]),
  );
}

export function containsPageEmbed(value: unknown): boolean {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (!Array.isArray(current) && (current as JsonRecord).type === 'pageEmbed') {
      return true;
    }
    stack.push(...(Array.isArray(current) ? current : Object.values(current)));
  }
  return false;
}

function collectPageEmbedReferences(
  value: unknown,
): Array<{ sourcePageId: string }> {
  const result: Array<{ sourcePageId: string }> = [];
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (!Array.isArray(current) && (current as JsonRecord).type === 'pageEmbed') {
      const sourcePageId = (current as JsonRecord).attrs?.sourcePageId;
      if (typeof sourcePageId === 'string') result.push({ sourcePageId });
    }
    stack.push(...(Array.isArray(current) ? current : Object.values(current)));
  }
  return result;
}

function collectAttachmentIds(
  value: unknown,
  maxIds = Number.POSITIVE_INFINITY,
): Set<string> {
  const ids = new Set<string>();
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      for (const match of current.matchAll(
        /\/api\/(?:attachments\/files|files)\/(?:public\/)?([0-9a-f-]{36})\//gi,
      )) {
        ids.add(match[1]);
        if (ids.size >= maxIds) return ids;
      }
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    if (
      !Array.isArray(current) &&
      typeof (current as JsonRecord).attrs?.attachmentId === 'string'
    ) {
      ids.add((current as JsonRecord).attrs.attachmentId);
      if (ids.size >= maxIds) return ids;
    }
    stack.push(...(Array.isArray(current) ? current : Object.values(current)));
  }
  return ids;
}

function parseDocument(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;
  if (value.type === 'doc' && Array.isArray(value.content)) return value;
  return Array.isArray(value.content)
    ? { type: 'doc', content: value.content }
    : null;
}

function unavailableCallout(): JsonRecord {
  return callout(
    'Embedded page content was unavailable during legacy page migration.',
  );
}

function unsafeCallout(): JsonRecord {
  return callout(
    'Embedded page content was removed because its access or attachment ownership could not be preserved.',
  );
}

function historicalCallout(): JsonRecord {
  return callout(
    'Legacy embedded page content was neutralized during the pre-upgrade cleanup.',
  );
}

function callout(text: string): JsonRecord {
  return {
    type: 'callout',
    attrs: { type: 'info', icon: null },
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function emptyClassification(): PageEmbedClassification {
  return {
    materializable: 0,
    unavailable: 0,
    unsafeAudience: 0,
    unsafeAttachmentOwnership: 0,
    invalidSourceContent: 0,
  };
}

function addClassification(
  target: PageEmbedClassification,
  source: PageEmbedClassification,
): void {
  target.materializable += source.materializable;
  target.unavailable += source.unavailable;
  target.unsafeAudience += source.unsafeAudience;
  target.unsafeAttachmentOwnership += source.unsafeAttachmentOwnership;
  target.invalidSourceContent += source.invalidSourceContent;
}

function opaqueId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function normalizeBatchSize(value: number | undefined): number {
  const batchSize = value ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('batchSize must be an integer between 1 and 500');
  }
  return batchSize;
}

function normalizeContextPageLimit(
  value: number | undefined,
  batchSize: number,
): number {
  const limit = value ?? Math.max(DEFAULT_CONTEXT_PAGE_LIMIT, batchSize);
  if (
    !Number.isInteger(limit) ||
    limit < batchSize ||
    limit > MAX_CONTEXT_PAGE_LIMIT
  ) {
    throw new Error(
      `contextPageLimit must be an integer between batchSize (${batchSize}) and ${MAX_CONTEXT_PAGE_LIMIT}`,
    );
  }
  return limit;
}

function policyFlag(policy: keyof PageEmbedRemovalPolicies): string {
  const flags: Record<keyof PageEmbedRemovalPolicies, string> = {
    pages: 'pages-policy',
    unsafePages: 'unsafe-page-policy',
    ydocOnly: 'ydoc-only-policy',
    ydocDecode: 'ydoc-decode-policy',
    pageHistory: 'page-history-policy',
    pageTransclusions: 'page-transclusions-policy',
    templateRevisions: 'template-revisions-policy',
    stagedOperations: 'staged-operations-policy',
    databases: 'databases-policy',
    databaseCells: 'database-cells-policy',
    comments: 'comments-policy',
    references: 'reference-policy',
    orphanReferences: 'orphan-reference-policy',
  };
  return flags[policy];
}

function concurrentMutation(id: string): Error {
  return new Error(
    `Concurrent mutation detected for ${opaqueId(id)}; keep API, collaboration, and workers stopped and retry`,
  );
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
