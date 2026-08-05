import { createHash, randomUUID } from "node:crypto";
import type {
  RagAttachmentItem,
  RagDatabaseDetail,
  RagDeletedItem,
  RagPageDetail,
  RagUpdateItem,
} from "@docmost/api-contract";
import {
  OpenWebUiFileProcessingError,
  type DocmostMetadata,
  type DocmostSourceClient,
  type FeedCheckpointKind,
  type OpenWebUiFile,
  type OpenWebUiWriterClient,
  type RagSyncBinding,
  type SourceMapping,
  type SyncSource,
  type SyncStateStore,
} from "./types.js";

const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);

export class RagSynchronizer {
  private readonly sourceOutcomes = new Map<string, number>();
  private readonly lockTtlMs: number;
  private activeLock:
    | { valid: boolean; abortController: AbortController }
    | undefined;

  constructor(
    private readonly binding: RagSyncBinding,
    private readonly state: SyncStateStore,
    private readonly docmost: DocmostSourceClient,
    private readonly openWebUi: OpenWebUiWriterClient,
    private readonly maxAttachmentBytes: number,
    pollIntervalMs: number,
  ) {
    this.lockTtlMs = Math.max(30_000, pollIntervalMs * 3);
  }

  async syncOnce(): Promise<boolean> {
    const token = randomUUID();
    if (
      !(await this.state.acquireLock(this.binding.id, token, this.lockTtlMs))
    ) {
      return false;
    }
    const activeLock = {
      valid: true,
      abortController: new AbortController(),
    };
    this.activeLock = activeLock;
    const renew = setInterval(
      () => {
        void this.state
          .renewLock(this.binding.id, token, this.lockTtlMs)
          .then((renewed) => {
            if (!renewed) {
              activeLock.valid = false;
              activeLock.abortController.abort(
                new Error("RAG sync lock was lost"),
              );
              this.log("lock.lost", {});
            }
          })
          .catch(() => {
            activeLock.valid = false;
            activeLock.abortController.abort(
              new Error("RAG sync lock renewal failed"),
            );
            this.log("lock.renew_failed", {});
          });
      },
      Math.max(10_000, Math.floor(this.lockTtlMs / 3)),
    );
    renew.unref();
    const startedAt = Date.now();
    try {
      const scope = await this.guarded((signal) =>
        this.docmost.getScope(signal),
      );
      await this.reconcileRemoteMappings();
      const previousScopeFingerprint = await this.guarded(() =>
        this.state.getScopeFingerprint(this.binding.id),
      );
      const effectiveScopeFingerprint = sha256(
        new TextEncoder().encode(
          JSON.stringify({
            schemaVersion: 2,
            serverScopeFingerprint: scope.fingerprint,
            maxAttachmentBytes: this.maxAttachmentBytes,
            supportedAttachmentExtensions: [
              ...SUPPORTED_ATTACHMENT_EXTENSIONS,
            ].sort(),
          }),
        ),
      );
      const scopeChanged =
        previousScopeFingerprint !== effectiveScopeFingerprint;
      if (scopeChanged) {
        this.log("scope.changed", {
          previousFingerprint: previousScopeFingerprint,
          fingerprint: effectiveScopeFingerprint,
          excludedPageCount: scope.excludedPageIds.length,
        });
        const blocked =
          scope.schemaVersion === 2
            ? await this.loadBlockedPageIds()
            : new Set(scope.excludedPageIds);
        let purged = 0;
        for (const mapping of await this.guarded(() =>
          this.state.listMappings(this.binding.id),
        )) {
          if (!blocked.has(mapping.pageId)) continue;
          await this.deleteIdentity(mapping.identity);
          purged += 1;
        }
        await this.guarded(() =>
          this.state.setCheckpoint(this.binding.id, "updates", 0),
        );
        await this.guarded(() =>
          this.state.setCheckpoint(this.binding.id, "attachment-updates", 0),
        );
        this.log("scope.purged", { count: purged });
      }
      await this.processUpdateFeed();
      await this.processDeletedFeed();
      await this.processAttachmentUpdateFeed();
      await this.processAttachmentDeletedFeed();
      if (scopeChanged) {
        await this.guarded(() =>
          this.state.setScopeFingerprint(
            this.binding.id,
            effectiveScopeFingerprint,
          ),
        );
      }
      this.log("sync.completed", {
        durationMs: Date.now() - startedAt,
        sourceOutcomes: Object.fromEntries(this.sourceOutcomes),
      });
      this.sourceOutcomes.clear();
      return true;
    } catch (error) {
      this.log("sync.failed", {
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.constructor.name : "unknown",
        sourceOutcomes: Object.fromEntries(this.sourceOutcomes),
      });
      this.sourceOutcomes.clear();
      throw error;
    } finally {
      clearInterval(renew);
      if (this.activeLock === activeLock) {
        this.activeLock = undefined;
      }
      try {
        await this.state.releaseLock(this.binding.id, token);
      } catch {
        this.log("lock.release_failed", {});
      }
    }
  }

