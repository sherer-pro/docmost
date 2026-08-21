import { createHmac } from 'node:crypto';
import { encryptProtectedValue } from '../../../common/security/credential-protection.util';
import { OpenWebUiWriterService } from './open-webui-writer.service';
import type { RagSyncRuntimeBinding } from './rag-sync-runtime.types';

const binding: RagSyncRuntimeBinding = {
  id: 'binding-id',
  workspaceId: 'workspace-id',
  spaceId: 'space-id',
  state: 'enabled',
  adapter: 'open-webui-knowledge-v1',
  baseUrl: 'https://open-webui.example.test',
  knowledgeId: 'knowledge-id',
  writerApiKey: 'writer-secret',
  configVersion: 1,
  targetVersion: 2,
  updatedAtMs: Date.now() - 60_000,
};
const appSecret = 'test-app-secret-with-at-least-32-characters';

function createWriter() {
  const outboundPolicy = {
    resolveAllowed: jest.fn(async (rawUrl: string) => ({
      url: new URL(rawUrl),
      addresses: [{ address: '192.0.2.10', family: 4 }],
    })),
  };
  const config = {
    allowedOrigins: 'https://open-webui.example.test',
    requestTimeoutMs: 30_000,
    processingTimeoutMs: 10_000,
    maxAttachmentBytes: 1024 * 1024,
  };
  const repo = {
    findById: jest.fn().mockResolvedValue({
      ...binding,
      writerApiKeyEncrypted: encryptProtectedValue('writer-secret', appSecret),
    }),
  };
  return {
    outboundPolicy,
    writer: new OpenWebUiWriterService(
      outboundPolicy as any,
      config as any,
      repo as any,
      { getAppSecret: () => appSecret } as any,
    ),
  };
}

