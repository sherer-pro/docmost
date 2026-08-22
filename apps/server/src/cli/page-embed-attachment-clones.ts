import { createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { v5 as uuid5 } from 'uuid';
import { LOCAL_STORAGE_PATH } from '../common/helpers';
import { LocalDriver, S3Driver } from '../integrations/storage/drivers';
import {
  type S3StorageConfig,
  type StorageDriver,
  StorageOption,
} from '../integrations/storage/interfaces';

const ATTACHMENT_CLONE_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const ATTACHMENT_FILE_URL =
  /(\/api\/(?:attachments\/files|files)\/(?:public\/)?)([0-9a-f-]{36})(\/)/gi;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

type JsonRecord = Record<string, any>;

export interface PageEmbedAttachmentCloneRequest {
  consumerPageId: string;
  sourcePageId: string;
  sourceAttachmentId: string;
}

export interface PageEmbedAttachmentCloneStorage {
  copy(sourcePath: string, targetPath: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface PageEmbedAttachmentCloneReport {
  requested: number;
  completed: number;
  reused: number;
  recoveredCopies: number;
}

interface SourceAttachmentRow {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: string | number | null;
  fileExt: string;
  mimeType: string | null;
  type: string | null;
  creatorId: string;
  pageId: string;
  spaceId: string | null;
  workspaceId: string;
  textContent: string | null;
  contentIndexStatus: string | null;
  contentIndexError: string | null;
  contentIndexStartedAt: Date | string | null;
  contentIndexedAt: Date | string | null;
  contentIndexVersion: number | null;
  deletedAt: Date | string | null;
  sourcePageWorkspaceId: string;
  sourcePageSpaceId: string;
  sourcePageDeletedAt: Date | string | null;
}

interface ConsumerPageRow {
  id: string;
  workspaceId: string;
  spaceId: string;
}

interface PreparedClone {
  request: PageEmbedAttachmentCloneRequest;
  cloneAttachmentId: string;
  targetFilePath: string;
  sourceMetadataHash: string;
  source: SourceAttachmentRow;
  consumer: ConsumerPageRow;
}

interface CloneLedgerRow {
  cloneAttachmentId: string;
  consumerPageId: string;
  sourcePageId: string;
  sourceAttachmentId: string;
  workspaceId: string;
  spaceId: string;
  sourceFilePath: string;
  targetFilePath: string;
  sourceMetadataHash: string;
  status: 'pending' | 'copied' | 'completed' | 'cleanup_pending';
}

interface DestinationAttachmentRow {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: string | number | null;
  fileExt: string;
  mimeType: string | null;
  type: string | null;
  creatorId: string;
  pageId: string | null;
  spaceId: string | null;
  workspaceId: string;
  textContent: string | null;
  contentIndexStatus: string | null;
  contentIndexError: string | null;
  contentIndexStartedAt: Date | string | null;
  contentIndexedAt: Date | string | null;
  contentIndexVersion: number | null;
  deletedAt: Date | string | null;
}

class AttachmentCloneError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function pageEmbedAttachmentCloneId(
  consumerPageId: string,
  sourceAttachmentId: string,
): string {
  return uuid5(
    `docmost-page-embed-attachment:${consumerPageId}:${sourceAttachmentId}`,
    ATTACHMENT_CLONE_NAMESPACE,
  );
}

export function rewriteMaterializedAttachmentReferences(
  value: unknown,
  attachmentIds: ReadonlyMap<string, string>,
): unknown {
  const cloned = structuredClone(value);
  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    if (!isRecord(current)) return;

    if (isRecord(current.attrs)) {
      const sourceAttachmentId = current.attrs.attachmentId;
      if (typeof sourceAttachmentId === 'string') {
        const cloneAttachmentId = attachmentIds.get(sourceAttachmentId);
        if (cloneAttachmentId) {
          current.attrs.attachmentId = cloneAttachmentId;
        }
      }
      for (const key of ['src', 'url']) {
        if (typeof current.attrs[key] === 'string') {
          current.attrs[key] = rewriteAttachmentUrl(
            current.attrs[key],
            attachmentIds,
          );
        }
      }
    }

    Object.values(current).forEach(walk);
  };
  walk(cloned);
  return cloned;
}

/**
 * Apply-only schema bootstrap. The read-only plan must never call this helper.
 * T040 creates the same table defensively and drops it only after validating
 * that every durable clone reached `completed`.
 */
async function ensurePageEmbedAttachmentCloneLedger(
  database: Kysely<any>,
): Promise<void> {
  const db = database.withoutPlugins();
  await sql`
    create table if not exists page_embed_attachment_clone_ledger (
      clone_attachment_id uuid primary key,
      consumer_page_id uuid not null references pages(id) on delete restrict,
      source_page_id uuid not null references pages(id) on delete restrict,
      source_attachment_id uuid not null references attachments(id) on delete restrict,
      workspace_id uuid not null,
      space_id uuid not null,
      source_file_path varchar not null,
      target_file_path varchar not null unique,
      source_metadata_hash varchar not null,
      status varchar not null default 'pending' check (
        status in ('pending', 'copied', 'completed', 'cleanup_pending')
      ),
      attempt_count integer not null default 0,
      last_error_code varchar,
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (consumer_page_id, source_attachment_id)
    )
  `.execute(db);
  await sql`
    create index if not exists page_embed_attachment_clone_ledger_status_idx
      on page_embed_attachment_clone_ledger (status, clone_attachment_id)
      where status <> 'completed'
  `.execute(db);
}

export async function preparePageEmbedAttachmentClones(
  inputDb: Kysely<any>,
  storage: PageEmbedAttachmentCloneStorage,
  rawRequests: readonly PageEmbedAttachmentCloneRequest[],
  options: {
    batchSize?: number;
    maintenanceFence: 'api-collab-workers-stopped';
  },
): Promise<PageEmbedAttachmentCloneReport> {
  assertMaintenanceFence(options.maintenanceFence);
  const db = inputDb.withoutPlugins();
  const batchSize = normalizeBatchSize(options.batchSize);
  const requests = deduplicateRequests(rawRequests);
  const report: PageEmbedAttachmentCloneReport = {
    requested: requests.length,
    completed: 0,
    reused: 0,
    recoveredCopies: 0,
  };
  if (requests.length === 0) return report;

  await ensurePageEmbedAttachmentCloneLedger(db);
  for (const batch of chunks(requests, batchSize)) {
    const prepared = await loadPreparedClones(db, batch);
    for (const clone of prepared) {
      try {
        const outcome = await prepareClone(db, storage, clone);
        report.completed += 1;
        if (outcome.reused) report.reused += 1;
        if (outcome.recoveredCopy) report.recoveredCopies += 1;
      } catch (error) {
        const code =
          error instanceof AttachmentCloneError
            ? error.code
            : 'unexpected_clone_failure';
        await recordCloneFailure(db, clone.cloneAttachmentId, code);
        throw new Error(
          `pageEmbed attachment clone failed (${code}; clone ${opaqueId(clone.cloneAttachmentId)})`,
        );
      }
    }
  }
  return report;
}

export async function compensateIncompletePageEmbedAttachmentClone(
  inputDb: Kysely<any>,
  storage: PageEmbedAttachmentCloneStorage,
  cloneAttachmentId: string,
  options: { maintenanceFence: 'api-collab-workers-stopped' },
): Promise<boolean> {
  assertMaintenanceFence(options.maintenanceFence);
  const db = inputDb.withoutPlugins();
  const ledger = await loadLedger(db, cloneAttachmentId);
  if (!ledger) return false;
  if (ledger.status === 'completed') {
    throw new Error(
      'Completed pageEmbed attachment clones cannot be compensated',
    );
  }

  await sql`
    update page_embed_attachment_clone_ledger
    set status = 'cleanup_pending', updated_at = now()
    where clone_attachment_id = ${cloneAttachmentId}::uuid
      and status <> 'completed'
  `.execute(db);

  const destination = await loadDestination(db, cloneAttachmentId);
  if (destination && !matchesLedgerOwnership(destination, ledger)) {
    throw new Error('Refusing to compensate an inconsistent attachment clone');
  }

  if (await storage.exists(ledger.targetFilePath)) {
    try {
      await storage.delete(ledger.targetFilePath);
    } catch {
      await recordCloneFailure(db, cloneAttachmentId, 'storage_delete_failed');
      throw new Error(
        `pageEmbed attachment clone compensation failed (storage_delete_failed; clone ${opaqueId(cloneAttachmentId)})`,
      );
    }
  }

  await db.transaction().execute(async (trx) => {
    await sql`
      delete from attachments
      where id = ${cloneAttachmentId}::uuid
        and page_id = ${ledger.consumerPageId}::uuid
        and workspace_id = ${ledger.workspaceId}::uuid
        and space_id = ${ledger.spaceId}::uuid
        and file_path = ${ledger.targetFilePath}
    `.execute(trx);
    await sql`
      delete from page_embed_attachment_clone_ledger
      where clone_attachment_id = ${cloneAttachmentId}::uuid
        and status = 'cleanup_pending'
    `.execute(trx);
  });
  return true;
}

export function createPageEmbedAttachmentCloneStorageFromEnvironment(): {
  storage: PageEmbedAttachmentCloneStorage;
  close: () => Promise<void>;
} {
  const driverName = (process.env.STORAGE_DRIVER ?? StorageOption.LOCAL)
    .trim()
    .toLowerCase();
  let driver: StorageDriver;
  if (driverName === StorageOption.LOCAL) {
    driver = new LocalDriver({ storagePath: LOCAL_STORAGE_PATH });
  } else if (driverName === StorageOption.S3) {
    const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY?.trim();
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
      throw new Error(
        'AWS_S3_ACCESS_KEY_ID and AWS_S3_SECRET_ACCESS_KEY must be configured together',
      );
    }
    const config: S3StorageConfig = {
      region: requiredEnv('AWS_S3_REGION'),
      endpoint: process.env.AWS_S3_ENDPOINT?.trim() || undefined,
      bucket: requiredEnv('AWS_S3_BUCKET'),
      baseUrl: process.env.AWS_S3_URL?.trim() || undefined,
      forcePathStyle:
        (process.env.AWS_S3_FORCE_PATH_STYLE ?? 'false').toLowerCase() ===
        'true',
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    };
    driver = new S3Driver(config);
  } else {
    throw new Error(`Unsupported STORAGE_DRIVER: ${driverName}`);
  }

  return {
    storage: driver,
    close: async () => {
      const nativeDriver = driver.getDriver();
      if (
        nativeDriver &&
        typeof (nativeDriver as { destroy?: unknown }).destroy === 'function'
      ) {
        (nativeDriver as { destroy: () => void }).destroy();
      }
    },
  };
}

async function loadPreparedClones(
  db: Kysely<any>,
  requests: readonly PageEmbedAttachmentCloneRequest[],
): Promise<PreparedClone[]> {
  const sourceAttachmentIds = unique(
    requests.map((request) => request.sourceAttachmentId),
  );
  const consumerPageIds = unique(
    requests.map((request) => request.consumerPageId),
  );
  const sourceRows = await sql<SourceAttachmentRow>`
    select
      attachment.id::text as "id",
      attachment.file_name as "fileName",
      attachment.file_path as "filePath",
      attachment.file_size as "fileSize",
      attachment.file_ext as "fileExt",
      attachment.mime_type as "mimeType",
      attachment.type,
      attachment.creator_id::text as "creatorId",
      attachment.page_id::text as "pageId",
      attachment.space_id::text as "spaceId",
      attachment.workspace_id::text as "workspaceId",
      attachment.text_content as "textContent",
      attachment.content_index_status as "contentIndexStatus",
      attachment.content_index_error as "contentIndexError",
      attachment.content_index_started_at as "contentIndexStartedAt",
      attachment.content_indexed_at as "contentIndexedAt",
      attachment.content_index_version as "contentIndexVersion",
      attachment.deleted_at as "deletedAt",
      source.workspace_id::text as "sourcePageWorkspaceId",
      source.space_id::text as "sourcePageSpaceId",
      source.deleted_at as "sourcePageDeletedAt"
    from attachments as attachment
    join pages as source on source.id = attachment.page_id
    where attachment.id in (
      ${sql.join(sourceAttachmentIds.map((id) => sql`${id}::uuid`))}
    )
  `.execute(db);
  const consumers = await sql<ConsumerPageRow>`
    select
      id::text as "id",
      workspace_id::text as "workspaceId",
      space_id::text as "spaceId"
    from pages
    where id in (
      ${sql.join(consumerPageIds.map((id) => sql`${id}::uuid`))}
    )
  `.execute(db);
  const sourcesById = new Map(sourceRows.rows.map((row) => [row.id, row]));
  const consumersById = new Map(consumers.rows.map((row) => [row.id, row]));

  return requests.map((request) => {
    const source = sourcesById.get(request.sourceAttachmentId);
    const consumer = consumersById.get(request.consumerPageId);
    if (!source || source.deletedAt || source.sourcePageDeletedAt) {
      throw new AttachmentCloneError('source_attachment_unavailable');
    }
    if (!consumer) throw new AttachmentCloneError('consumer_page_unavailable');
    if (
      source.pageId !== request.sourcePageId ||
      source.sourcePageWorkspaceId !== source.workspaceId ||
      source.sourcePageSpaceId !== source.spaceId ||
      consumer.workspaceId !== source.workspaceId ||
      consumer.spaceId !== source.spaceId
    ) {
      throw new AttachmentCloneError('attachment_ownership_mismatch');
    }
    if (source.type !== 'file') {
      throw new AttachmentCloneError('unsupported_attachment_type');
    }
    assertSafeFileName(source.fileName);

    const cloneAttachmentId = pageEmbedAttachmentCloneId(
      consumer.id,
      source.id,
    );
    return {
      request,
      cloneAttachmentId,
      targetFilePath: `${consumer.workspaceId}/files/${cloneAttachmentId}/${source.fileName}`,
      sourceMetadataHash: metadataHash(source),
      source,
      consumer,
    };
  });
}

async function prepareClone(
  db: Kysely<any>,
  storage: PageEmbedAttachmentCloneStorage,
  clone: PreparedClone,
): Promise<{ reused: boolean; recoveredCopy: boolean }> {
  await sql`
    insert into page_embed_attachment_clone_ledger (
      clone_attachment_id,
      consumer_page_id,
      source_page_id,
      source_attachment_id,
      workspace_id,
      space_id,
      source_file_path,
      target_file_path,
      source_metadata_hash
    ) values (
      ${clone.cloneAttachmentId}::uuid,
      ${clone.consumer.id}::uuid,
      ${clone.request.sourcePageId}::uuid,
      ${clone.source.id}::uuid,
      ${clone.consumer.workspaceId}::uuid,
      ${clone.consumer.spaceId}::uuid,
      ${clone.source.filePath},
      ${clone.targetFilePath},
      ${clone.sourceMetadataHash}
    )
    on conflict (clone_attachment_id) do nothing
  `.execute(db);

  const ledger = await loadLedger(db, clone.cloneAttachmentId);
  if (!ledger || !matchesPreparedClone(ledger, clone)) {
    throw new AttachmentCloneError('clone_ledger_mismatch');
  }
  if (ledger.status === 'cleanup_pending') {
    throw new AttachmentCloneError('clone_cleanup_pending');
  }

  await sql`
    update page_embed_attachment_clone_ledger
    set
      attempt_count = attempt_count + 1,
      last_error_code = null,
      updated_at = now()
    where clone_attachment_id = ${clone.cloneAttachmentId}::uuid
  `.execute(db);

  const destination = await loadDestination(db, clone.cloneAttachmentId);
  if (destination && !matchesDestination(destination, clone)) {
    throw new AttachmentCloneError('destination_attachment_mismatch');
  }

  let targetExists: boolean;
  try {
    targetExists = await storage.exists(clone.targetFilePath);
  } catch {
    throw new AttachmentCloneError('target_storage_check_failed');
  }
  let recoveredCopy = targetExists && ledger.status !== 'completed';
  if (!targetExists) {
    let sourceExists: boolean;
    try {
      sourceExists = await storage.exists(clone.source.filePath);
    } catch {
      throw new AttachmentCloneError('source_storage_check_failed');
    }
    if (!sourceExists) {
      throw new AttachmentCloneError('source_storage_object_missing');
    }
    try {
      await storage.copy(clone.source.filePath, clone.targetFilePath);
      targetExists = await storage.exists(clone.targetFilePath);
    } catch {
      throw new AttachmentCloneError('storage_copy_failed');
    }
    if (!targetExists) {
      throw new AttachmentCloneError('storage_copy_not_visible');
    }
    recoveredCopy = ledger.status === 'copied' || ledger.status === 'completed';
  }

  if (ledger.status !== 'completed') {
    await sql`
      update page_embed_attachment_clone_ledger
      set status = 'copied', updated_at = now()
      where clone_attachment_id = ${clone.cloneAttachmentId}::uuid
        and status in ('pending', 'copied')
    `.execute(db);
  }

  await db.transaction().execute(async (trx) => {
    await sql`
      insert into attachments (
        id,
        file_name,
        file_path,
        file_size,
        file_ext,
        mime_type,
        type,
        creator_id,
        page_id,
        space_id,
        workspace_id,
        text_content,
        content_index_status,
        content_index_error,
        content_index_started_at,
        content_indexed_at,
        content_index_version
      )
      select
        ${clone.cloneAttachmentId}::uuid,
        source.file_name,
        ${clone.targetFilePath},
        source.file_size,
        source.file_ext,
        source.mime_type,
        source.type,
        source.creator_id,
        ${clone.consumer.id}::uuid,
        ${clone.consumer.spaceId}::uuid,
        ${clone.consumer.workspaceId}::uuid,
        source.text_content,
        source.content_index_status,
        source.content_index_error,
        source.content_index_started_at,
        source.content_indexed_at,
        source.content_index_version
      from attachments as source
      where source.id = ${clone.source.id}::uuid
        and source.page_id = ${clone.request.sourcePageId}::uuid
        and source.deleted_at is null
      on conflict (id) do nothing
    `.execute(trx);
    const inserted = await loadDestination(trx, clone.cloneAttachmentId);
    if (!inserted || !matchesDestination(inserted, clone)) {
      throw new AttachmentCloneError('destination_attachment_mismatch');
    }
    await sql`
      update page_embed_attachment_clone_ledger
      set
        status = 'completed',
        last_error_code = null,
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
      where clone_attachment_id = ${clone.cloneAttachmentId}::uuid
        and status in ('copied', 'completed')
    `.execute(trx);
  });

  return { reused: ledger.status === 'completed', recoveredCopy };
}

async function loadLedger(
  db: Kysely<any>,
  cloneAttachmentId: string,
): Promise<CloneLedgerRow | undefined> {
  const result = await sql<CloneLedgerRow>`
    select
      clone_attachment_id::text as "cloneAttachmentId",
      consumer_page_id::text as "consumerPageId",
      source_page_id::text as "sourcePageId",
      source_attachment_id::text as "sourceAttachmentId",
      workspace_id::text as "workspaceId",
      space_id::text as "spaceId",
      source_file_path as "sourceFilePath",
      target_file_path as "targetFilePath",
      source_metadata_hash as "sourceMetadataHash",
      status
    from page_embed_attachment_clone_ledger
    where clone_attachment_id = ${cloneAttachmentId}::uuid
  `.execute(db);
  return result.rows[0];
}

async function loadDestination(
  db: Kysely<any>,
  cloneAttachmentId: string,
): Promise<DestinationAttachmentRow | undefined> {
  const result = await sql<DestinationAttachmentRow>`
    select
      id::text as "id",
      file_name as "fileName",
      file_path as "filePath",
      file_size as "fileSize",
      file_ext as "fileExt",
      mime_type as "mimeType",
      type,
      creator_id::text as "creatorId",
      page_id::text as "pageId",
      space_id::text as "spaceId",
      workspace_id::text as "workspaceId",
      text_content as "textContent",
      content_index_status as "contentIndexStatus",
      content_index_error as "contentIndexError",
      content_index_started_at as "contentIndexStartedAt",
      content_indexed_at as "contentIndexedAt",
      content_index_version as "contentIndexVersion",
      deleted_at as "deletedAt"
    from attachments
    where id = ${cloneAttachmentId}::uuid
  `.execute(db);
  return result.rows[0];
}

async function recordCloneFailure(
  db: Kysely<any>,
  cloneAttachmentId: string,
  code: string,
): Promise<void> {
  try {
    await sql`
      update page_embed_attachment_clone_ledger
      set last_error_code = ${code}, updated_at = now()
      where clone_attachment_id = ${cloneAttachmentId}::uuid
    `.execute(db);
  } catch {
    // Preserve the original failure if PostgreSQL is also unavailable.
  }
}

function matchesPreparedClone(
  ledger: CloneLedgerRow,
  clone: PreparedClone,
): boolean {
  return (
    ledger.cloneAttachmentId === clone.cloneAttachmentId &&
    ledger.consumerPageId === clone.consumer.id &&
    ledger.sourcePageId === clone.request.sourcePageId &&
    ledger.sourceAttachmentId === clone.source.id &&
    ledger.workspaceId === clone.consumer.workspaceId &&
    ledger.spaceId === clone.consumer.spaceId &&
    ledger.sourceFilePath === clone.source.filePath &&
    ledger.targetFilePath === clone.targetFilePath &&
    ledger.sourceMetadataHash === clone.sourceMetadataHash
  );
}

function matchesDestination(
  destination: DestinationAttachmentRow,
  clone: PreparedClone,
): boolean {
  const source = clone.source;
  return (
    destination.id === clone.cloneAttachmentId &&
    destination.pageId === clone.consumer.id &&
    destination.spaceId === clone.consumer.spaceId &&
    destination.workspaceId === clone.consumer.workspaceId &&
    destination.filePath === clone.targetFilePath &&
    destination.fileName === source.fileName &&
    normalizeInt8(destination.fileSize) === normalizeInt8(source.fileSize) &&
    destination.fileExt === source.fileExt &&
    destination.mimeType === source.mimeType &&
    destination.type === source.type &&
    destination.creatorId === source.creatorId &&
    destination.textContent === source.textContent &&
    destination.contentIndexStatus === source.contentIndexStatus &&
    destination.contentIndexError === source.contentIndexError &&
    normalizeTimestamp(destination.contentIndexStartedAt) ===
      normalizeTimestamp(source.contentIndexStartedAt) &&
    normalizeTimestamp(destination.contentIndexedAt) ===
      normalizeTimestamp(source.contentIndexedAt) &&
    destination.contentIndexVersion === source.contentIndexVersion &&
    destination.deletedAt == null
  );
}

function matchesLedgerOwnership(
  destination: DestinationAttachmentRow,
  ledger: CloneLedgerRow,
): boolean {
  return (
    destination.id === ledger.cloneAttachmentId &&
    destination.pageId === ledger.consumerPageId &&
    destination.workspaceId === ledger.workspaceId &&
    destination.spaceId === ledger.spaceId &&
    destination.filePath === ledger.targetFilePath
  );
}

function metadataHash(source: SourceAttachmentRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: source.id,
        fileName: source.fileName,
        filePath: source.filePath,
        fileSize: normalizeInt8(source.fileSize),
        fileExt: source.fileExt,
        mimeType: source.mimeType,
        type: source.type,
        creatorId: source.creatorId,
        pageId: source.pageId,
        spaceId: source.spaceId,
        workspaceId: source.workspaceId,
        textContent: source.textContent,
        contentIndexStatus: source.contentIndexStatus,
        contentIndexError: source.contentIndexError,
        contentIndexStartedAt: normalizeTimestamp(source.contentIndexStartedAt),
        contentIndexedAt: normalizeTimestamp(source.contentIndexedAt),
        contentIndexVersion: source.contentIndexVersion,
      }),
    )
    .digest('hex');
}