  async reconcileRemoteMappings(): Promise<void> {
    const remoteFiles = await this.guarded((signal) =>
      this.openWebUi.listKnowledgeFiles(signal),
    );
    const usableRemoteIds = new Set<string>();
    const byIdentity = new Map<
      string,
      Array<{ file: OpenWebUiFile; metadata: DocmostMetadata }>
    >();
    for (const file of remoteFiles) {
      const metadata = this.readRemoteMetadata(file);
      if (!metadata) continue;
      if (file.data?.status === "failed") {
        await this.guarded((signal) =>
          this.openWebUi.deleteFile(file.id, signal),
        );
        this.log("source.skipped", {
          identity: sourceIdentity(metadata.sourceType, metadata.sourceId),
          reason: "remote-processing-failed",
        });
        continue;
      }
      usableRemoteIds.add(file.id);
      const identity = sourceIdentity(metadata.sourceType, metadata.sourceId);
      const group = byIdentity.get(identity) ?? [];
      group.push({ file, metadata });
      byIdentity.set(identity, group);
    }

    for (const [identity, candidates] of byIdentity) {
      candidates.sort(
        (left, right) =>
          right.metadata.sourceUpdatedAtMs - left.metadata.sourceUpdatedAtMs ||
          right.file.id.localeCompare(left.file.id),
      );
      const [current, ...duplicates] = candidates;
      await this.guarded(() =>
        this.state.setMapping(this.binding.id, {
          identity,
          fileId: current.file.id,
          contentHash: current.metadata.contentHash,
          sourceType: current.metadata.sourceType,
          sourceId: current.metadata.sourceId,
          pageId: current.metadata.pageId,
          databaseId: current.metadata.databaseId,
          updatedAtMs: current.metadata.sourceUpdatedAtMs,
        }),
      );
      for (const duplicate of duplicates) {
        await this.guarded((signal) =>
          this.openWebUi.deleteFile(duplicate.file.id, signal),
        );
      }
      if (duplicates.length > 0) {
        this.log("reconcile.duplicates", {
          identity,
          count: duplicates.length,
        });
      }
    }

    for (const mapping of await this.guarded(() =>
      this.state.listMappings(this.binding.id),
    )) {
      if (!usableRemoteIds.has(mapping.fileId)) {
        await this.guarded(() =>
          this.state.deleteMapping(this.binding.id, mapping.identity),
        );
      }
    }
  }

  async upsertSource(source: SyncSource): Promise<"uploaded" | "unchanged"> {
    const contentHash = sha256(source.content);
    const existing = await this.guarded(() =>
      this.state.getMapping(this.binding.id, source.identity),
    );
    if (existing?.contentHash === contentHash) {
      return "unchanged";
    }
    const metadata: DocmostMetadata = {
      schemaVersion: 1,
      workspaceId: this.binding.workspaceId,
      spaceId: this.binding.spaceId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      pageId: source.pageId,
      ...(source.databaseId ? { databaseId: source.databaseId } : {}),
      sourceUpdatedAtMs: source.updatedAtMs,
      contentHash,
    };
    const uploaded = await this.guarded((signal) =>
      this.openWebUi.upload(
        source.fileName,
        source.mimeType,
        source.content,
        {
          knowledge_id: this.binding.knowledgeId,
          file_hash: contentHash,
          docmost: metadata,
        },
        signal,
      ),
    );
    if (!uploaded.id) {
      throw new Error("Open WebUI upload response is missing file id");
    }
    const processingStartedAt = Date.now();
    await this.guarded((signal) =>
      this.openWebUi.waitUntilProcessed(
        uploaded.id,
        () => this.assertLock(),
        signal,
      ),
    );
    const mapping: SourceMapping = {
      identity: source.identity,
      fileId: uploaded.id,
      contentHash,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      pageId: source.pageId,
      databaseId: source.databaseId,
      updatedAtMs: source.updatedAtMs,
    };
    await this.guarded(() => this.state.setMapping(this.binding.id, mapping));
    if (existing && existing.fileId !== uploaded.id) {
      await this.guarded((signal) =>
        this.openWebUi.deleteFile(existing.fileId, signal),
      );
    }
    this.log(existing ? "source.replaced" : "source.uploaded", {
      identity: source.identity,
      processingMs: Date.now() - processingStartedAt,
    });
    return "uploaded";
  }

