import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RagSynchronizer, sourceIdentity } from "./synchronizer.js";
import {
  OpenWebUiFileProcessingError,
  type DocmostSourceClient,
  type FeedCheckpointKind,
  type OpenWebUiFile,
  type OpenWebUiWriterClient,
  type RagSyncBinding,
  type SourceMapping,
  type SyncSource,
  type SyncStateStore,
} from "./types.js";

const binding: RagSyncBinding = {
  id: "binding-1",
  workspaceId: "0198f2f5-a5a3-7000-8000-000000000001",
  spaceId: "0198f2f5-a5a3-7000-8000-000000000002",
  docmostBaseUrl: "https://docmost.example",
  docmostApiKeyFile: "/secret/docmost",
  docmostApiKey: "docmost-key",
  openWebUiBaseUrl: "https://open-webui.example",
  openWebUiApiKeyFile: "/secret/open-webui",
  openWebUiApiKey: "writer-key",
  knowledgeId: "knowledge-1",
};

describe("RagSynchronizer", () => {
  it("aggregates source outcomes without logging raw identifiers", () => {
    const synchronizer = createSynchronizer(
      new MemoryState(),
      new MemoryWriter(),
    );
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => messages.push(String(message));
    try {
      (synchronizer as any).log("source.uploaded", {
        identity: sourceIdentity("page", PAGE_ID),
        processingMs: 10,
      });
      (synchronizer as any).log("sync.completed", {
        durationMs: 20,
        bindingId: binding.id,
        spaceId: binding.spaceId,
        fingerprint: "secret-fingerprint",
        sourceOutcomes: Object.fromEntries(
          (synchronizer as any).sourceOutcomes,
        ),
      });
    } finally {
      console.log = originalLog;
    }

    assert.equal(messages.length, 1);
    assert.match(messages[0], /source\.uploaded:none/);
    assert.doesNotMatch(
      messages[0],
      new RegExp(
        `${PAGE_ID}|${binding.id}|${binding.spaceId}|secret-fingerprint`,
      ),
    );
  });

  it("uses safe replacement and skips an unchanged source", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const synchronizer = createSynchronizer(state, writer);
    const source = markdownSource("first");

    assert.equal(await synchronizer.upsertSource(source), "uploaded");
    assert.equal(writer.uploaded.length, 1);
    assert.deepEqual(writer.waited, ["file-1"]);
    assert.deepEqual(writer.deleted, []);
    assert.equal(await synchronizer.upsertSource(source), "unchanged");
    assert.equal(writer.uploaded.length, 1);

    const changed = markdownSource("second");
    assert.equal(await synchronizer.upsertSource(changed), "uploaded");
    assert.equal(writer.uploaded.length, 2);
    assert.deepEqual(writer.deleted, ["file-1"]);
    assert.equal(
      (await state.getMapping(binding.id, source.identity))?.fileId,
      "file-2",
    );
  });

  it("does not replace the working mapping when processing fails", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const synchronizer = createSynchronizer(state, writer);
    await synchronizer.upsertSource(markdownSource("first"));
    writer.failProcessing = true;

    await assert.rejects(
      synchronizer.upsertSource(markdownSource("changed")),
      /processing failed/,
    );
    assert.equal(
      (await state.getMapping(binding.id, sourceIdentity("page", PAGE_ID)))
        ?.fileId,
      "file-1",
    );
    assert.deepEqual(writer.deleted, []);
  });

  it("does not persist a mapping after the distributed lock is lost", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const synchronizer = createSynchronizer(state, writer);
    const activeLock = {
      valid: true,
      abortController: new AbortController(),
    };
    (synchronizer as any).activeLock = activeLock;
    writer.afterUpload = () => {
      activeLock.valid = false;
    };

    await assert.rejects(
      synchronizer.upsertSource(markdownSource("first")),
      /RAG sync lock was lost/,
    );
    assert.equal(writer.uploaded.length, 1);
    assert.equal(
      await state.getMapping(binding.id, sourceIdentity("page", PAGE_ID)),
      null,
    );
  });

  it("aborts an in-flight Open WebUI write as soon as the lease is lost", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    let uploadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      uploadStarted = resolve;
    });
    writer.upload = async (
      _fileName: string,
      _mimeType: string,
      _content: Uint8Array,
      _metadata: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      uploadStarted();
      return new Promise<OpenWebUiFile>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    };
    const synchronizer = createSynchronizer(state, writer);
    const abortController = new AbortController();
    const activeLock = { valid: true, abortController };
    (synchronizer as any).activeLock = activeLock;

    const pending = synchronizer.upsertSource(markdownSource("content"));
    await started;
    activeLock.valid = false;
    abortController.abort(new Error("RAG sync lock was lost"));

    await assert.rejects(pending, /lock was lost/);
    assert.equal(
      await state.getMapping(binding.id, sourceIdentity("page", PAGE_ID)),
      null,
    );
  });

  it("reconciles duplicate remote files and ignores foreign metadata", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    writer.remoteFiles = [
      remoteFile("old", 100, "hash-old"),
      remoteFile("current", 200, "hash-current"),
      remoteFile("foreign", 300, "hash-foreign", {
        spaceId: "0198f2f5-a5a3-7000-8000-000000000099",
      }),
    ];
    const synchronizer = createSynchronizer(state, writer);

    await synchronizer.reconcileRemoteMappings();

    assert.equal(
      (await state.getMapping(binding.id, sourceIdentity("page", PAGE_ID)))
        ?.fileId,
      "current",
    );
    assert.deepEqual(writer.deleted, ["old"]);
  });

  it("deletes a failed remote file instead of restoring its mapping", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    writer.remoteFiles = [
      {
        ...remoteFile("failed", 100, "hash-failed"),
        data: { status: "failed" },
      },
    ];
    const synchronizer = createSynchronizer(state, writer);

    await synchronizer.reconcileRemoteMappings();

    assert.equal(
      await state.getMapping(binding.id, sourceIdentity("page", PAGE_ID)),
      null,
    );
    assert.deepEqual(writer.deleted, ["failed"]);
  });

  it("skips an empty untitled page without uploading it", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const docmost = emptyDocmost();
    docmost.getUpdates = async () => ({
      items: [
        {
          type: "page",
          id: PAGE_ID,
          slugId: "page",
          title: "",
          updatedAt: new Date(100).toISOString(),
          updatedAtMs: 100,
        },
      ],
      hasMore: false,
      nextCursor: null,
      maxUpdatedAtMs: 100,
    });
    docmost.getPage = async () => ({
      id: PAGE_ID,
      slugId: "page",
      type: "page",
      title: "",
      spaceId: binding.spaceId,
      databaseId: null,
      contentMarkdown: "",
      updatedAt: new Date(100).toISOString(),
    });
    const synchronizer = new RagSynchronizer(
      binding,
      state,
      docmost,
      writer,
      1024,
      60_000,
    );

    assert.equal(await synchronizer.syncOnce(), true);
    assert.equal(writer.uploaded.length, 0);
    assert.equal(await state.getCheckpoint(binding.id, "updates"), 100);
  });

  it("continues after Open WebUI rejects a database summary file", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    writer.failWithProcessingError = true;
    const docmost = emptyDocmost();
    docmost.getUpdates = async () => ({
      items: [
        {
          type: "database",
          id: PAGE_ID,
          databaseId: "database-id",
          slugId: "database",
          title: "Database",
          updatedAt: new Date(100).toISOString(),
          updatedAtMs: 100,
        },
      ],
      hasMore: false,
      nextCursor: null,
      maxUpdatedAtMs: 100,
    });
    docmost.getDatabase = async () => ({
      id: PAGE_ID,
      slugId: "database",
      databaseId: "database-id",
      type: "database",
      name: "Database",
      title: "Database",
      spaceId: binding.spaceId,
      updatedAt: new Date(100).toISOString(),
      knowledgeMarkdown: "Database summary",
      rows: [],
    });
    const synchronizer = new RagSynchronizer(
      binding,
      state,
      docmost,
      writer,
      1024,
      60_000,
    );

    assert.equal(await synchronizer.syncOnce(), true);
    assert.equal(writer.uploaded.length, 1);
    assert.deepEqual(writer.deleted, ["file-1"]);
    assert.equal(await state.getCheckpoint(binding.id, "updates"), 100);
  });

  it("continues after Open WebUI rejects an attachment file", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    writer.failWithProcessingError = true;
    const docmost = emptyDocmost();
    docmost.getAttachmentUpdates = async () => ({
      items: [
        {
          id: "attachment-id",
          fileId: "file-id",
          fileName: "image.png",
          fileExt: ".png",
          mimeType: "image/png",
          fileSize: 3,
          pageId: PAGE_ID,
          spaceId: binding.spaceId,
          createdAt: new Date(100).toISOString(),
          updatedAt: new Date(100).toISOString(),
          updatedAtMs: 100,
          downloadUrl: "/api/rag/attachments/file-id/image.png",
        },
      ],
      hasMore: false,
      nextCursor: null,
      maxUpdatedAtMs: 100,
    });
    docmost.downloadAttachment = async () => new Uint8Array([1, 2, 3]);
    const synchronizer = new RagSynchronizer(
      binding,
      state,
      docmost,
      writer,
      1024,
      60_000,
    );

    assert.equal(await synchronizer.syncOnce(), true);
    assert.equal(writer.uploaded.length, 1);
    assert.deepEqual(writer.deleted, ["file-1"]);
    assert.equal(
      await state.getCheckpoint(binding.id, "attachment-updates"),
      100,
    );
  });

  it("deletes an existing attachment mapping after a deterministic policy skip", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const identity = sourceIdentity("attachment", "attachment-id");
    await state.setMapping(binding.id, {
      identity,
      fileId: "existing-file",
      contentHash: "old-hash",
      sourceType: "attachment",
      sourceId: "attachment-id",
      pageId: PAGE_ID,
      updatedAtMs: 50,
    });
    const synchronizer = createSynchronizer(state, writer);

    await (synchronizer as any).processAttachment({
      id: "attachment-id",
      fileId: "attachment-id",
      fileName: "archive.exe",
      fileExt: ".exe",
      mimeType: "application/octet-stream",
      fileSize: 10,
      pageId: PAGE_ID,
      spaceId: binding.spaceId,
      createdAt: new Date(100).toISOString(),
      updatedAt: new Date(100).toISOString(),
      updatedAtMs: 100,
      downloadUrl: "/api/rag/attachments/attachment-id/archive.exe",
    });

    assert.deepEqual(writer.deleted, ["existing-file"]);
    assert.equal(await state.getMapping(binding.id, identity), null);
  });

  it("advances a checkpoint only after the complete feed page succeeds", async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const docmost = emptyDocmost();
    docmost.getUpdates = async () => ({
      items: [
        {
          type: "page",
          id: PAGE_ID,
          slugId: "page",
          title: "Page",
          updatedAt: new Date(100).toISOString(),
          updatedAtMs: 100,
        },
      ],
      hasMore: false,
      nextCursor: null,
      maxUpdatedAtMs: 100,
    });
    docmost.getPage = async () => {
      throw new Error("source unavailable");
    };
    const synchronizer = new RagSynchronizer(
      binding,
      state,
      docmost,
      writer,
      1024,
      60_000,
    );

    await assert.rejects(synchronizer.syncOnce(), /source unavailable/);
    assert.equal(await state.getCheckpoint(binding.id, "updates"), 0);
  });

  it("purges blocked remote mappings and resets live checkpoints on a v2 scope change", async () => {
    const state = new MemoryState();
    state.scopeFingerprint = "old-scope";
    state.checkpoints.set(`${binding.id}:updates`, 500);
    state.checkpoints.set(`${binding.id}:attachment-updates`, 600);
    const writer = new MemoryWriter();
    writer.remoteFiles = [remoteFile("excluded-file", 100, "hash")];
    const docmost = emptyDocmost();
    docmost.getScope = async () => ({
      schemaVersion: 2,
      fingerprint: "new-scope",
      excludedPageIds: [],
    });
    docmost.getBlockedPages = async () => ({
      items: [{ pageId: PAGE_ID }],
      hasMore: false,
      nextCursor: null,
    });
    const synchronizer = new RagSynchronizer(
      binding,
      state,
      docmost,
      writer,
      1024,
      60_000,
    );

    assert.equal(await synchronizer.syncOnce(), true);
    assert.deepEqual(writer.deleted, ["excluded-file"]);
    assert.equal(await state.getCheckpoint(binding.id, "updates"), 0);
    assert.equal(
      await state.getCheckpoint(binding.id, "attachment-updates"),
      0,
    );
    const storedFingerprint = await state.getScopeFingerprint(binding.id);
    assert.notEqual(storedFingerprint, "old-scope");
    assert.ok(storedFingerprint);

    assert.equal(await synchronizer.syncOnce(), true);
    assert.deepEqual(writer.deleted, ["excluded-file"]);
    assert.equal(
      await state.getScopeFingerprint(binding.id),
      storedFingerprint,
    );
  });

  it("stores a changed scope fingerprint only after a successful cycle", async () => {
    const state = new MemoryState();
    state.scopeFingerprint = "old-scope";
    const docmost = emptyDocmost();
    docmost.getScope = async () => ({
      fingerprint: "new-scope",
      excludedPageIds: [],
    });
    docmost.getUpdates = async () => {
      throw new Error("feed unavailable");
    };
    const synchronizer = new RagSynchronizer(
      binding,
      state,
      docmost,
      new MemoryWriter(),
      1024,
      60_000,
    );

    await assert.rejects(synchronizer.syncOnce(), /feed unavailable/);
    assert.equal(await state.getScopeFingerprint(binding.id), "old-scope");
  });

  it("does not mask the sync result when releasing the Redis lock fails", async () => {
    const state = new MemoryState();
    state.failRelease = true;
    const synchronizer = createSynchronizer(state, new MemoryWriter());

    assert.equal(await synchronizer.syncOnce(), true);
  });
});