function rewriteAttachmentUrl(
  value: string,
  attachmentIds: ReadonlyMap<string, string>,
): string {
  return value.replace(
    ATTACHMENT_FILE_URL,
    (match, prefix: string, attachmentId: string, suffix: string) => {
      const cloneAttachmentId = attachmentIds.get(attachmentId);
      return cloneAttachmentId
        ? `${prefix}${cloneAttachmentId}${suffix}`
        : match;
    },
  );
}

function deduplicateRequests(
  requests: readonly PageEmbedAttachmentCloneRequest[],
): PageEmbedAttachmentCloneRequest[] {
  const byCloneId = new Map<string, PageEmbedAttachmentCloneRequest>();
  for (const request of requests) {
    const cloneId = pageEmbedAttachmentCloneId(
      request.consumerPageId,
      request.sourceAttachmentId,
    );
    const existing = byCloneId.get(cloneId);
    if (existing && existing.sourcePageId !== request.sourcePageId) {
      throw new Error(
        'A source attachment cannot belong to multiple source pages',
      );
    }
    byCloneId.set(cloneId, request);
  }
  return [...byCloneId.values()].sort((left, right) =>
    pageEmbedAttachmentCloneId(
      left.consumerPageId,
      left.sourceAttachmentId,
    ).localeCompare(
      pageEmbedAttachmentCloneId(
        right.consumerPageId,
        right.sourceAttachmentId,
      ),
    ),
  );
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be between 1 and ${MAX_BATCH_SIZE}`);
  }
  return value;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeInt8(value: string | number | null): string | null {
  return value == null ? null : String(value);
}

function normalizeTimestamp(value: Date | string | null): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}

function assertSafeFileName(fileName: string): void {
  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('/') ||
    fileName.includes('\\')
  ) {
    throw new AttachmentCloneError('unsafe_attachment_file_name');
  }
}

function opaqueId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for S3 storage`);
  return value;
}

function assertMaintenanceFence(
  value: string,
): asserts value is 'api-collab-workers-stopped' {
  if (value !== 'api-collab-workers-stopped') {
    throw new Error(
      'PageEmbed attachment cloning requires the maintenance fence acknowledgement',
    );
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