  async deleteIdentity(identity: string): Promise<void> {
    const existing = await this.guarded(() =>
      this.state.getMapping(this.binding.id, identity),
    );
    if (!existing) return;
    await this.guarded((signal) =>
      this.openWebUi.deleteFile(existing.fileId, signal),
    );
    await this.guarded(() =>
      this.state.deleteMapping(this.binding.id, identity),
    );
    this.log("source.deleted", { identity });
  }

  private async processUpdateFeed(): Promise<void> {
    await this.processFeed(
      "updates",
      (since, cursor, signal) => this.docmost.getUpdates(since, cursor, signal),
      async (item) => this.processUpdate(item),
      "maxUpdatedAtMs",
    );
  }

  private async processDeletedFeed(): Promise<void> {
    await this.processFeed(
      "deleted",
      (since, cursor, signal) => this.docmost.getDeleted(since, cursor, signal),
      async (item) => this.processDeleted(item),
      "maxDeletedAtMs",
    );
  }

  private async processAttachmentUpdateFeed(): Promise<void> {
    await this.processFeed(
      "attachment-updates",
      (since, cursor, signal) =>
        this.docmost.getAttachmentUpdates(since, cursor, signal),
      async (item) => this.processAttachment(item),
      "maxUpdatedAtMs",
    );
  }

  private async processAttachmentDeletedFeed(): Promise<void> {
    await this.processFeed(
      "attachment-deleted",
      (since, cursor, signal) =>
        this.docmost.getAttachmentDeleted(since, cursor, signal),
      async (item) =>
        this.deleteIdentity(sourceIdentity("attachment", item.id)),
      "maxDeletedAtMs",
    );
  }

  private async processFeed<T>(
    kind: FeedCheckpointKind,
    load: (
      since: number,
      cursor?: string,
      signal?: AbortSignal,
    ) => Promise<{
      items: T[];
      hasMore: boolean;
      nextCursor: string | null;
      maxUpdatedAtMs?: number;
      maxDeletedAtMs?: number;
    }>,
    process: (item: T) => Promise<void>,
    checkpointField: "maxUpdatedAtMs" | "maxDeletedAtMs",
  ): Promise<void> {
    let checkpoint = await this.guarded(() =>
      this.state.getCheckpoint(this.binding.id, kind),
    );
    let cursor: string | undefined;
    do {
      const pageStartedAt = Date.now();
      const page = await this.guarded((signal) =>
        load(checkpoint, cursor, signal),
      );
      for (const item of page.items) await process(item);
      const nextCheckpoint = page[checkpointField] ?? checkpoint;
      if (nextCheckpoint < checkpoint) {
        throw new Error("Docmost feed checkpoint moved backwards");
      }
      await this.guarded(() =>
        this.state.setCheckpoint(this.binding.id, kind, nextCheckpoint),
      );
      checkpoint = nextCheckpoint;
      this.log("feed.processed", {
        kind,
        count: page.items.length,
        checkpoint,
        lagMs: checkpoint > 0 ? Math.max(0, Date.now() - checkpoint) : null,
        durationMs: Date.now() - pageStartedAt,
      });
      cursor = page.hasMore ? page.nextCursor || undefined : undefined;
      if (page.hasMore && !cursor) {
        throw new Error("Docmost feed omitted nextCursor");
      }
    } while (cursor);
  }