const PAGE_ID = "0198f2f5-a5a3-7000-8000-000000000003";

function createSynchronizer(
  state: MemoryState,
  writer: MemoryWriter,
): RagSynchronizer {
  return new RagSynchronizer(
    binding,
    state,
    emptyDocmost(),
    writer,
    1024 * 1024,
    60_000,
  );
}

function markdownSource(content: string): SyncSource {
  return {
    identity: sourceIdentity("page", PAGE_ID),
    sourceType: "page",
    sourceId: PAGE_ID,
    pageId: PAGE_ID,
    updatedAtMs: 100,
    fileName: "page.md",
    mimeType: "text/markdown",
    content: new TextEncoder().encode(content),
  };
}

function remoteFile(
  id: string,
  sourceUpdatedAtMs: number,
  contentHash: string,
  overrides: Record<string, unknown> = {},
): OpenWebUiFile {
  return {
    id,
    meta: {
      data: {
        docmost: {
          schemaVersion: 1,
          workspaceId: binding.workspaceId,
          spaceId: binding.spaceId,
          sourceType: "page",
          sourceId: PAGE_ID,
          pageId: PAGE_ID,
          sourceUpdatedAtMs,
          contentHash,
          ...overrides,
        },
      },
    },
  };
}

function emptyDocmost(): DocmostSourceClient {
  const empty = async () => ({
    items: [],
    hasMore: false,
    nextCursor: null,
  });
  return {
    getScope: async () => ({
      fingerprint: "empty-scope",
      excludedPageIds: [],
    }),
    getBlockedPages: empty,
    getUpdates: empty,
    getDeleted: empty,
    getAttachmentUpdates: empty,
    getAttachmentDeleted: empty,
    getPage: async () => {
      throw new Error("not used");
    },
    getDatabase: async () => {
      throw new Error("not used");
    },
    downloadAttachment: async () => {
      throw new Error("not used");
    },
  };
}