describe('OpenWebUiWriterService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preflights the saved target with a read-only knowledge listing', async () => {
    const { writer } = createWriter();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await writer.preflightTarget({
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      spaceId: binding.spaceId,
      adapter: binding.adapter,
      baseUrl: binding.baseUrl,
      knowledgeId: binding.knowledgeId,
      configVersion: binding.configVersion,
      targetVersion: binding.targetVersion,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain(
      `/api/v1/knowledge/${binding.knowledgeId}/files`,
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: 'GET', body: undefined }),
    );
  });

  it('does not resolve or send a remote request after abort', async () => {
    const { writer, outboundPolicy } = createWriter();
    const controller = new AbortController();
    controller.abort(new Error('lease lost'));

    await expect(
      writer.deleteFile(binding, 'file-1', controller.signal),
    ).rejects.toThrow('lease lost');
    expect(outboundPolicy.resolveAllowed).not.toHaveBeenCalled();
  });

  it('recognizes v2 ownership and compatible legacy ownership', () => {
    const { writer } = createWriter();
    const common = {
      workspaceId: binding.workspaceId,
      spaceId: binding.spaceId,
      sourceType: 'page' as const,
      sourceId: 'source-id',
      pageId: 'page-id',
      sourceUpdatedAtMs: 1,
      contentHash: 'hash',
    };

    expect(
      writer.readOwnership(
        {
          id: 'file-1',
          meta: {
            data: {
              docmost: {
                schemaVersion: 2,
                bindingId: binding.id,
                targetVersion: binding.targetVersion,
                ...signedMetadata({
                  operationId: hex(1),
                  ...common,
                }),
              },
            },
          },
        },
        binding,
      )?.schemaVersion,
    ).toBe(2);
    expect(
      writer.readOwnership(
        {
          id: 'file-2',
          meta: { data: { docmost: { schemaVersion: 1, ...common } } },
        },
        binding,
      )?.schemaVersion,
    ).toBe(1);
  });

  it('rejects metadata owned by another space', () => {
    const { writer } = createWriter();
    expect(
      writer.readOwnership(
        {
          id: 'file-1',
          meta: {
            data: {
              docmost: {
                schemaVersion: 1,
                workspaceId: binding.workspaceId,
                spaceId: 'another-space',
                sourceType: 'page',
                sourceId: 'source-id',
                pageId: 'page-id',
                sourceUpdatedAtMs: 1,
                contentHash: 'hash',
              },
            },
          },
        },
        binding,
      ),
    ).toBeNull();
  });

  it('rejects forged v2 ownership metadata', () => {
    const { writer } = createWriter();
    const metadata = signedMetadata({
      sourceType: 'page',
      sourceId: 'source-id',
      pageId: 'page-id',
      sourceUpdatedAtMs: 1,
      contentHash: hex(2),
      operationId: hex(1),
    });
    metadata.sourceUpdatedAtMs = 2;

    expect(
      writer.readOwnership(
        { id: 'file-1', meta: { data: { docmost: metadata } } },
        binding,
      ),
    ).toBeNull();
  });

  it('pins the approved address and sends an idempotency key for uploads', async () => {
    const { outboundPolicy, writer } = createWriter();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'file-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await writer.upload(binding, {
      fileName: 'page.md',
      mimeType: 'text/markdown',
      content: new TextEncoder().encode('# Page'),
      metadata: {
        schemaVersion: 2,
        bindingId: binding.id,
        targetVersion: binding.targetVersion,
        workspaceId: binding.workspaceId,
        spaceId: binding.spaceId,
        sourceType: 'page',
        sourceId: 'source-id',
        pageId: 'page-id',
        sourceUpdatedAtMs: 1,
        contentHash: 'hash',
        operationId: 'operation-id',
      },
    });

    expect(outboundPolicy.resolveAllowed).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/files/'),
      expect.objectContaining({
        allowedOrigins: 'https://open-webui.example.test',
        requireExplicitOrigin: true,
      }),
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ 'idempotency-key': 'operation-id' }),
    );
  });

  it('rejects URL credentials, denied origins, and redirects', async () => {
    const credentials = createWriter();
    await expect(
      credentials.writer.listKnowledgeFilesPage(
        {
          ...binding,
          baseUrl: 'https://user:secret@open-webui.example.test',
        },
        1,
      ),
    ).rejects.toMatchObject({ code: 'rag_sync_url_rejected' });

    const denied = createWriter();
    denied.outboundPolicy.resolveAllowed.mockRejectedValue(
      new Error('origin denied'),
    );
    await expect(
      denied.writer.listKnowledgeFilesPage(binding, 1),
    ).rejects.toMatchObject({ code: 'rag_sync_url_rejected' });

    const redirected = createWriter();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://other.example.test' },
      }),
    );
    await expect(
      redirected.writer.deleteFile(binding, 'file-1'),
    ).rejects.toMatchObject({ code: 'rag_sync_redirect_rejected' });
  });

  it('rejects an oversized remote response before buffering it', async () => {
    const { writer } = createWriter();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(9 * 1024 * 1024) },
      }),
    );

    await expect(
      writer.listKnowledgeFilesPage(binding, 1),
    ).rejects.toMatchObject({ code: 'rag_sync_invalid_response' });
  });

  it('keeps a rejected writer credential recoverable', async () => {
    const { writer } = createWriter();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 401 }));

    // Retryable keeps the supervisor from disabling the binding, so rotating the
    // key is enough to resume instead of re-enabling the space by hand.
    await expect(
      writer.listKnowledgeFilesPage(binding, 1),
    ).rejects.toMatchObject({
      code: 'rag_sync_writer_unauthorized',
      retryable: true,
    });
  });

  it('fails closed for malformed or truncated knowledge listings', async () => {
    const malformed = createWriter();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ total: 1 }), { status: 200 }),
      );
    await expect(
      malformed.writer.listKnowledgeFilesPage(binding, 1),
    ).rejects.toMatchObject({ code: 'rag_sync_invalid_response' });

    jest.restoreAllMocks();
    const truncated = createWriter();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], total: 1 }), { status: 200 }),
      );
    await expect(
      truncated.writer.listKnowledgeFilesPage(binding, 1),
    ).rejects.toMatchObject({ code: 'rag_sync_invalid_response' });

    jest.restoreAllMocks();
    const invalidItem = createWriter();
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ nope: true }], total: 1 }), {
        status: 200,
      }),
    );
    await expect(
      invalidItem.writer.listKnowledgeFilesPage(binding, 1),
    ).rejects.toMatchObject({ code: 'rag_sync_invalid_response' });
  });

  it('scans foreign pages without retaining arbitrary remote metadata', async () => {
    const { writer } = createWriter();
    const owned = signedMetadata({
      sourceType: 'page',
      sourceId: 'source-id',
      pageId: 'page-id',
      sourceUpdatedAtMs: 1,
      contentHash: hex(2),
      operationId: hex(1),
    });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: Array.from({ length: 30 }, (_, index) =>
              index === 0
                ? {
                    id: `foreign-${index}`,
                    meta: { arbitrary: 'x'.repeat(10_000) },
                  }
                : { id: `foreign-${index}` },
            ),
            total: 31,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ id: 'owned-file', meta: { data: { docmost: owned } } }],
            total: 31,
          }),
          { status: 200 },
        ),
      );

    await expect(writer.listKnowledgeFilesPage(binding, 1)).resolves.toEqual({
      items: Array.from({ length: 30 }, (_, index) => ({
        id: `foreign-${index}`,
      })),
      total: 31,
      hasMore: true,
    });
    await expect(writer.listKnowledgeFilesPage(binding, 2)).resolves.toEqual({
      items: [{ id: 'owned-file', meta: { data: { docmost: owned } } }],
      total: 31,
      hasMore: false,
    });
  });

  it('cleans stale and newly created target-test markers', async () => {
    const { writer } = createWriter();
    const staleMarker = {
      id: 'stale-marker',
      meta: {
        data: {
          docmost: signedMetadata({
            targetVersion: 1,
            sourceType: 'page',
            sourceId: binding.id,
            pageId: binding.id,
            sourceUpdatedAtMs: 1,
            contentHash: 'old-marker',
            operationId: hex(3),
            marker: 'target-test',
          }),
        },
      },
    };
    jest
      .spyOn(writer, 'listKnowledgeFilesPage')
      .mockResolvedValue({ items: [staleMarker], total: 1, hasMore: false });
    const upload = jest
      .spyOn(writer, 'upload')
      .mockResolvedValue({ id: 'new-marker' });
    jest.spyOn(writer, 'waitUntilProcessed').mockResolvedValue(undefined);
    const remove = jest
      .spyOn(writer, 'deleteFile')
      .mockResolvedValue(undefined);

    await writer.test(binding);

    expect(upload.mock.calls[0][1].metadata.marker).toBe('target-test');
    expect(remove.mock.calls.map((call) => call[1])).toEqual([
      'stale-marker',
      'new-marker',
    ]);
  });

  it('bounds stale marker discovery for target tests on a large knowledge base', async () => {
    const { writer } = createWriter();
    const page = jest
      .spyOn(writer, 'listKnowledgeFilesPage')
      .mockResolvedValue({ items: [], total: 100_000, hasMore: true });

    await (writer as any).cleanupStaleTestMarkers(binding);

    expect(page).toHaveBeenCalledTimes(20);
  });

  it('reports a failed target test when its marker cannot be removed', async () => {
    const { writer } = createWriter();
    jest.spyOn(writer, 'listKnowledgeFilesPage').mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
    });
    jest.spyOn(writer, 'upload').mockResolvedValue({ id: 'new-marker' });
    jest.spyOn(writer, 'waitUntilProcessed').mockResolvedValue(undefined);
    jest
      .spyOn(writer, 'deleteFile')
      .mockRejectedValue(new Error('cleanup failed'));

    await expect(writer.test(binding)).rejects.toThrow('cleanup failed');
  });
});