  private async processUpdate(item: RagUpdateItem): Promise<void> {
    if (item.type === "page") {
      const page = await this.guarded((signal) =>
        this.docmost.getPage(item.id, signal),
      );
      if (!page.title?.trim() && !page.contentMarkdown?.trim()) {
        await this.deleteIdentity(sourceIdentity("page", page.id));
        this.log("source.skipped", {
          identity: sourceIdentity("page", page.id),
          reason: "empty",
        });
        return;
      }
      await this.upsertSource(pageToSource(page, item.updatedAtMs));
      return;
    }
    const database = await this.guarded((signal) =>
      this.docmost.getDatabase(item.databaseId, signal),
    );
    await this.upsertDatabase(database, item.updatedAtMs);
  }

  private async upsertDatabase(
    database: RagDatabaseDetail,
    updatedAtMs: number,
  ): Promise<void> {
    const pageContent = database.knowledgeMarkdown || database.title;
    const databasePageIdentity = sourceIdentity("page", database.id);
    try {
      await this.upsertSource({
        identity: databasePageIdentity,
        sourceType: "page",
        sourceId: database.id,
        pageId: database.id,
        databaseId: database.databaseId,
        updatedAtMs,
        fileName: safeFileName(database.title, database.id, ".md"),
        mimeType: "text/markdown",
        content: encodeMarkdown(`# ${database.title}\n\n${pageContent}`),
      });
    } catch (error) {
      if (
        !(error instanceof OpenWebUiFileProcessingError) ||
        error.status !== "failed"
      ) {
        throw error;
      }
      try {
        await this.guarded((signal) =>
          this.openWebUi.deleteFile(error.fileId, signal),
        );
      } catch {
        // Reconciliation removes a failed artifact on the next cycle.
      }
      await this.guarded(() =>
        this.state.deleteMapping(this.binding.id, databasePageIdentity),
      );
      this.log("source.skipped", {
        identity: databasePageIdentity,
        reason: "remote-processing-failed",
      });
    }
    const currentRows = new Set<string>();
    for (const row of database.rows) {
      currentRows.add(row.id);
      const title = row.page?.title || row.pageTitle || row.id;
      const cells = (row.cells ?? [])
        .map((cell) => `- ${cell.propertyId}: ${stringifyValue(cell.value)}`)
        .join("\n");
      const markdown = [`# ${title}`, cells, row.rowMarkdown || ""]
        .filter(Boolean)
        .join("\n\n");
      await this.upsertSource({
        identity: sourceIdentity("database_row", row.id),
        sourceType: "database_row",
        sourceId: row.id,
        pageId: row.pageId,
        databaseId: database.databaseId,
        updatedAtMs: dateToMs(row.updatedAt, updatedAtMs),
        fileName: safeFileName(title, row.id, ".md"),
        mimeType: "text/markdown",
        content: encodeMarkdown(markdown),
      });
    }
    for (const mapping of await this.guarded(() =>
      this.state.listMappings(this.binding.id),
    )) {
      if (
        mapping.sourceType === "database_row" &&
        mapping.databaseId === database.databaseId &&
        !currentRows.has(mapping.sourceId)
      ) {
        await this.deleteIdentity(mapping.identity);
      }
    }
  }

  private async processDeleted(item: RagDeletedItem): Promise<void> {
    if (item.type === "databaseRow") {
      if (item.rowId) {
        await this.deleteIdentity(sourceIdentity("database_row", item.rowId));
      }
      return;
    }
    await this.deleteIdentity(sourceIdentity("page", item.id));
    if (item.type === "database" && item.databaseId) {
      for (const mapping of await this.guarded(() =>
        this.state.listMappings(this.binding.id),
      )) {
        if (mapping.databaseId === item.databaseId) {
          await this.deleteIdentity(mapping.identity);
        }
      }
    }
  }