class MemoryWriter implements OpenWebUiWriterClient {
  uploaded: Array<{ fileName: string; metadata: Record<string, unknown> }> = [];
  waited: string[] = [];
  deleted: string[] = [];
  remoteFiles: OpenWebUiFile[] = [];
  failProcessing = false;
  failWithProcessingError = false;
  afterUpload?: () => void;

  async upload(
    fileName: string,
    _mimeType: string,
    _content: Uint8Array,
    metadata: Record<string, unknown>,
    _signal?: AbortSignal,
  ): Promise<OpenWebUiFile> {
    this.uploaded.push({ fileName, metadata });
    this.afterUpload?.();
    return { id: `file-${this.uploaded.length}` };
  }

  async waitUntilProcessed(
    fileId: string,
    assertActive?: () => void,
  ): Promise<void> {
    this.waited.push(fileId);
    assertActive?.();
    if (this.failProcessing) throw new Error("processing failed");
    if (this.failWithProcessingError) {
      throw new OpenWebUiFileProcessingError(fileId, "failed");
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    this.deleted.push(fileId);
  }

  async listKnowledgeFiles(): Promise<OpenWebUiFile[]> {
    return this.remoteFiles;
  }
}

class MemoryState implements SyncStateStore {
  checkpoints = new Map<string, number>();
  mappings = new Map<string, SourceMapping>();
  lock: string | null = null;
  failRelease = false;
  scopeFingerprint: string | null = "empty-scope";

