import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import type { RagScope, RagSyncSourceType } from '@docmost/api-contract';
import type { Space, Workspace } from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { StorageService } from '../../../integrations/storage/storage.service';
import {
  RagContentExportService,
  RagSystemContext,
} from '../../rag/rag-content-export.service';
import { OpenWebUiWriterService } from '../runtime/open-webui-writer.service';
import { RagSyncMemoryBudgetService } from '../runtime/rag-sync-memory-budget.service';
import { RagSyncStateStore } from '../runtime/rag-sync-state-store.service';
import {
  OpenWebUiFile,
  RagSyncDatabaseWorkProgress,
  RagSyncDocmostMetadataV2,
  RagSyncFeedKind,
  RagSyncFeedProgress,
  RagSyncQuantumContext,
  RagSyncQuantumProcessor,
  RagSyncQuantumResult,
  RagSyncRemoteScanPurpose,
  RagSyncRemoteOwnership,
  RagSyncRuntimeBinding,
  RagSyncRuntimeError,
  RagSyncSourceMapping,
  RagSyncUploadIntent,
} from '../runtime/rag-sync-runtime.types';

const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);
const CHECKPOINT_SETTLE_MS = 5_000;
const TARGET_TEST_TIMEOUT_MS = 120_000;

type SyncSource = {
  identity: string;
  sourceType: RagSyncSourceType;
  sourceId: string;
  pageId: string;
  databaseId?: string;
  updatedAtMs: number;
  fileName: string;
  mimeType: string;
  content: Uint8Array;
};

type QuantumSession = {
  binding: RagSyncRuntimeBinding;
  context: RagSyncQuantumContext;
  scope: RagSystemContext;
  ragScope: RagScope;
  processedCount: number;
  lagMs: number | null;
  retryAfterMs?: number;
  drainStartedAtMs?: number;
};

type FeedPage<T> = {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  maxUpdatedAtMs?: number;
  maxDeletedAtMs?: number;
};

type InternalRagUpdateItem = {
  type: 'page' | 'database';
  id: string;
  databaseId?: string;
  updatedAtMs: number;
};

type InternalRagDeletedItem = {
  type: 'page' | 'database' | 'databaseRow';
  id: string;
  rowId?: string;
  databaseId?: string;
};

type InternalRagAttachmentItem = {
  id: string;
  fileName: string;
  fileExt: string;
  mimeType: string | null;
  fileSize: number | string | null;
  pageId: string;
  updatedAtMs: number;
};

type InternalRagAttachmentDeletedItem = {
  id: string;
};

type InternalRagPageDetail = {
  id: string;
  title: string | null;
  contentMarkdown?: string | null;
};

type InternalRagDatabaseDetail = {
  id: string;
  databaseId: string;
  title: string;
  knowledgeMarkdown?: string | null;
};

type InternalRagDatabaseRowsPage = {
  items: Array<{
    id: string;
    pageId: string;
    updatedAt?: string | Date;
    pageTitle?: string | null;
    rowMarkdown?: string | null;
    cells?: Array<{ propertyId: string; value: unknown }>;
    page?: { title: string | null } | null;
  }>;
  hasMore: boolean;
  nextCursor: string | null;
};