function signedMetadata(
  overrides: Partial<{
    targetVersion: number;
    sourceType: 'page' | 'database_row' | 'attachment';
    sourceId: string;
    pageId: string;
    databaseId: string;
    sourceUpdatedAtMs: number;
    contentHash: string;
    operationId: string;
    marker: 'target-test';
  }>,
) {
  const metadata = {
    schemaVersion: 2 as const,
    bindingId: binding.id,
    targetVersion: overrides.targetVersion ?? binding.targetVersion,
    workspaceId: binding.workspaceId,
    spaceId: binding.spaceId,
    sourceType: overrides.sourceType ?? ('page' as const),
    sourceId: overrides.sourceId ?? 'source-id',
    pageId: overrides.pageId ?? 'page-id',
    ...(overrides.databaseId ? { databaseId: overrides.databaseId } : {}),
    sourceUpdatedAtMs: overrides.sourceUpdatedAtMs ?? 1,
    contentHash: overrides.contentHash ?? hex(2),
    operationId: overrides.operationId ?? hex(1),
    ...(overrides.marker ? { marker: overrides.marker } : {}),
  };
  const ownershipMac = createHmac('sha256', appSecret)
    .update('docmost:rag-sync:ownership:v2\n', 'utf8')
    .update(
      JSON.stringify([
        metadata.schemaVersion,
        metadata.bindingId,
        metadata.targetVersion,
        metadata.workspaceId,
        metadata.spaceId,
        metadata.sourceType,
        metadata.sourceId,
        metadata.pageId,
        'databaseId' in metadata ? metadata.databaseId : null,
        metadata.sourceUpdatedAtMs,
        metadata.contentHash,
        metadata.operationId,
        'marker' in metadata ? metadata.marker : null,
      ]),
      'utf8',
    )
    .digest('hex');
  return { ...metadata, ownershipMac };
}

function hex(value: number): string {
  return value.toString(16).padStart(64, '0');
}