  async acquireLock(
    _bindingId: string,
    token: string,
    _ttlMs: number,
  ): Promise<boolean> {
    if (this.lock) return false;
    this.lock = token;
    return true;
  }

  async renewLock(
    _bindingId: string,
    token: string,
    _ttlMs: number,
  ): Promise<boolean> {
    return this.lock === token;
  }

  async releaseLock(_bindingId: string, token: string): Promise<void> {
    if (this.failRelease) throw new Error("redis unavailable");
    if (this.lock === token) this.lock = null;
  }

  async getCheckpoint(
    bindingId: string,
    kind: FeedCheckpointKind,
  ): Promise<number> {
    return this.checkpoints.get(`${bindingId}:${kind}`) ?? 0;
  }

  async setCheckpoint(
    bindingId: string,
    kind: FeedCheckpointKind,
    value: number,
  ): Promise<void> {
    this.checkpoints.set(`${bindingId}:${kind}`, value);
  }

  async getScopeFingerprint(_bindingId: string): Promise<string | null> {
    return this.scopeFingerprint;
  }

  async setScopeFingerprint(
    _bindingId: string,
    fingerprint: string,
  ): Promise<void> {
    this.scopeFingerprint = fingerprint;
  }

  async getMapping(
    _bindingId: string,
    identity: string,
  ): Promise<SourceMapping | null> {
    return this.mappings.get(identity) ?? null;
  }

  async listMappings(_bindingId: string): Promise<SourceMapping[]> {
    return [...this.mappings.values()];
  }

  async setMapping(_bindingId: string, mapping: SourceMapping): Promise<void> {
    this.mappings.set(mapping.identity, mapping);
  }

  async deleteMapping(_bindingId: string, identity: string): Promise<void> {
    this.mappings.delete(identity);
  }

  async close(): Promise<void> {}
}
