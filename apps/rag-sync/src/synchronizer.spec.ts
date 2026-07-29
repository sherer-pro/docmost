import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RagSynchronizer, sourceIdentity } from './synchronizer.js';
import type {
  DocmostSourceClient,
  FeedCheckpointKind,
  OpenWebUiFile,
  OpenWebUiWriterClient,
  RagSyncBinding,
  SourceMapping,
  SyncSource,
  SyncStateStore,
} from './types.js';

const binding: RagSyncBinding = {
  id: 'binding-1',
  workspaceId: '0198f2f5-a5a3-7000-8000-000000000001',
  spaceId: '0198f2f5-a5a3-7000-8000-000000000002',
  docmostBaseUrl: 'https://docmost.example',
  docmostApiKeyFile: '/secret/docmost',
  docmostApiKey: 'docmost-key',
  openWebUiBaseUrl: 'https://open-webui.example',
  openWebUiApiKeyFile: '/secret/open-webui',
  openWebUiApiKey: 'writer-key',
  knowledgeId: 'knowledge-1',
};

describe('RagSynchronizer', () => {
  it('uses safe replacement and skips an unchanged source', async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const synchronizer = createSynchronizer(state, writer);
    const source = markdownSource('first');

    assert.equal(await synchronizer.upsertSource(source), 'uploaded');
    assert.equal(writer.uploaded.length, 1);
    assert.deepEqual(writer.waited, ['file-1']);
    assert.deepEqual(writer.deleted, []);
    assert.equal(await synchronizer.upsertSource(source), 'unchanged');
    assert.equal(writer.uploaded.length, 1);

    const changed = markdownSource('second');
    assert.equal(await synchronizer.upsertSource(changed), 'uploaded');
    assert.equal(writer.uploaded.length, 2);
    assert.deepEqual(writer.deleted, ['file-1']);
    assert.equal(
      (await state.getMapping(binding.id, source.identity))?.fileId,
      'file-2',
    );
  });

  it('does not replace the working mapping when processing fails', async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const synchronizer = createSynchronizer(state, writer);
    await synchronizer.upsertSource(markdownSource('first'));
    writer.failProcessing = true;

    await assert.rejects(
      synchronizer.upsertSource(markdownSource('changed')),
      /processing failed/,
    );
    assert.equal(
      (await state.getMapping(
        binding.id,
        sourceIdentity('page', PAGE_ID),
      ))?.fileId,
      'file-1',
    );
    assert.deepEqual(writer.deleted, []);
  });

  it('reconciles duplicate remote files and ignores foreign metadata', async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    writer.remoteFiles = [
      remoteFile('old', 100, 'hash-old'),
      remoteFile('current', 200, 'hash-current'),
      remoteFile('foreign', 300, 'hash-foreign', {
        spaceId: '0198f2f5-a5a3-7000-8000-000000000099',
      }),
    ];
    const synchronizer = createSynchronizer(state, writer);

    await synchronizer.reconcileRemoteMappings();

    assert.equal(
      (await state.getMapping(
        binding.id,
        sourceIdentity('page', PAGE_ID),
      ))?.fileId,
      'current',
    );
    assert.deepEqual(writer.deleted, ['old']);
  });

  it('advances a checkpoint only after the complete feed page succeeds', async () => {
    const state = new MemoryState();
    const writer = new MemoryWriter();
    const docmost = emptyDocmost();
    docmost.getUpdates = async () => ({
      items: [
        {
          type: 'page',
          id: PAGE_ID,
          slugId: 'page',
          title: 'Page',
          updatedAt: new Date(100).toISOString(),
          updatedAtMs: 100,
        },
      ],
      hasMore: false,
      nextCursor: null,
      maxUpdatedAtMs: 100,
    });
    docmost.getPage = async () => {
      throw new Error('source unavailable');
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
    assert.equal(await state.getCheckpoint(binding.id, 'updates'), 0);
  });

  it('does not mask the sync result when releasing the Redis lock fails', async () => {
    const state = new MemoryState();
    state.failRelease = true;
    const synchronizer = createSynchronizer(state, new MemoryWriter());

    assert.equal(await synchronizer.syncOnce(), true);
  });
});

const PAGE_ID = '0198f2f5-a5a3-7000-8000-000000000003';

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
    identity: sourceIdentity('page', PAGE_ID),
    sourceType: 'page',
    sourceId: PAGE_ID,
    pageId: PAGE_ID,
    updatedAtMs: 100,
    fileName: 'page.md',
    mimeType: 'text/markdown',
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
          sourceType: 'page',
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
    getUpdates: empty,
    getDeleted: empty,
    getAttachmentUpdates: empty,
    getAttachmentDeleted: empty,
    getPage: async () => {
      throw new Error('not used');
    },
    getDatabase: async () => {
      throw new Error('not used');
    },
    downloadAttachment: async () => {
      throw new Error('not used');
    },
  };
}

class MemoryWriter implements OpenWebUiWriterClient {
  uploaded: Array<{ fileName: string; metadata: Record<string, unknown> }> = [];
  waited: string[] = [];
  deleted: string[] = [];
  remoteFiles: OpenWebUiFile[] = [];
  failProcessing = false;

  async upload(
    fileName: string,
    _mimeType: string,
    _content: Uint8Array,
    metadata: Record<string, unknown>,
  ): Promise<OpenWebUiFile> {
    this.uploaded.push({ fileName, metadata });
    return { id: `file-${this.uploaded.length}` };
  }

  async waitUntilProcessed(fileId: string): Promise<void> {
    this.waited.push(fileId);
    if (this.failProcessing) throw new Error('processing failed');
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
    if (this.failRelease) throw new Error('redis unavailable');
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

  async getMapping(
    _bindingId: string,
    identity: string,
  ): Promise<SourceMapping | null> {
    return this.mappings.get(identity) ?? null;
  }

  async listMappings(_bindingId: string): Promise<SourceMapping[]> {
    return [...this.mappings.values()];
  }

  async setMapping(
    _bindingId: string,
    mapping: SourceMapping,
  ): Promise<void> {
    this.mappings.set(mapping.identity, mapping);
  }

  async deleteMapping(
    _bindingId: string,
    identity: string,
  ): Promise<void> {
    this.mappings.delete(identity);
  }

  async close(): Promise<void> {}
}