@Injectable()
export class RagSyncSourceService implements RagSyncQuantumProcessor {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly rag: RagContentExportService,
    private readonly storage: StorageService,
    private readonly writer: OpenWebUiWriterService,
    private readonly state: RagSyncStateStore,
    private readonly memoryBudget: RagSyncMemoryBudgetService,
  ) {}

  async processQuantum(
    binding: RagSyncRuntimeBinding,
    context: RagSyncQuantumContext,
  ): Promise<RagSyncQuantumResult> {
    const scope = await this.loadSystemScope(binding);
    const ragScope = await this.rag.getScope(scope);
    const session: QuantumSession = {
      binding,
      context,
      scope,
      ragScope,
      processedCount: 0,
      lagMs: null,
    };

    if (binding.state === 'draining') {
      return this.drain(session);
    }

    const effectiveFingerprint = this.effectiveScopeFingerprint(
      ragScope,
      context.maxAttachmentBytes,
    );
    const storedFingerprint = await this.state.getScopeFingerprint(
      context.lease,
    );
    const scopeChanged = storedFingerprint !== effectiveFingerprint;
    if (scopeChanged) {
      const purged = await this.purgeBlockedSources(
        session,
        effectiveFingerprint,
      );
      if (purged.hasMore) return purged;
      for (const kind of ['updates', 'attachment-updates'] as const) {
        await this.state.setCheckpoint(context.lease, kind, 0);
        await this.state.setFeedProgress(context.lease, kind, null);
      }
      await this.state.clearDatabaseWorkProgress(context.lease);
      await this.state.setScopeFingerprint(context.lease, effectiveFingerprint);
      await this.state.setReconcileAt(context.lease, 0);
      await this.resetRemoteScan(session, 'reconcile');
    }

    const reconcileAt = await this.state.getReconcileAt(context.lease);
    if (scopeChanged || reconcileAt === null || reconcileAt <= Date.now()) {
      const reconciliationChanged = await this.reconcile(
        session,
        effectiveFingerprint,
      );
      if (reconciliationChanged) return this.result(session, true);
      await this.state.setReconcileAt(
        context.lease,
        Date.now() + context.reconcileIntervalMs,
      );
    }

    const limit = this.quantumLimit(session);
    const feeds: Array<() => Promise<RagSyncQuantumResult | null>> = [
      () =>
        this.processFeed<InternalRagDeletedItem>(
          session,
          'deleted',
          (since, cursor) =>
            this.rag.getDeleted(scope, since, {
              limit: 1,
              cursor,
            }) as unknown as Promise<FeedPage<InternalRagDeletedItem>>,
          (item) => this.processDeleted(session, item),
          'maxDeletedAtMs',
        ),
      () =>
        this.processFeed<InternalRagAttachmentDeletedItem>(
          session,
          'attachment-deleted',
          (since, cursor) =>
            this.rag.getAttachmentDeleted(scope, since, {
              limit,
              cursor,
            }) as unknown as Promise<
              FeedPage<InternalRagAttachmentDeletedItem>
            >,
          (item) => this.processAttachmentDeleted(session, item),
          'maxDeletedAtMs',
        ),
      () =>
        this.processFeed<InternalRagUpdateItem>(
          session,
          'updates',
          (since, cursor) =>
            this.rag.getUpdates(scope, since, {
              limit: 1,
              cursor,
            }) as unknown as Promise<FeedPage<InternalRagUpdateItem>>,
          (item) => this.processUpdate(session, item),
          'maxUpdatedAtMs',
        ),
      () =>
        this.processFeed<InternalRagAttachmentItem>(
          session,
          'attachment-updates',
          (since, cursor) =>
            this.rag.getAttachmentUpdates(scope, since, {
              limit,
              cursor,
            }) as unknown as Promise<FeedPage<InternalRagAttachmentItem>>,
          (item) => this.processAttachment(session, item),
          'maxUpdatedAtMs',
        ),
    ];
    for (const process of feeds) {
      const result = await process();
      if (result) return result;
    }
    return this.result(session, false);
  }

  private async loadSystemScope(
    binding: RagSyncRuntimeBinding,
  ): Promise<RagSystemContext> {
    const [workspace, space] = await Promise.all([
      this.db
        .selectFrom('workspaces')
        .selectAll()
        .where('id', '=', binding.workspaceId)
        .executeTakeFirst(),
      this.db
        .selectFrom('spaces')
        .selectAll()
        .where('id', '=', binding.spaceId)
        .where('workspaceId', '=', binding.workspaceId)
        .executeTakeFirst(),
    ]);
    if (!workspace || !space) {
      throw new RagSyncRuntimeError(
        'rag_sync_scope_unavailable',
        false,
        'RAG sync space is unavailable',
      );
    }
    return {
      accessMode: 'system',
      workspace: workspace as Workspace,
      space: space as Space,
    };
  }

  private async findLiveDatabaseRowIds(
    session: QuantumSession,
    databaseId: string,
    rowIds: string[],
  ): Promise<Set<string>> {
    if (rowIds.length === 0) return new Set();
    const rows = await this.db
      .selectFrom('databaseRows')
      .innerJoin('databases', 'databases.id', 'databaseRows.databaseId')
      .select('databaseRows.id as id')
      .where('databaseRows.workspaceId', '=', session.binding.workspaceId)
      .where('databases.workspaceId', '=', session.binding.workspaceId)
      .where('databases.spaceId', '=', session.binding.spaceId)
      .where('databaseRows.databaseId', '=', databaseId)
      .where('databaseRows.id', 'in', rowIds)
      .where('databaseRows.archivedAt', 'is', null)
      .execute();
    return new Set(rows.map((row) => row.id));
  }

  private async processFeed<T>(
    session: QuantumSession,
    kind: RagSyncFeedKind,
    load: (since: number, cursor?: string) => Promise<FeedPage<T>>,
    process: (item: T) => Promise<boolean>,
    checkpointField: 'maxUpdatedAtMs' | 'maxDeletedAtMs',
  ): Promise<RagSyncQuantumResult | null> {
    this.assertActive(session);
    const savedProgress = await this.state.getFeedProgress(
      session.context.lease,
      kind,
    );
    const baseCheckpoint =
      savedProgress?.baseCheckpoint ??
      (await this.state.getCheckpoint(session.context.lease, kind));
    const progress: RagSyncFeedProgress = savedProgress ?? {
      baseCheckpoint,
      cursor: null,
      maxSeen: baseCheckpoint,
    };
    const page = await load(baseCheckpoint, progress.cursor ?? undefined);
    this.assertFeedPage(page);
    const pageMax = Number(page[checkpointField] ?? baseCheckpoint);
    if (!Number.isSafeInteger(pageMax) || pageMax < baseCheckpoint) {
      throw new RagSyncRuntimeError('rag_sync_invalid_feed', false);
    }
    let pageCompleted = true;
    await runConcurrently(
      page.items,
      session.context.maxConcurrentDocuments,
      async (item) => {
        this.assertActive(session);
        if (!(await process(item))) pageCompleted = false;
        this.assertActive(session);
      },
    );
    if (!pageCompleted) return this.result(session, true);
    progress.maxSeen = Math.max(progress.maxSeen, pageMax);
    session.lagMs =
      progress.maxSeen > 0 ? Math.max(0, Date.now() - progress.maxSeen) : null;

    if (page.hasMore) {
      progress.cursor = page.nextCursor;
      await this.state.setFeedProgress(session.context.lease, kind, progress);
      return this.result(session, true);
    }

    const nextCheckpoint = settledCheckpoint(
      progress.baseCheckpoint,
      progress.maxSeen,
    );
    await this.state.setCheckpoint(session.context.lease, kind, nextCheckpoint);
    await this.state.setFeedProgress(session.context.lease, kind, null);
    return page.items.length > 0 ? this.result(session, true) : null;
  }

  private async processUpdate(
    session: QuantumSession,
    item: InternalRagUpdateItem,
  ): Promise<boolean> {
    if (item.type === 'page') {
      if (!this.consumeBudget(session)) return false;
      if (session.ragScope.excludedPageIds.includes(item.id)) {
        const identity = sourceIdentity('page', item.id);
        await this.deleteIdentity(session, identity);
        return this.requestUploadIntentCleanup(session, identity);
      }
      return this.memoryBudget.run(
        session.context.maxAttachmentBytes,
        session.context.signal,
        async () => {
          const page = (await this.rag.getPageInfo(
            session.scope,
            item.id,
            true,
          )) as unknown as InternalRagPageDetail;
          if (!page.title?.trim() && !page.contentMarkdown?.trim()) {
            const identity = sourceIdentity('page', page.id);
            await this.deleteIdentity(session, identity);
            return this.requestUploadIntentCleanup(session, identity);
          }
          return this.upsertSource(
            session,
            pageToSource(page, item.updatedAtMs),
            true,
          );
        },
      );
    }
    if (!item.databaseId) {
      throw new RagSyncRuntimeError('rag_sync_invalid_feed', false);
    }
    if (session.ragScope.excludedPageIds.includes(item.id)) {
      if (!(await this.deleteDatabase(session, item.id, item.databaseId))) {
        return false;
      }
      await this.replayUpdatesFeed(session);
      return this.requestUploadIntentCleanup(
        session,
        sourceIdentity('page', item.id),
      );
    }
    const database = (await this.rag.getDatabaseSyncMetadata(
      session.scope,
      item.databaseId,
    )) as unknown as InternalRagDatabaseDetail;
    return this.upsertDatabase(session, database, item.updatedAtMs);
  }

  private async upsertDatabase(
    session: QuantumSession,
    database: InternalRagDatabaseDetail,
    updatedAtMs: number,
  ): Promise<boolean> {
    const saved = await this.state.getDatabaseWorkProgress(
      session.context.lease,
      'upsert',
      database.databaseId,
    );
    const canResume = Boolean(
      saved?.operation === 'upsert' &&
        saved.pageId === database.id &&
        saved.sourceUpdatedAtMs === updatedAtMs,
    );
    if (!canResume) {
      await this.state.clearScanOverflow(
        session.context.lease,
        'mappings',
        `database-upsert:${database.databaseId}`,
      );
    }
    let progress: Extract<
      RagSyncDatabaseWorkProgress,
      { operation: 'upsert' }
    > =
      canResume && saved?.operation === 'upsert'
        ? saved
        : {
            operation: 'upsert',
            databaseId: database.databaseId,
            pageId: database.id,
            sourceUpdatedAtMs: updatedAtMs,
            phase: 'document',
            rowCursor: null,
            mappingCursor: '0',
            mappingChangedInPass: false,
          };

    if (progress.phase === 'document') {
      if (!this.consumeBudget(session)) return false;
      if (
        !(await this.upsertSource(session, {
          identity: sourceIdentity('page', database.id),
          sourceType: 'page',
          sourceId: database.id,
          pageId: database.id,
          databaseId: database.databaseId,
          updatedAtMs,
          fileName: safeFileName(database.title, database.id, '.md'),
          mimeType: 'text/markdown',
          content: encodeMarkdown(
            [`# ${database.title}`, database.knowledgeMarkdown || '']
              .filter(Boolean)
              .join('\n\n'),
          ),
        }))
      )
        return false;
      progress = {
        ...progress,
        phase: 'rows',
        rowCursor: null,
        mappingCursor: '0',
        mappingChangedInPass: false,
      };
      await this.state.setDatabaseWorkProgress(session.context.lease, progress);
    }

    if (progress.phase === 'rows') {
      const rowLimit = Math.min(100, this.remainingBudget(session));
      if (rowLimit === 0) return false;
      const rowPage = (await this.rag.getDatabaseSyncRowsPage(
        session.scope,
        database.databaseId,
        {
          limit: rowLimit,
          ...(progress.rowCursor ? { cursor: progress.rowCursor } : {}),
        },
      )) as unknown as InternalRagDatabaseRowsPage;
      this.assertDatabaseRowsPage(rowPage);
      for (const row of rowPage.items) {
        if (!this.consumeBudget(session)) return false;
        const title = row.page?.title || row.pageTitle || row.id;
        const cells = (row.cells ?? [])
          .map((cell) => `- ${cell.propertyId}: ${stringifyValue(cell.value)}`)
          .join('\n');
        if (
          !(await this.upsertSource(session, {
            identity: sourceIdentity('database_row', row.id),
            sourceType: 'database_row',
            sourceId: row.id,
            pageId: row.pageId,
            databaseId: database.databaseId,
            updatedAtMs: dateToMs(row.updatedAt, updatedAtMs),
            fileName: safeFileName(title, row.id, '.md'),
            mimeType: 'text/markdown',
            content: encodeMarkdown(
              [`# ${title}`, cells, row.rowMarkdown || '']
                .filter(Boolean)
                .join('\n\n'),
            ),
          }))
        )
          return false;
      }
      if (rowPage.hasMore) {
        progress = { ...progress, rowCursor: rowPage.nextCursor };
        await this.state.setDatabaseWorkProgress(
          session.context.lease,
          progress,
        );
        return false;
      }
      progress = {
        ...progress,
        phase: 'stale-rows',
        rowCursor: null,
        mappingCursor: '0',
        mappingChangedInPass: false,
      };
      await this.state.setDatabaseWorkProgress(session.context.lease, progress);
    }

    const mappingBudget = this.remainingBudget(session);
    if (mappingBudget === 0) return false;
    const scan = await this.state.scanMappings(
      session.context.lease,
      progress.mappingCursor,
      Math.max(1, mappingBudget),
      `database-upsert:${database.databaseId}`,
    );
    const batch = scan.items.filter(
      (mapping) =>
        mapping.sourceType === 'database_row' &&
        mapping.databaseId === database.databaseId,
    );
    const liveRowIds = await this.findLiveDatabaseRowIds(
      session,
      database.databaseId,
      batch.map((mapping) => mapping.sourceId),
    );
    let changedInPass = progress.mappingChangedInPass;
    for (const mapping of batch) {
      if (!this.consumeBudget(session)) return false;
      if (!liveRowIds.has(mapping.sourceId)) {
        await this.deleteIdentity(session, mapping.identity);
        changedInPass = true;
      }
    }
    if (scan.hasMore) {
      progress = {
        ...progress,
        mappingCursor: scan.cursor,
        mappingChangedInPass: changedInPass,
      };
      await this.state.setDatabaseWorkProgress(session.context.lease, progress);
      await this.ackScanBatch(
        session,
        'mappings',
        `database-upsert:${database.databaseId}`,
        scan.ackToken,
      );
      return false;
    }
    if (changedInPass) {
      progress = {
        ...progress,
        mappingCursor: '0',
        mappingChangedInPass: false,
      };
      await this.state.setDatabaseWorkProgress(session.context.lease, progress);
      await this.ackScanBatch(
        session,
        'mappings',
        `database-upsert:${database.databaseId}`,
        scan.ackToken,
      );
      return false;
    }

    await this.state.deleteDatabaseWorkProgress(
      session.context.lease,
      'upsert',
      database.databaseId,
    );
    await this.ackScanBatch(
      session,
      'mappings',
      `database-upsert:${database.databaseId}`,
      scan.ackToken,
    );
    return true;
  }

  private async processDeleted(
    session: QuantumSession,
    item: InternalRagDeletedItem,
  ): Promise<boolean> {
    if (item.type === 'database') {
      if (!item.databaseId) {
        throw new RagSyncRuntimeError('rag_sync_invalid_feed', false);
      }
      if (!(await this.deleteDatabase(session, item.id, item.databaseId))) {
        return false;
      }
      await this.replayUpdatesFeed(session);
      return this.requestUploadIntentCleanup(
        session,
        sourceIdentity('page', item.id),
      );
    }
    if (item.type === 'databaseRow') {
      if (!this.consumeBudget(session)) return false;
      if (item.rowId) {
        const identity = sourceIdentity('database_row', item.rowId);
        await this.deleteIdentity(session, identity);
        await this.replayUpdatesFeed(session);
        return this.requestUploadIntentCleanup(session, identity);
      }
      return true;
    }
    if (!this.consumeBudget(session)) return false;
    const identity = sourceIdentity('page', item.id);
    await this.deleteIdentity(session, identity);
    return this.requestUploadIntentCleanup(session, identity);
  }

  private async replayUpdatesFeed(session: QuantumSession): Promise<void> {
    await this.state.setCheckpoint(session.context.lease, 'updates', 0);
    await this.state.setFeedProgress(session.context.lease, 'updates', null);
  }

  private async deleteDatabase(
    session: QuantumSession,
    pageId: string,
    databaseId: string,
  ): Promise<boolean> {
    const saved = await this.state.getDatabaseWorkProgress(
      session.context.lease,
      'delete',
      databaseId,
    );
    let progress: Extract<
      RagSyncDatabaseWorkProgress,
      { operation: 'delete' }
    > =
      saved?.operation === 'delete' && saved.pageId === pageId
        ? saved
        : {
            operation: 'delete',
            databaseId,
            pageId,
            phase: 'document',
            mappingCursor: '0',
            mappingChangedInPass: false,
          };

    if (progress.phase === 'document') {
      if (!this.consumeBudget(session)) return false;
      await this.deleteIdentity(session, sourceIdentity('page', pageId));
      progress = {
        ...progress,
        phase: 'rows',
        mappingCursor: '0',
        mappingChangedInPass: false,
      };
      await this.state.setDatabaseWorkProgress(session.context.lease, progress);
    }

    const mappingBudget = this.remainingBudget(session);
    if (mappingBudget === 0) return false;
    const scan = await this.state.scanMappings(
      session.context.lease,
      progress.mappingCursor,
      Math.max(1, mappingBudget),
      `database-delete:${databaseId}`,
    );
    let changedInPass = progress.mappingChangedInPass;
    for (const mapping of scan.items.filter(
      (candidate) => candidate.databaseId === databaseId,
    )) {
      if (!this.consumeBudget(session)) return false;
      await this.deleteIdentity(session, mapping.identity);
      changedInPass = true;
    }
    if (scan.hasMore) {
      progress = {
        ...progress,
        mappingCursor: scan.cursor,
        mappingChangedInPass: changedInPass,
      };
      await this.state.setDatabaseWorkProgress(session.context.lease, progress);
      await this.ackScanBatch(
        session,
        'mappings',
        `database-delete:${databaseId}`,
        scan.ackToken,
      );
      return false;
    }
    if (changedInPass) {
      progress = {
        ...progress,
        mappingCursor: '0',
        mappingChangedInPass: false,
      };
      await this.state.setDatabaseWorkProgress(session.context.lease, progress);
      await this.ackScanBatch(
        session,
        'mappings',
        `database-delete:${databaseId}`,
        scan.ackToken,
      );
      return false;
    }

    await this.state.deleteDatabaseWorkProgress(
      session.context.lease,
      'delete',
      databaseId,
    );
    await this.ackScanBatch(
      session,
      'mappings',
      `database-delete:${databaseId}`,
      scan.ackToken,
    );
    return true;
  }

  private async processAttachmentDeleted(
    session: QuantumSession,
    item: InternalRagAttachmentDeletedItem,
  ): Promise<boolean> {
    if (!this.consumeBudget(session)) return false;
    const identity = sourceIdentity('attachment', item.id);
    await this.deleteIdentity(session, identity);
    return this.requestUploadIntentCleanup(session, identity);
  }

  private async processAttachment(
    session: QuantumSession,
    item: InternalRagAttachmentItem,
  ): Promise<boolean> {
    if (!this.consumeBudget(session)) return false;
    const extension = normalizeExtension(item.fileExt || item.fileName);
    const declaredSize = Number(item.fileSize);
    const identity = sourceIdentity('attachment', item.id);
    if (session.ragScope.excludedPageIds.includes(item.pageId)) {
      await this.deleteIdentity(session, identity);
      return this.requestUploadIntentCleanup(session, identity);
    }
    if (
      !SUPPORTED_ATTACHMENT_EXTENSIONS.has(extension) ||
      (Number.isFinite(declaredSize) &&
        declaredSize > session.context.maxAttachmentBytes)
    ) {
      await this.deleteIdentity(session, identity);
      return this.requestUploadIntentCleanup(session, identity);
    }
    return this.memoryBudget.run(
      session.context.maxAttachmentBytes,
      session.context.signal,
      async () => {
        const attachment = await this.rag.resolveAttachmentForDownload(
          session.scope,
          item.id,
        );
        const content = await this.readAttachmentBounded(
          attachment.filePath,
          session.context.maxAttachmentBytes,
          session.context.signal,
        );
        return this.upsertSource(
          session,
          {
            identity,
            sourceType: 'attachment',
            sourceId: item.id,
            pageId: item.pageId,
            updatedAtMs: item.updatedAtMs,
            fileName: safeFileName(item.fileName, item.id, extension),
            mimeType: item.mimeType || 'application/octet-stream',
            content,
          },
          true,
        );
      },
    );
  }

  private async upsertSource(
    session: QuantumSession,
    source: SyncSource,
    memoryReserved = false,
  ): Promise<boolean> {
    if (!memoryReserved) {
      return this.memoryBudget.run(
        source.content.byteLength,
        session.context.signal,
        () => this.upsertSource(session, source, true),
      );
    }
    this.assertActive(session);
    const contentHash = sha256(source.content);
    let existing = await this.state.getMapping(
      session.context.lease,
      source.identity,
    );
    if (
      existing?.contentHash === contentHash &&
      existing.sourceType === source.sourceType &&
      existing.sourceId === source.sourceId &&
      existing.pageId === source.pageId &&
      existing.databaseId === source.databaseId
    ) {
      const mapped = await this.writer.getFile(
        session.binding,
        existing.fileId,
        session.context.signal,
      );
      const ownership = mapped
        ? this.writer.readOwnership(mapped, session.binding)
        : null;
      if (
        ownership?.schemaVersion === 2 &&
        ownership.metadata.operationId === existing.operationId &&
        remoteSourceTuple(ownership.metadata) === sourceTuple(source)
      ) {
        await this.state.clearRemoteScanSeen(
          session.context.lease,
          this.intentScanPurpose(existing.operationId),
        );
        await this.state.deleteUploadIntent(
          session.context.lease,
          existing.operationId,
        );
        return true;
      }
      await this.state.deleteMapping(session.context.lease, source.identity);
      existing = null;
    }
    const operationId = sha256(
      new TextEncoder().encode(
        `${session.binding.id}\n${session.binding.targetVersion}\n${source.identity}\n${source.pageId}\n${source.databaseId ?? ''}\n${contentHash}`,
      ),
    );
    const metadata: RagSyncDocmostMetadataV2 = {
      schemaVersion: 2,
      bindingId: session.binding.id,
      targetVersion: session.binding.targetVersion,
      workspaceId: session.binding.workspaceId,
      spaceId: session.binding.spaceId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      pageId: source.pageId,
      ...(source.databaseId ? { databaseId: source.databaseId } : {}),
      sourceUpdatedAtMs: source.updatedAtMs,
      contentHash,
      operationId,
    };
    const intentScanPurpose = this.intentScanPurpose(operationId);

    let remote: OpenWebUiFile | undefined;
    const existingIntent = await this.state.getUploadIntent(
      session.context.lease,
      operationId,
    );
    if (existingIntent) {
      const now = await this.state.getTimeMs();
      if (now < existingIntent.notBefore) {
        session.retryAfterMs = Math.max(1, existingIntent.notBefore - now);
        return false;
      }
      const scanPage = existingIntent.scanPage ?? 1;
      if (scanPage === 1 && !existingIntent.scanDigest) {
        await this.state.clearRemoteScanSeen(
          session.context.lease,
          intentScanPurpose,
        );
      }
      const page = await this.writer.listKnowledgeFilesPage(
        session.binding,
        scanPage,
        session.context.signal,
      );
      if (
        existingIntent.scanExpectedTotal !== undefined &&
        existingIntent.scanExpectedTotal !== page.total
      ) {
        await this.state.clearRemoteScanSeen(
          session.context.lease,
          intentScanPurpose,
        );
        await this.state.setUploadIntent(session.context.lease, {
          ...existingIntent,
          notBefore: now + 5_000,
          scanPage: 1,
          scanPass: 1,
          scanExpectedTotal: undefined,
          scanDigest: undefined,
          firstPassDigest: undefined,
        });
        session.retryAfterMs = 5_000;
        return false;
      }
      const scanDigest = appendScanDigest(
        existingIntent.scanDigest,
        page.items.map((file) => file.id),
      );
      remote = this.writer.findOwnedFileByOperationId(
        page.items,
        session.binding,
        operationId,
      );
      if (remote) {
        await this.state.clearRemoteScanSeen(
          session.context.lease,
          intentScanPurpose,
        );
      }
      if (!remote) {
        await this.state.markRemoteScanFileIds(
          session.context.lease,
          intentScanPurpose,
          page.items.map((file) =>
            sha256(new TextEncoder().encode(file.id)).slice(0, 16),
          ),
        );
        if (page.hasMore) {
          await this.state.setUploadIntent(session.context.lease, {
            ...existingIntent,
            scanPage: scanPage + 1,
            scanPass: existingIntent.scanPass ?? 1,
            scanExpectedTotal: existingIntent.scanExpectedTotal ?? page.total,
            scanDigest,
            notBefore: now,
          });
          return false;
        }
        if ((existingIntent.scanPass ?? 1) === 1) {
          await this.state.clearRemoteScanSeen(
            session.context.lease,
            intentScanPurpose,
          );
          await this.state.setUploadIntent(session.context.lease, {
            ...existingIntent,
            scanPage: 1,
            scanPass: 2,
            scanExpectedTotal: page.total,
            scanDigest: undefined,
            firstPassDigest: scanDigest,
            notBefore: now + 5_000,
          });
          session.retryAfterMs = 5_000;
          return false;
        }
        if (existingIntent.firstPassDigest !== scanDigest) {
          await this.state.clearRemoteScanSeen(
            session.context.lease,
            intentScanPurpose,
          );
          await this.state.setUploadIntent(session.context.lease, {
            ...existingIntent,
            scanPage: 1,
            scanPass: 1,
            scanExpectedTotal: undefined,
            scanDigest: undefined,
            firstPassDigest: undefined,
            notBefore: now + 5_000,
          });
          session.retryAfterMs = 5_000;
          return false;
        }
        await this.state.clearRemoteScanSeen(
          session.context.lease,
          intentScanPurpose,
        );
        await this.state.deleteUploadIntent(session.context.lease, operationId);
      }
    }
    if (!remote) {
      const createdAt = await this.state.getTimeMs();
      await this.state.setUploadIntent(session.context.lease, {
        operationId,
        identity: source.identity,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        pageId: source.pageId,
        ...(source.databaseId ? { databaseId: source.databaseId } : {}),
        configVersion: session.binding.configVersion,
        createdAt,
        notBefore:
          createdAt +
          session.context.requestTimeoutMs +
          session.context.processingTimeoutMs,
        scanPage: 1,
        scanPass: 1,
      });
      remote = await this.writer.upload(
        session.binding,
        {
          fileName: source.fileName,
          mimeType: source.mimeType,
          content: source.content,
          metadata,
        },
        session.context.signal,
      );
      await this.writer.waitUntilProcessed(
        session.binding,
        remote.id,
        session.context.signal,
      );
    } else {
      await this.writer.waitUntilProcessed(
        session.binding,
        remote.id,
        session.context.signal,
      );
    }
    await this.state.setMapping(session.context.lease, {
      identity: source.identity,
      fileId: remote.id,
      operationId,
      contentHash,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      pageId: source.pageId,
      ...(source.databaseId ? { databaseId: source.databaseId } : {}),
      updatedAtMs: source.updatedAtMs,
    });
    await this.state.clearRemoteScanSeen(
      session.context.lease,
      intentScanPurpose,
    );
    await this.state.deleteUploadIntent(session.context.lease, operationId);
    if (existing && existing.fileId !== remote.id) {
      await this.deleteMappedFileIfOwned(session, existing);
    }
    return true;
  }

  private async deleteIdentity(
    session: QuantumSession,
    identity: string,
  ): Promise<void> {
    const existing = await this.state.getMapping(
      session.context.lease,
      identity,
    );
    if (!existing) return;
    await this.deleteMappedFileIfOwned(session, existing);
    await this.state.deleteMapping(session.context.lease, identity);
  }

  private async requestUploadIntentCleanup(
    session: QuantumSession,
    identity: string,
  ): Promise<boolean> {
    const identityHash = sha256(new TextEncoder().encode(identity));
    const purpose: RagSyncRemoteScanPurpose = {
      kind: 'deletion',
      identityHash,
    };
    let progress = await this.state.getRemoteScanProgress(
      session.context.lease,
      purpose,
      session.binding.configVersion,
    );
    if (!progress) {
      progress = {
        configVersion: session.binding.configVersion,
        phase: 'intents',
        page: 1,
        mappingCursor: '0',
        expectedTotal: 0,
        scopeFingerprint: null,
      };
    }
    const scan = await this.state.scanUploadIntents(
      session.context.lease,
      progress.mappingCursor,
      Math.max(1, this.remainingBudget(session)),
      `deletion:${identityHash}`,
    );
    let matched = progress.expectedTotal === 1;
    for (const intent of scan.items) {
      if (intent.identity !== identity) continue;
      await this.state.setUploadIntent(session.context.lease, {
        ...intent,
        cleanupRequested: true,
        scanPage: 1,
        scanPass: 1,
        scanExpectedTotal: undefined,
        scanDigest: undefined,
        firstPassDigest: undefined,
      });
      matched = true;
    }
    if (scan.hasMore) {
      await this.state.setRemoteScanProgress(session.context.lease, purpose, {
        ...progress,
        mappingCursor: scan.cursor,
        expectedTotal: matched ? 1 : 0,
      });
      await this.ackScanBatch(
        session,
        'upload-intents',
        `deletion:${identityHash}`,
        scan.ackToken,
      );
      return false;
    }
    await this.state.setRemoteScanProgress(
      session.context.lease,
      purpose,
      null,
    );
    if (matched) await this.state.setReconcileAt(session.context.lease, 0);
    await this.ackScanBatch(
      session,
      'upload-intents',
      `deletion:${identityHash}`,
      scan.ackToken,
    );
    return true;
  }

  private async deleteMappedFileIfOwned(
    session: QuantumSession,
    mapping: RagSyncSourceMapping,
  ): Promise<void> {
    const remote = await this.writer.getFile(
      session.binding,
      mapping.fileId,
      session.context.signal,
    );
    const ownership = remote
      ? this.writer.readOwnership(remote, session.binding)
      : null;
    if (
      !ownership ||
      sourceIdentity(
        ownership.metadata.sourceType,
        ownership.metadata.sourceId,
      ) !== mapping.identity ||
      ownership.metadata.contentHash !== mapping.contentHash ||
      (ownership.schemaVersion === 2 &&
        ownership.metadata.operationId !== mapping.operationId)
    ) {
      return;
    }
    await this.writer.deleteFile(
      session.binding,
      mapping.fileId,
      session.context.signal,
    );
  }

  private async purgeBlockedSources(
    session: QuantumSession,
    scopeFingerprint: string,
  ): Promise<RagSyncQuantumResult> {
    let progress = await this.state.getRemoteScanProgress(
      session.context.lease,
      'policy',
      session.binding.configVersion,
      scopeFingerprint,
    );
    if (!progress) {
      const now = await this.state.getTimeMs();
      progress = {
        configVersion: session.binding.configVersion,
        phase: 'mappings',
        page: 1,
        mappingCursor: '0',
        expectedTotal: 0,
        scopeFingerprint,
        barrierUntil:
          now +
          session.context.requestTimeoutMs +
          session.context.processingTimeoutMs,
        stablePasses: 0,
      };
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'policy',
        progress,
      );
    }
    const blocked = new Set(session.ragScope.excludedPageIds);
    if (progress.phase === 'mappings') {
      const scan = await this.state.scanMappings(
        session.context.lease,
        progress.mappingCursor,
        Math.max(1, this.remainingBudget(session)),
        'policy',
      );
      let deleted = false;
      for (const mapping of scan.items) {
        if (!blocked.has(mapping.pageId)) continue;
        if (!this.consumeBudget(session)) return this.result(session, true);
        await this.deleteIdentity(session, mapping.identity);
        deleted = true;
      }
      const changedInPass = progress.expectedTotal === 1 || deleted;
      if (scan.hasMore) {
        await this.state.setRemoteScanProgress(
          session.context.lease,
          'policy',
          {
            ...progress,
            mappingCursor: scan.cursor,
            expectedTotal: changedInPass ? 1 : 0,
          },
        );
        await this.ackScanBatch(session, 'mappings', 'policy', scan.ackToken);
        return this.result(session, true);
      }
      if (changedInPass) {
        await this.state.setRemoteScanProgress(
          session.context.lease,
          'policy',
          {
            ...progress,
            mappingCursor: '0',
            expectedTotal: 0,
          },
        );
        await this.ackScanBatch(session, 'mappings', 'policy', scan.ackToken);
        return this.result(session, true);
      }
      progress = {
        ...progress,
        phase: 'intents',
        mappingCursor: '0',
        expectedTotal: null,
      };
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'policy',
        progress,
      );
      await this.ackScanBatch(session, 'mappings', 'policy', scan.ackToken);
      return this.result(session, true);
    }

    if (progress.phase === 'intents') {
      const now = await this.state.getTimeMs();
      const scan = await this.state.scanUploadIntents(
        session.context.lease,
        progress.mappingCursor,
        Math.max(1, this.remainingBudget(session)),
        'policy',
      );
      let barrierUntil = progress.barrierUntil ?? now;
      const finalCleanup = progress.stablePasses === 2;
      let barrierExtended = finalCleanup && progress.expectedTotal === 1;
      for (const intent of scan.items) {
        if (!blocked.has(intent.pageId)) continue;
        barrierUntil = Math.max(barrierUntil, intent.notBefore);
        if (finalCleanup && intent.notBefore <= now) {
          await this.state.deleteUploadIntent(
            session.context.lease,
            intent.operationId,
          );
          continue;
        }
        if (finalCleanup) barrierExtended = true;
        await this.state.setUploadIntent(session.context.lease, {
          ...intent,
          cleanupRequested: true,
          scanPage: 1,
          scanPass: 1,
          scanExpectedTotal: undefined,
          scanDigest: undefined,
          firstPassDigest: undefined,
        });
      }
      if (scan.hasMore) {
        await this.state.setRemoteScanProgress(
          session.context.lease,
          'policy',
          {
            ...progress,
            mappingCursor: scan.cursor,
            barrierUntil,
            expectedTotal: barrierExtended ? 1 : 0,
          },
        );
        await this.ackScanBatch(
          session,
          'upload-intents',
          'policy',
          scan.ackToken,
        );
        return this.result(session, true);
      }
      if (finalCleanup && !barrierExtended) {
        await this.state.clearRemoteScanSeen(session.context.lease, 'policy');
        await this.state.setRemoteScanProgress(
          session.context.lease,
          'policy',
          null,
        );
        await this.ackScanBatch(
          session,
          'upload-intents',
          'policy',
          scan.ackToken,
        );
        return this.result(session, false);
      }
      progress = {
        ...progress,
        phase: 'files',
        page: 1,
        mappingCursor: '0',
        expectedTotal: null,
        barrierUntil,
        stablePasses: 0,
        scanDigest: undefined,
        firstPassDigest: undefined,
      };
      await this.state.clearRemoteScanSeen(session.context.lease, 'policy');
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'policy',
        progress,
      );
      await this.ackScanBatch(
        session,
        'upload-intents',
        'policy',
        scan.ackToken,
      );
      return this.result(session, true);
    }

    const now = await this.state.getTimeMs();
    const barrierUntil = progress.barrierUntil ?? now;
    if (now < barrierUntil) {
      session.retryAfterMs = Math.max(1, barrierUntil - now);
      return this.result(session, true);
    }
    const page = await this.writer.listKnowledgeFilesPage(
      session.binding,
      progress.page,
      session.context.signal,
    );
    if (
      progress.expectedTotal !== null &&
      progress.expectedTotal !== page.total
    ) {
      await this.state.clearRemoteScanSeen(session.context.lease, 'policy');
      await this.state.setRemoteScanProgress(session.context.lease, 'policy', {
        ...progress,
        page: 1,
        expectedTotal: null,
        stablePasses: 0,
        scanDigest: undefined,
        firstPassDigest: undefined,
      });
      return this.result(session, true);
    }
    if (progress.expectedTotal === null) {
      progress = { ...progress, expectedTotal: page.total };
    }
    await this.state.markRemoteScanFileIds(
      session.context.lease,
      'policy',
      page.items.map((file) =>
        sha256(new TextEncoder().encode(file.id)).slice(0, 16),
      ),
    );
    let remoteChanged = false;
    for (const file of page.items) {
      const ownership = this.writer.readOwnership(file, session.binding);
      if (!ownership || !blocked.has(ownership.metadata.pageId)) continue;
      if (!this.consumeBudget(session)) {
        await this.state.clearRemoteScanSeen(session.context.lease, 'policy');
        await this.state.setRemoteScanProgress(
          session.context.lease,
          'policy',
          {
            ...progress,
            expectedTotal: null,
            stablePasses: 0,
            scanDigest: undefined,
            firstPassDigest: undefined,
          },
        );
        return this.result(session, true);
      }
      await this.writer.deleteFile(
        session.binding,
        file.id,
        session.context.signal,
      );
      if (ownership.schemaVersion === 2) {
        await this.state.deleteUploadIntent(
          session.context.lease,
          ownership.metadata.operationId,
        );
      }
      remoteChanged = true;
    }
    if (remoteChanged) {
      await this.state.clearRemoteScanSeen(session.context.lease, 'policy');
      await this.state.setRemoteScanProgress(session.context.lease, 'policy', {
        ...progress,
        expectedTotal: null,
        stablePasses: 0,
        scanDigest: undefined,
        firstPassDigest: undefined,
      });
      return this.result(session, true);
    }
    const scanDigest = appendScanDigest(
      progress.scanDigest,
      page.items.map((file) => file.id),
    );
    if (page.hasMore) {
      await this.state.setRemoteScanProgress(session.context.lease, 'policy', {
        ...progress,
        page: progress.page + 1,
        scanDigest,
      });
      return this.result(session, true);
    }
    const firstPassDigest = progress.firstPassDigest;
    const stablePasses = progress.stablePasses ?? 0;
    if (stablePasses === 0 || firstPassDigest !== scanDigest) {
      await this.state.clearRemoteScanSeen(session.context.lease, 'policy');
      await this.state.setRemoteScanProgress(session.context.lease, 'policy', {
        ...progress,
        page: 1,
        expectedTotal: null,
        stablePasses: 1,
        scanDigest: undefined,
        firstPassDigest: scanDigest,
      });
      return this.result(session, true);
    }
    await this.state.clearRemoteScanSeen(session.context.lease, 'policy');
    await this.state.setRemoteScanProgress(session.context.lease, 'policy', {
      ...progress,
      phase: 'intents',
      page: 1,
      mappingCursor: '0',
      expectedTotal: null,
      stablePasses: 2,
      scanDigest: undefined,
    });
    return this.result(session, true);
  }

  private async findLiveRemoteSourceTuples(
    session: QuantumSession,
    ownerships: RagSyncRemoteOwnership[],
  ): Promise<Set<string>> {
    if (ownerships.length === 0) return new Set();
    const pageIds = new Set<string>();
    const databaseIds = new Set<string>();
    const rowIds = new Set<string>();
    const attachmentIds = new Set<string>();
    for (const { metadata } of ownerships) {
      if (metadata.sourceType === 'page') {
        pageIds.add(metadata.sourceId);
        if (metadata.databaseId) databaseIds.add(metadata.databaseId);
      } else if (metadata.sourceType === 'database_row') {
        rowIds.add(metadata.sourceId);
      } else {
        attachmentIds.add(metadata.sourceId);
      }
    }

    const [
      pages,
      databases,
      rows,
      attachments,
      activeDatabasePages,
      activeRowPages,
    ] = await Promise.all([
      pageIds.size === 0
        ? Promise.resolve([])
        : this.db
            .selectFrom('pages')
            .select('id')
            .where('workspaceId', '=', session.binding.workspaceId)
            .where('spaceId', '=', session.binding.spaceId)
            .where('deletedAt', 'is', null)
            .where('id', 'in', [...pageIds])
            .execute(),
      databaseIds.size === 0
        ? Promise.resolve([])
        : this.db
            .selectFrom('databases')
            .innerJoin(
              'pages as databasePages',
              'databasePages.id',
              'databases.pageId',
            )
            .select([
              'databases.id as databaseId',
              'databases.pageId as pageId',
            ])
            .where('databases.workspaceId', '=', session.binding.workspaceId)
            .where('databases.spaceId', '=', session.binding.spaceId)
            .where('databases.deletedAt', 'is', null)
            .where(
              'databasePages.workspaceId',
              '=',
              session.binding.workspaceId,
            )
            .where('databasePages.spaceId', '=', session.binding.spaceId)
            .where('databasePages.deletedAt', 'is', null)
            .where('databases.id', 'in', [...databaseIds])
            .execute(),
      rowIds.size === 0
        ? Promise.resolve([])
        : this.db
            .selectFrom('databaseRows')
            .innerJoin('databases', 'databases.id', 'databaseRows.databaseId')
            .innerJoin(
              'pages as rowPages',
              'rowPages.id',
              'databaseRows.pageId',
            )
            .select([
              'databaseRows.id as sourceId',
              'databaseRows.pageId as pageId',
              'databaseRows.databaseId as databaseId',
            ])
            .where('databaseRows.workspaceId', '=', session.binding.workspaceId)
            .where('databases.workspaceId', '=', session.binding.workspaceId)
            .where('databases.spaceId', '=', session.binding.spaceId)
            .where('databases.deletedAt', 'is', null)
            .where('rowPages.workspaceId', '=', session.binding.workspaceId)
            .where('rowPages.spaceId', '=', session.binding.spaceId)
            .where('rowPages.deletedAt', 'is', null)
            .where('databaseRows.archivedAt', 'is', null)
            .where('databaseRows.id', 'in', [...rowIds])
            .execute(),
      attachmentIds.size === 0
        ? Promise.resolve([])
        : this.db
            .selectFrom('attachments')
            .innerJoin(
              'pages as attachmentPages',
              'attachmentPages.id',
              'attachments.pageId',
            )
            .select([
              'attachments.id as sourceId',
              'attachments.pageId as pageId',
              'attachments.fileExt',
              'attachments.fileName',
              'attachments.fileSize',
            ])
            .where('attachments.workspaceId', '=', session.binding.workspaceId)
            .where('attachments.spaceId', '=', session.binding.spaceId)
            .where('attachments.deletedAt', 'is', null)
            .where(
              'attachmentPages.workspaceId',
              '=',
              session.binding.workspaceId,
            )
            .where('attachmentPages.spaceId', '=', session.binding.spaceId)
            .where('attachmentPages.deletedAt', 'is', null)
            .where('attachments.id', 'in', [...attachmentIds])
            .execute(),
      pageIds.size === 0
        ? Promise.resolve([])
        : this.db
            .selectFrom('databases')
            .innerJoin(
              'pages as databasePages',
              'databasePages.id',
              'databases.pageId',
            )
            .select('databases.pageId as pageId')
            .where('databases.workspaceId', '=', session.binding.workspaceId)
            .where('databases.spaceId', '=', session.binding.spaceId)
            .where('databases.deletedAt', 'is', null)
            .where(
              'databasePages.workspaceId',
              '=',
              session.binding.workspaceId,
            )
            .where('databasePages.spaceId', '=', session.binding.spaceId)
            .where('databasePages.deletedAt', 'is', null)
            .where('databases.pageId', 'in', [...pageIds])
            .execute(),
      pageIds.size === 0
        ? Promise.resolve([])
        : this.db
            .selectFrom('databaseRows')
            .innerJoin('databases', 'databases.id', 'databaseRows.databaseId')
            .innerJoin(
              'pages as rowPages',
              'rowPages.id',
              'databaseRows.pageId',
            )
            .select('databaseRows.pageId as pageId')
            .where('databaseRows.workspaceId', '=', session.binding.workspaceId)
            .where('databases.workspaceId', '=', session.binding.workspaceId)
            .where('databases.spaceId', '=', session.binding.spaceId)
            .where('databases.deletedAt', 'is', null)
            .where('databaseRows.archivedAt', 'is', null)
            .where('rowPages.workspaceId', '=', session.binding.workspaceId)
            .where('rowPages.spaceId', '=', session.binding.spaceId)
            .where('rowPages.deletedAt', 'is', null)
            .where('databaseRows.pageId', 'in', [...pageIds])
            .execute(),
    ]);
    const livePages = new Set(pages.map((page) => page.id));
    const liveDatabases = new Set(
      databases.map((database) => `${database.databaseId}:${database.pageId}`),
    );
    const liveRows = new Set(
      rows.map((row) => `${row.sourceId}:${row.pageId}:${row.databaseId}`),
    );
    const liveAttachments = new Set(
      attachments
        .filter((attachment) => {
          const extension = normalizeExtension(
            attachment.fileExt || attachment.fileName,
          );
          const size = Number(attachment.fileSize);
          return (
            SUPPORTED_ATTACHMENT_EXTENSIONS.has(extension) &&
            (!Number.isFinite(size) ||
              size <= session.context.maxAttachmentBytes)
          );
        })
        .map((attachment) => `${attachment.sourceId}:${attachment.pageId}`),
    );
    const databasePageIds = new Set(
      activeDatabasePages.map((database) => database.pageId),
    );
    const rowPageIds = new Set(activeRowPages.map((row) => row.pageId));
    const result = new Set<string>();
    for (const { metadata } of ownerships) {
      if (
        metadata.sourceType === 'page' &&
        metadata.pageId === metadata.sourceId &&
        livePages.has(metadata.sourceId) &&
        (metadata.databaseId
          ? liveDatabases.has(`${metadata.databaseId}:${metadata.pageId}`)
          : !databasePageIds.has(metadata.pageId) &&
            !rowPageIds.has(metadata.pageId))
      ) {
        result.add(remoteSourceTuple(metadata));
      } else if (
        metadata.sourceType === 'database_row' &&
        metadata.databaseId &&
        liveRows.has(
          `${metadata.sourceId}:${metadata.pageId}:${metadata.databaseId}`,
        )
      ) {
        result.add(remoteSourceTuple(metadata));
      } else if (
        metadata.sourceType === 'attachment' &&
        !metadata.databaseId &&
        liveAttachments.has(`${metadata.sourceId}:${metadata.pageId}`)
      ) {
        result.add(remoteSourceTuple(metadata));
      }
    }
    return result;
  }

  private async reconcile(
    session: QuantumSession,
    scopeFingerprint: string,
  ): Promise<boolean> {
    let progress = await this.state.getRemoteScanProgress(
      session.context.lease,
      'reconcile',
      session.binding.configVersion,
      scopeFingerprint,
    );
    if (!progress) {
      progress = {
        configVersion: session.binding.configVersion,
        phase: 'files',
        page: 1,
        mappingCursor: '0',
        expectedTotal: null,
        scopeFingerprint,
      };
      await this.state.clearRemoteScanSeen(session.context.lease, 'reconcile');
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'reconcile',
        progress,
      );
    }

    if (progress.phase === 'mappings') {
      return this.reconcileMappings(session, progress);
    }
    if (progress.phase === 'intents') {
      return this.reconcileCleanupIntents(session, progress);
    }

    const page = await this.writer.listKnowledgeFilesPage(
      session.binding,
      progress.page,
      session.context.signal,
    );
    if (
      progress.expectedTotal !== null &&
      progress.expectedTotal !== page.total
    ) {
      await this.resetRemoteScan(session, 'reconcile');
      return true;
    }
    if (progress.expectedTotal === null) {
      progress = { ...progress, expectedTotal: page.total };
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'reconcile',
        progress,
      );
    }
    const blockedPageIds = new Set(session.ragScope.excludedPageIds);
    const candidates = new Map<
      string,
      Array<{ file: OpenWebUiFile; metadata: RagSyncDocmostMetadataV2 }>
    >();
    const eligible: Array<{
      file: OpenWebUiFile;
      ownership: RagSyncRemoteOwnership;
    }> = [];
    const legacyFiles: Array<{
      file: OpenWebUiFile;
      feed: RagSyncFeedKind;
    }> = [];
    let remoteChanged = false;
    let stateChanged = false;
    for (const file of page.items) {
      const ownership = this.writer.readOwnership(file, session.binding);
      if (!ownership) continue;
      const isTargetTestMarker =
        ownership.schemaVersion === 2 &&
        ownership.metadata.marker === 'target-test';
      if (
        isTargetTestMarker &&
        ownership.metadata.sourceUpdatedAtMs >
          Date.now() - TARGET_TEST_TIMEOUT_MS - session.context.requestTimeoutMs
      ) {
        continue;
      }
      if (
        blockedPageIds.has(ownership.metadata.pageId) ||
        file.data?.status === 'failed' ||
        isTargetTestMarker
      ) {
        if (!this.consumeBudget(session)) return true;
        await this.writer.deleteFile(
          session.binding,
          file.id,
          session.context.signal,
        );
        if (ownership.schemaVersion === 2) {
          await this.state.deleteUploadIntent(
            session.context.lease,
            ownership.metadata.operationId,
          );
        }
        remoteChanged = true;
        continue;
      }
      eligible.push({ file, ownership });
    }

    const liveSourceTuples = await this.findLiveRemoteSourceTuples(
      session,
      eligible.map(({ ownership }) => ownership),
    );
    for (const { file, ownership } of eligible) {
      const identity = sourceIdentity(
        ownership.metadata.sourceType,
        ownership.metadata.sourceId,
      );
      if (ownership.schemaVersion === 2) {
        const intent = await this.state.getUploadIntent(
          session.context.lease,
          ownership.metadata.operationId,
        );
        if (intent?.cleanupRequested && intent.identity === identity) {
          if (!this.consumeBudget(session)) return true;
          await this.writer.deleteFile(
            session.binding,
            file.id,
            session.context.signal,
          );
          await this.state.deleteMapping(session.context.lease, identity);
          await this.state.deleteUploadIntent(
            session.context.lease,
            ownership.metadata.operationId,
          );
          remoteChanged = true;
          continue;
        }
      }
      if (!liveSourceTuples.has(remoteSourceTuple(ownership.metadata))) {
        if (!this.consumeBudget(session)) return true;
        await this.writer.deleteFile(
          session.binding,
          file.id,
          session.context.signal,
        );
        await this.state.deleteMapping(session.context.lease, identity);
        if (ownership.schemaVersion === 2) {
          await this.state.deleteUploadIntent(
            session.context.lease,
            ownership.metadata.operationId,
          );
        }
        remoteChanged = true;
        continue;
      }
      if (ownership.schemaVersion === 1) {
        legacyFiles.push({
          file,
          feed:
            ownership.metadata.sourceType === 'attachment'
              ? 'attachment-updates'
              : 'updates',
        });
        continue;
      }
      const group = candidates.get(identity) ?? [];
      group.push({ file, metadata: ownership.metadata });
      candidates.set(identity, group);
    }

    for (const { file, feed } of legacyFiles) {
      if (!this.consumeBudget(session)) return true;
      await this.writer.deleteFile(
        session.binding,
        file.id,
        session.context.signal,
      );
      await this.state.setCheckpoint(session.context.lease, feed, 0);
      await this.state.setFeedProgress(session.context.lease, feed, null);
      remoteChanged = true;
    }

    const candidateEntries = [...candidates.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    for (const [identity, group] of candidateEntries) {
      group.sort(
        (left, right) =>
          right.metadata.sourceUpdatedAtMs - left.metadata.sourceUpdatedAtMs ||
          right.file.id.localeCompare(left.file.id),
      );
      const [winner, ...duplicates] = group;
      const { file, metadata } = winner;
      const operationId = metadata.operationId;
      const desiredMapping: RagSyncSourceMapping = {
        identity,
        fileId: file.id,
        operationId,
        contentHash: metadata.contentHash,
        sourceType: metadata.sourceType,
        sourceId: metadata.sourceId,
        pageId: metadata.pageId,
        ...(metadata.databaseId ? { databaseId: metadata.databaseId } : {}),
        updatedAtMs: metadata.sourceUpdatedAtMs,
      };
      const existing = await this.state.getMapping(
        session.context.lease,
        identity,
      );
      if (!existing) {
        if (!this.consumeBudget(session)) return true;
        await this.state.setMapping(session.context.lease, desiredMapping);
        stateChanged = true;
      } else if (!sameMapping(existing, desiredMapping)) {
        const existingFile = await this.writer.getFile(
          session.binding,
          existing.fileId,
          session.context.signal,
        );
        const existingOwnership = existingFile
          ? this.writer.readOwnership(existingFile, session.binding)
          : null;
        const existingIsValid =
          existingOwnership?.schemaVersion === 2 &&
          existingOwnership.metadata.operationId === existing.operationId;
        const currentWins =
          !existingIsValid ||
          metadata.sourceUpdatedAtMs > existing.updatedAtMs ||
          (metadata.sourceUpdatedAtMs === existing.updatedAtMs &&
            file.id.localeCompare(existing.fileId) > 0);
        if (!this.consumeBudget(session)) return true;
        if (currentWins) {
          await this.deleteMappedFileIfOwned(session, existing);
          await this.state.setMapping(session.context.lease, desiredMapping);
        } else {
          await this.writer.deleteFile(
            session.binding,
            file.id,
            session.context.signal,
          );
        }
        remoteChanged = true;
      }
      await this.state.deleteUploadIntent(session.context.lease, operationId);
      for (const duplicate of duplicates) {
        if (!this.consumeBudget(session)) return true;
        await this.writer.deleteFile(
          session.binding,
          duplicate.file.id,
          session.context.signal,
        );
        await this.state.deleteUploadIntent(
          session.context.lease,
          duplicate.metadata.operationId,
        );
        remoteChanged = true;
      }
    }

    if (remoteChanged) {
      await this.resetRemoteScan(session, 'reconcile');
      return true;
    }
    if (stateChanged) return true;

    await this.state.markRemoteScanFileIds(
      session.context.lease,
      'reconcile',
      page.items.map((file) =>
        sha256(new TextEncoder().encode(file.id)).slice(0, 16),
      ),
    );
    if (page.hasMore) {
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'reconcile',
        { ...progress, page: progress.page + 1 },
      );
      return true;
    }
    await this.state.setRemoteScanProgress(session.context.lease, 'reconcile', {
      ...progress,
      phase: 'mappings',
      mappingCursor: '0',
    });
    return true;
  }

  private async reconcileMappings(
    session: QuantumSession,
    progress: {
      configVersion: number;
      phase: 'files' | 'mappings' | 'intents';
      page: number;
      mappingCursor: string;
      expectedTotal: number | null;
      scopeFingerprint: string | null;
    },
  ): Promise<boolean> {
    const scan = await this.state.scanMappings(
      session.context.lease,
      progress.mappingCursor,
      Math.max(1, this.remainingBudget(session)),
      'reconcile',
    );
    const feedsToReplay = new Set<RagSyncFeedKind>();
    for (const mapping of scan.items) {
      if (!this.consumeBudget(session)) return true;
      const seenInKnowledge = await this.state.wasRemoteScanFileIdSeen(
        session.context.lease,
        'reconcile',
        sha256(new TextEncoder().encode(mapping.fileId)).slice(0, 16),
      );
      const file = await this.writer.getFile(
        session.binding,
        mapping.fileId,
        session.context.signal,
      );
      const ownership = file
        ? this.writer.readOwnership(file, session.binding)
        : null;
      const exactOwnership = Boolean(
        ownership?.schemaVersion === 2 &&
          sourceIdentity(
            ownership.metadata.sourceType,
            ownership.metadata.sourceId,
          ) === mapping.identity &&
          ownership.metadata.contentHash === mapping.contentHash &&
          ownership.metadata.operationId === mapping.operationId,
      );
      if (!seenInKnowledge) {
        if (exactOwnership) {
          await this.writer.deleteFile(
            session.binding,
            mapping.fileId,
            session.context.signal,
          );
        }
        await this.state.deleteMapping(session.context.lease, mapping.identity);
        feedsToReplay.add(
          mapping.sourceType === 'attachment'
            ? 'attachment-updates'
            : 'updates',
        );
        continue;
      }
      if (exactOwnership) {
        await this.state.deleteUploadIntent(
          session.context.lease,
          mapping.operationId,
        );
        continue;
      }
      await this.state.deleteMapping(session.context.lease, mapping.identity);
      feedsToReplay.add(
        mapping.sourceType === 'attachment' ? 'attachment-updates' : 'updates',
      );
    }
    for (const kind of feedsToReplay) {
      await this.state.setCheckpoint(session.context.lease, kind, 0);
      await this.state.setFeedProgress(session.context.lease, kind, null);
    }
    if (scan.hasMore) {
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'reconcile',
        { ...progress, mappingCursor: scan.cursor },
      );
      await this.ackScanBatch(session, 'mappings', 'reconcile', scan.ackToken);
      return true;
    }
    await this.state.setRemoteScanProgress(session.context.lease, 'reconcile', {
      ...progress,
      phase: 'intents',
      mappingCursor: '0',
    });
    await this.ackScanBatch(session, 'mappings', 'reconcile', scan.ackToken);
    return true;
  }

  private async reconcileCleanupIntents(
    session: QuantumSession,
    progress: {
      configVersion: number;
      phase: 'files' | 'mappings' | 'intents';
      page: number;
      mappingCursor: string;
      expectedTotal: number | null;
      scopeFingerprint: string | null;
    },
  ): Promise<boolean> {
    const scan = await this.state.scanUploadIntents(
      session.context.lease,
      progress.mappingCursor,
      Math.max(1, this.remainingBudget(session)),
      'reconcile',
    );
    for (const intent of scan.items) {
      if (!intent.cleanupRequested) continue;
      if (!(await this.cleanupRequestedUploadIntent(session, intent))) {
        await this.state.setRemoteScanProgress(
          session.context.lease,
          'reconcile',
          progress,
        );
        return true;
      }
    }
    if (scan.hasMore) {
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'reconcile',
        { ...progress, mappingCursor: scan.cursor },
      );
      await this.ackScanBatch(
        session,
        'upload-intents',
        'reconcile',
        scan.ackToken,
      );
      return true;
    }
    await this.state.setRemoteScanProgress(
      session.context.lease,
      'reconcile',
      null,
    );
    await this.state.clearRemoteScanSeen(session.context.lease, 'reconcile');
    await this.ackScanBatch(
      session,
      'upload-intents',
      'reconcile',
      scan.ackToken,
    );
    return false;
  }

  private async cleanupRequestedUploadIntent(
    session: QuantumSession,
    intent: RagSyncUploadIntent,
  ): Promise<boolean> {
    const now = await this.state.getTimeMs();
    if (now < intent.notBefore) {
      session.retryAfterMs = Math.max(1, intent.notBefore - now);
      return false;
    }
    const scanPage = intent.scanPage ?? 1;
    const scanPurpose = this.intentScanPurpose(intent.operationId);
    if (scanPage === 1 && !intent.scanDigest) {
      await this.state.clearRemoteScanSeen(session.context.lease, scanPurpose);
    }
    const page = await this.writer.listKnowledgeFilesPage(
      session.binding,
      scanPage,
      session.context.signal,
    );
    if (
      intent.scanExpectedTotal !== undefined &&
      intent.scanExpectedTotal !== page.total
    ) {
      await this.state.clearRemoteScanSeen(session.context.lease, scanPurpose);
      await this.state.setUploadIntent(session.context.lease, {
        ...intent,
        notBefore: now + 5_000,
        scanPage: 1,
        scanPass: 1,
        scanExpectedTotal: undefined,
        scanDigest: undefined,
        firstPassDigest: undefined,
      });
      session.retryAfterMs = 5_000;
      return false;
    }
    const scanDigest = appendScanDigest(
      intent.scanDigest,
      page.items.map((file) => file.id),
    );
    const remote = this.writer.findOwnedFileByOperationId(
      page.items,
      session.binding,
      intent.operationId,
    );
    if (remote) {
      if (!this.consumeBudget(session)) return false;
      await this.writer.deleteFile(
        session.binding,
        remote.id,
        session.context.signal,
      );
      await this.state.deleteMapping(session.context.lease, intent.identity);
      await this.state.deleteUploadIntent(
        session.context.lease,
        intent.operationId,
      );
      return true;
    }
    await this.state.markRemoteScanFileIds(
      session.context.lease,
      scanPurpose,
      page.items.map((file) =>
        sha256(new TextEncoder().encode(file.id)).slice(0, 16),
      ),
    );
    if (page.hasMore) {
      await this.state.setUploadIntent(session.context.lease, {
        ...intent,
        scanPage: scanPage + 1,
        scanPass: intent.scanPass ?? 1,
        scanExpectedTotal: intent.scanExpectedTotal ?? page.total,
        scanDigest,
        notBefore: now,
      });
      return false;
    }
    if ((intent.scanPass ?? 1) === 1) {
      await this.state.clearRemoteScanSeen(session.context.lease, scanPurpose);
      await this.state.setUploadIntent(session.context.lease, {
        ...intent,
        scanPage: 1,
        scanPass: 2,
        scanExpectedTotal: page.total,
        scanDigest: undefined,
        firstPassDigest: scanDigest,
        notBefore: now + 5_000,
      });
      session.retryAfterMs = 5_000;
      return false;
    }
    if (intent.firstPassDigest !== scanDigest) {
      await this.state.clearRemoteScanSeen(session.context.lease, scanPurpose);
      await this.state.setUploadIntent(session.context.lease, {
        ...intent,
        scanPage: 1,
        scanPass: 1,
        scanExpectedTotal: undefined,
        scanDigest: undefined,
        firstPassDigest: undefined,
        notBefore: now + 5_000,
      });
      session.retryAfterMs = 5_000;
      return false;
    }
    await this.state.deleteUploadIntent(
      session.context.lease,
      intent.operationId,
    );
    return true;
  }

  private async drain(session: QuantumSession): Promise<RagSyncQuantumResult> {
    let drainStartedAt = await this.state.getDrainStartedAt(
      session.context.lease,
      session.binding.configVersion,
    );
    if (drainStartedAt === null) {
      drainStartedAt = await this.state.getTimeMs();
      await this.state.setDrainStartedAt(
        session.context.lease,
        session.binding.configVersion,
        drainStartedAt,
      );
    }
    session.drainStartedAtMs = drainStartedAt;
    let progress = await this.state.getRemoteScanProgress(
      session.context.lease,
      'drain',
      session.binding.configVersion,
    );
    if (!progress) {
      progress = {
        configVersion: session.binding.configVersion,
        phase: 'files',
        page: 1,
        mappingCursor: '0',
        expectedTotal: null,
        scopeFingerprint: null,
      };
      await this.state.clearRemoteScanSeen(session.context.lease, 'drain');
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'drain',
        progress,
      );
    }
    if (progress.phase === 'mappings') {
      return this.drainUploadIntents(session, progress);
    }
    const page = await this.writer.listKnowledgeFilesPage(
      session.binding,
      progress.page,
      session.context.signal,
    );
    if (
      progress.expectedTotal !== null &&
      progress.expectedTotal !== page.total
    ) {
      await this.resetRemoteScan(session, 'drain');
      return this.result(session, true);
    }
    if (progress.expectedTotal === null) {
      progress = { ...progress, expectedTotal: page.total };
      await this.state.setRemoteScanProgress(
        session.context.lease,
        'drain',
        progress,
      );
    }
    const owned = page.items.filter((file) =>
      this.writer.readOwnership(file, session.binding),
    );
    const batch = owned.slice(0, this.remainingBudget(session));
    await runConcurrently(
      batch,
      session.context.maxConcurrentDocuments,
      async (file) => {
        if (!this.consumeBudget(session)) return;
        const ownership = this.writer.readOwnership(file, session.binding);
        await this.writer.deleteFile(
          session.binding,
          file.id,
          session.context.signal,
        );
        if (
          ownership?.schemaVersion === 2 &&
          /^[0-9a-f]{64}$/.test(ownership.metadata.operationId)
        ) {
          await this.state.deleteUploadIntent(
            session.context.lease,
            ownership.metadata.operationId,
          );
        }
      },
    );
    if (owned.length > 0) {
      await this.state.setDrainEmptyObservedAt(
        session.context.lease,
        session.binding.configVersion,
        null,
      );
      await this.state.setRemoteScanProgress(session.context.lease, 'drain', {
        ...progress,
        expectedTotal: null,
      });
      return this.result(session, true);
    }

    await this.state.markRemoteScanFileIds(
      session.context.lease,
      'drain',
      page.items.map((file) =>
        sha256(new TextEncoder().encode(file.id)).slice(0, 16),
      ),
    );
    if (page.hasMore) {
      await this.state.setRemoteScanProgress(session.context.lease, 'drain', {
        ...progress,
        page: progress.page + 1,
      });
      return this.result(session, true);
    }
    await this.state.setRemoteScanProgress(session.context.lease, 'drain', {
      ...progress,
      phase: 'mappings',
      mappingCursor: '0',
    });
    return this.result(session, true);
  }

  private async drainUploadIntents(
    session: QuantumSession,
    progress: {
      configVersion: number;
      phase: 'files' | 'mappings' | 'intents';
      page: number;
      mappingCursor: string;
      expectedTotal: number | null;
      scopeFingerprint: string | null;
    },
  ): Promise<RagSyncQuantumResult> {
    const scan = await this.state.scanUploadIntents(
      session.context.lease,
      progress.mappingCursor,
      Math.max(1, this.remainingBudget(session)),
      'drain',
    );
    const now = await this.state.getTimeMs();
    if (scan.items.length > 0) {
      await this.state.setDrainEmptyObservedAt(
        session.context.lease,
        session.binding.configVersion,
        null,
      );
    }
    let deleted = false;
    let pending = false;
    for (const intent of scan.items) {
      if (intent.notBefore > now) {
        pending = true;
        continue;
      }
      if (!this.consumeBudget(session)) return this.result(session, true);
      await this.state.deleteUploadIntent(
        session.context.lease,
        intent.operationId,
      );
      deleted = true;
    }
    if (deleted || pending) {
      await this.resetRemoteScan(session, 'drain');
      return this.result(session, deleted);
    }
    if (scan.hasMore) {
      await this.state.setRemoteScanProgress(session.context.lease, 'drain', {
        ...progress,
        mappingCursor: scan.cursor,
      });
      await this.ackScanBatch(
        session,
        'upload-intents',
        'drain',
        scan.ackToken,
      );
      return this.result(session, true);
    }
    if (
      now <
      session.drainStartedAtMs! +
        session.context.requestTimeoutMs +
        session.context.processingTimeoutMs
    ) {
      await this.state.setDrainEmptyObservedAt(
        session.context.lease,
        session.binding.configVersion,
        null,
      );
      await this.resetRemoteScan(session, 'drain');
      return this.result(session, false);
    }
    const emptyObservedAt = await this.state.getDrainEmptyObservedAt(
      session.context.lease,
      session.binding.configVersion,
    );
    if (emptyObservedAt === null) {
      await this.state.setDrainEmptyObservedAt(
        session.context.lease,
        session.binding.configVersion,
        now,
      );
      await this.resetRemoteScan(session, 'drain');
      return this.result(session, false);
    }
    const quietPeriodMs = Math.max(
      5_000,
      Math.min(30_000, session.context.pollIntervalMs),
    );
    if (now - emptyObservedAt < quietPeriodMs) {
      await this.resetRemoteScan(session, 'drain');
      return this.result(session, false);
    }
    await this.state.clearTargetState(session.context.lease);
    return { ...this.result(session, false), drained: true };
  }

  private async resetRemoteScan(
    session: QuantumSession,
    purpose: RagSyncRemoteScanPurpose,
  ): Promise<void> {
    if (purpose === 'policy' || purpose === 'reconcile') {
      await this.state.clearScanOverflow(
        session.context.lease,
        'mappings',
        purpose,
      );
    }
    if (
      purpose === 'policy' ||
      purpose === 'reconcile' ||
      purpose === 'drain'
    ) {
      await this.state.clearScanOverflow(
        session.context.lease,
        'upload-intents',
        purpose,
      );
    }
    if (typeof purpose !== 'string' && purpose.kind === 'deletion') {
      await this.state.clearScanOverflow(
        session.context.lease,
        'upload-intents',
        `deletion:${purpose.identityHash}`,
      );
    }
    await this.state.setRemoteScanProgress(
      session.context.lease,
      purpose,
      null,
    );
    await this.state.clearRemoteScanSeen(session.context.lease, purpose);
  }

  private async ackScanBatch(
    session: QuantumSession,
    kind: 'mappings' | 'upload-intents',
    scanId: string,
    ackToken: string | null,
  ): Promise<void> {
    if (!ackToken) return;
    await this.state.ackScanBatch(
      session.context.lease,
      kind,
      scanId,
      ackToken,
    );
  }

  private intentScanPurpose(operationId: string): RagSyncRemoteScanPurpose {
    return { kind: 'intent', operationId };
  }

  private async readAttachmentBounded(
    filePath: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const stream = await this.storage.readStream(filePath, signal);
    const chunks: Buffer[] = [];
    let size = 0;
    const onAbort = () => stream.destroy();
    if (signal.aborted) {
      onAbort();
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      for await (const chunk of stream) {
        if (signal.aborted) {
          throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxBytes) {
          throw new RagSyncRuntimeError('rag_sync_source_too_large', false);
        }
        chunks.push(buffer);
      }
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      return new Uint8Array(Buffer.concat(chunks, size));
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      stream.destroy();
    }
  }

  private assertFeedPage<T>(page: FeedPage<T>): void {
    if (page.hasMore && !page.nextCursor) {
      throw new RagSyncRuntimeError('rag_sync_invalid_feed', false);
    }
  }

  private assertDatabaseRowsPage(page: InternalRagDatabaseRowsPage): void {
    if (
      !Array.isArray(page.items) ||
      typeof page.hasMore !== 'boolean' ||
      (page.nextCursor !== null && typeof page.nextCursor !== 'string') ||
      (page.hasMore && !page.nextCursor)
    ) {
      throw new RagSyncRuntimeError('rag_sync_invalid_feed', false);
    }
  }

  private assertActive(session: QuantumSession): void {
    if (session.context.signal.aborted) {
      throw (
        session.context.signal.reason ??
        new DOMException('Aborted', 'AbortError')
      );
    }
  }

  private quantumLimit(session: QuantumSession): number {
    return Math.min(100, Math.max(1, session.context.maxItems));
  }

  private remainingBudget(session: QuantumSession): number {
    return Math.max(0, this.quantumLimit(session) - session.processedCount);
  }

  private consumeBudget(session: QuantumSession): boolean {
    this.assertActive(session);
    if (this.remainingBudget(session) === 0) return false;
    session.processedCount += 1;
    return true;
  }

  private effectiveScopeFingerprint(
    scope: RagScope,
    maxAttachmentBytes: number,
  ): string {
    return sha256(
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 2,
          serverScopeFingerprint: scope.fingerprint,
          maxAttachmentBytes,
          supportedAttachmentExtensions: [
            ...SUPPORTED_ATTACHMENT_EXTENSIONS,
          ].sort(),
        }),
      ),
    );
  }

  private result(
    session: QuantumSession,
    hasMore: boolean,
  ): RagSyncQuantumResult {
    return {
      hasMore,
      lagMs: session.lagMs,
      processedCount: session.processedCount,
      ...(session.retryAfterMs !== undefined
        ? { retryAfterMs: session.retryAfterMs }
        : {}),
    };
  }
}