  private async processAttachment(item: RagAttachmentItem): Promise<void> {
    const extension = normalizeExtension(item.fileExt || item.fileName);
    const size = Number(item.fileSize);
    if (
      !SUPPORTED_ATTACHMENT_EXTENSIONS.has(extension) ||
      (Number.isFinite(size) && size > this.maxAttachmentBytes)
    ) {
      await this.deleteIdentity(sourceIdentity("attachment", item.id));
      this.log("source.skipped", {
        identity: sourceIdentity("attachment", item.id),
        reason: !SUPPORTED_ATTACHMENT_EXTENSIONS.has(extension)
          ? "unsupported"
          : "oversized",
      });
      return;
    }
    const content = await this.guarded((signal) =>
      this.docmost.downloadAttachment(item, this.maxAttachmentBytes, signal),
    );
    const identity = sourceIdentity("attachment", item.id);
    try {
      await this.upsertSource({
        identity,
        sourceType: "attachment",
        sourceId: item.id,
        pageId: item.pageId,
        updatedAtMs: item.updatedAtMs,
        fileName: safeFileName(item.fileName, item.id, extension),
        mimeType: item.mimeType || "application/octet-stream",
        content,
      });
    } catch (error) {
      if (
        !(error instanceof OpenWebUiFileProcessingError) ||
        error.status !== "failed"
      ) {
        throw error;
      }
      try {
        await this.guarded((signal) =>
          this.openWebUi.deleteFile(error.fileId, signal),
        );
      } catch {
        // Reconciliation removes a failed artifact on the next cycle.
      }
      await this.guarded(() =>
        this.state.deleteMapping(this.binding.id, identity),
      );
      this.log("source.skipped", {
        identity,
        reason: "remote-processing-failed",
      });
    }
  }

  private async loadBlockedPageIds(): Promise<Set<string>> {
    const blocked = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.guarded((signal) =>
        this.docmost.getBlockedPages(cursor, signal),
      );
      for (const item of page.items) blocked.add(item.pageId);
      cursor = page.hasMore ? page.nextCursor || undefined : undefined;
      if (page.hasMore && !cursor) {
        throw new Error("Docmost blocked-page feed omitted nextCursor");
      }
    } while (cursor);
    return blocked;
  }

  private readRemoteMetadata(file: OpenWebUiFile): DocmostMetadata | null {
    const data = file.meta?.data;
    const candidate =
      data?.docmost && typeof data.docmost === "object"
        ? (data.docmost as Record<string, unknown>)
        : null;
    if (
      !candidate ||
      candidate.schemaVersion !== 1 ||
      candidate.workspaceId !== this.binding.workspaceId ||
      candidate.spaceId !== this.binding.spaceId ||
      !["page", "database_row", "attachment"].includes(
        String(candidate.sourceType),
      ) ||
      typeof candidate.sourceId !== "string" ||
      typeof candidate.pageId !== "string" ||
      typeof candidate.contentHash !== "string" ||
      !Number.isSafeInteger(candidate.sourceUpdatedAtMs)
    ) {
      return null;
    }
    return candidate as DocmostMetadata;
  }

  private assertLock(): void {
    if (this.activeLock && !this.activeLock.valid) {
      throw new Error("RAG sync lock was lost");
    }
  }

  private async guarded<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.assertLock();
    const result = await operation(this.activeLock?.abortController.signal);
    this.assertLock();
    return result;
  }

  private log(event: string, fields: Record<string, unknown>): void {
    if (event.startsWith("source.")) {
      const reason = typeof fields.reason === "string" ? fields.reason : "none";
      const key = `${event}:${reason}`;
      this.sourceOutcomes.set(key, (this.sourceOutcomes.get(key) ?? 0) + 1);
      return;
    }
    const safeFields = Object.fromEntries(
      Object.entries(fields).filter(
        ([key]) =>
          ![
            "bindingId",
            "spaceId",
            "identity",
            "previousFingerprint",
            "fingerprint",
            "checkpoint",
          ].includes(key),
      ),
    );
    console.log(
      JSON.stringify({
        component: "rag-sync",
        event,
        ...safeFields,
      }),
    );
  }
}

export function sourceIdentity(
  sourceType: "page" | "database_row" | "attachment",
  sourceId: string,
): string {
  return `${sourceType}:${sourceId}`;
}

function pageToSource(page: RagPageDetail, updatedAtMs: number): SyncSource {
  const title = page.title || "Untitled";
  return {
    identity: sourceIdentity("page", page.id),
    sourceType: "page",
    sourceId: page.id,
    pageId: page.id,
    updatedAtMs,
    fileName: safeFileName(title, page.id, ".md"),
    mimeType: "text/markdown",
    content: encodeMarkdown(
      [`# ${title}`, page.contentMarkdown || ""].filter(Boolean).join("\n\n"),
    ),
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 120);
  const normalizedExtension = extension.startsWith(".")
    ? extension
    : `.${extension}`;
  return `${base || fallback}${normalizedExtension}`;
}

function normalizeExtension(value: string): string {
  const match = value.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

function dateToMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