export function sourceIdentity(
  sourceType: RagSyncSourceType,
  sourceId: string,
): string {
  return `${sourceType}:${sourceId}`;
}

function remoteSourceTuple(
  metadata: RagSyncRemoteOwnership['metadata'],
): string {
  return sourceTuple(metadata);
}

function sourceTuple(
  source: Pick<SyncSource, 'sourceType' | 'sourceId' | 'pageId' | 'databaseId'>,
): string {
  return JSON.stringify([
    source.sourceType,
    source.sourceId,
    source.pageId,
    source.databaseId ?? null,
  ]);
}

function pageToSource(
  page: InternalRagPageDetail,
  updatedAtMs: number,
): SyncSource {
  const title = page.title || 'Untitled';
  return {
    identity: sourceIdentity('page', page.id),
    sourceType: 'page',
    sourceId: page.id,
    pageId: page.id,
    updatedAtMs,
    fileName: safeFileName(title, page.id, '.md'),
    mimeType: 'text/markdown',
    content: encodeMarkdown(
      [`# ${title}`, page.contentMarkdown || ''].filter(Boolean).join('\n\n'),
    ),
  };
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function appendScanDigest(
  previous: string | undefined,
  fileIds: string[],
): string {
  return createHash('sha256')
    .update(previous ?? '')
    .update('\n')
    .update(fileIds.join('\n'))
    .digest('hex');
}

function encodeMarkdown(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function safeFileName(
  title: string,
  fallback: string,
  extension: string,
): string {
  const base = title
    .normalize('NFKC')
    .split('')
    .map((character) => (character.charCodeAt(0) <= 0x1f ? '-' : character))
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .trim()
    .slice(0, 120);
  const normalizedExtension = extension.startsWith('.')
    ? extension
    : `.${extension}`;
  return `${base || fallback}${normalizedExtension}`;
}

function normalizeExtension(value: string): string {
  return value.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
}

function dateToMs(value: string | Date | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sameMapping(
  left: RagSyncSourceMapping | null,
  right: RagSyncSourceMapping,
): boolean {
  return Boolean(
    left &&
      left.identity === right.identity &&
      left.fileId === right.fileId &&
      left.operationId === right.operationId &&
      left.contentHash === right.contentHash &&
      left.sourceType === right.sourceType &&
      left.sourceId === right.sourceId &&
      left.pageId === right.pageId &&
      left.databaseId === right.databaseId &&
      left.updatedAtMs === right.updatedAtMs,
  );
}

function settledCheckpoint(baseCheckpoint: number, maxSeen: number): number {
  if (maxSeen <= Date.now() - CHECKPOINT_SETTLE_MS) return maxSeen + 1;
  return Math.max(baseCheckpoint, maxSeen - CHECKPOINT_SETTLE_MS);
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function runConcurrently<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let firstError: unknown;
  let failed = false;
  let stopped = false;
  const worker = async () => {
    while (!stopped && nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      try {
        await task(item);
      } catch (error) {
        if (!stopped) {
          stopped = true;
          failed = true;
          firstError = error;
        }
        return;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(items.length, Math.max(1, concurrency)) },
      worker,
    ),
  );
  if (failed) throw firstError;
}
