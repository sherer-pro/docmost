import { NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  RagSyncSourceService,
  runConcurrently,
} from './rag-sync-source.service';
import { RagSyncDiagnosticError } from '../runtime/rag-sync-runtime.types';

describe('RagSyncSourceService', () => {
  const binding = {
    id: 'binding-1',
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    state: 'enabled',
    adapter: 'open-webui-knowledge-v1',
    baseUrl: 'https://open-webui.example',
    knowledgeId: 'knowledge-1',
    writerApiKey: 'writer-secret',
    configVersion: 1,
    targetVersion: 1,
    updatedAtMs: Date.now() - 60_000,
  } as const;
  const lease = {
    bindingId: binding.id,
    targetVersion: binding.targetVersion,
    token: 'lease-token',
  };
  const context = {
    lease,
    signal: new AbortController().signal,
    maxItems: 100,
    maxConcurrentDocuments: 2,
    maxAttachmentBytes: 25 * 1024 * 1024,
    pollIntervalMs: 5_000,
    requestTimeoutMs: 5_000,
    processingTimeoutMs: 30_000,
    reconcileIntervalMs: 6 * 60 * 60 * 1000,
  };
  const ragScope = {
    schemaVersion: 2,
    workspaceId: binding.workspaceId,
    spaceId: binding.spaceId,
    syncTarget: null,
    fingerprint: 'scope-fingerprint',
    excludedPageIds: [],
  } as const;

  it('waits for started siblings and stops scheduling after the first failure', async () => {
    let releaseSibling!: () => void;
    const sibling = new Promise<void>((resolve) => {
      releaseSibling = resolve;
    });
    const started: number[] = [];
    const failure = new Error('first task failed');
    let settled = false;

    const result = runConcurrently([0, 1, 2], 2, async (item) => {
      started.push(item);
      if (item === 0) throw failure;
      if (item === 1) await sibling;
    });
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual([0, 1]);
    expect(settled).toBe(false);

    releaseSibling();
    await expect(result).rejects.toBe(failure);
    expect(started).toEqual([0, 1]);
  });

  function setup(
    spaceOverrides: Record<string, unknown> = {},
    liveDatabaseRowIds: string[] = [],
    deletedSourceIds: string[] = [],
    activeDatabasePageIds: string[] = [],
    activeRowPageIds: string[] = [],
    attachmentTextById: Record<
      string,
      {
        textContent: string | null;
        contentIndexStatus: string;
        spaceId?: string | null;
      }
    > = {},
  ) {
    const db = {
      selectFrom: jest.fn((table: string) => {
        let requiresUnarchived = false;
        let selectedIds: string[] = [];
        let selectedColumn = '';
        const equality = new Map<string, unknown>();
        const joinedTables = new Set<string>();
        const query = {
          selectAll: jest.fn(() => query),
          select: jest.fn(() => query),
          innerJoin: jest.fn((joinedTable: string) => {
            joinedTables.add(joinedTable);
            return query;
          }),
          where: jest.fn((column: string, operator: string, value: unknown) => {
            if (
              column === 'archivedAt' &&
              operator === 'is' &&
              value === null
            ) {
              requiresUnarchived = true;
            }
            if (operator === 'in' && Array.isArray(value)) {
              selectedIds = value.map(String);
              selectedColumn = column;
            }
            if (operator === '=') equality.set(column, value);
            return query;
          }),
          executeTakeFirst: jest.fn(async () => {
            if (table === 'workspaces') return { id: binding.workspaceId };
            if (table === 'aiSpaceConfigs') {
              return spaceOverrides.retrievalTarget;
            }
            if (table === 'attachments') {
              const attachment =
                attachmentTextById[
                  String(
                    equality.get('attachments.id') ?? equality.get('id'),
                  )
                ];
              if (!attachment) return undefined;
              const directSpaceId =
                equality.get('attachments.spaceId') ?? equality.get('spaceId');
              if (directSpaceId && attachment.spaceId === null) {
                return undefined;
              }
              if (
                attachment.spaceId === null &&
                (!joinedTables.has('pages as attachmentPage') ||
                  equality.get('attachmentPage.spaceId') !== binding.spaceId)
              ) {
                return undefined;
              }
              return attachment;
            }
            const space = {
              id: binding.spaceId,
              workspaceId: binding.workspaceId,
              settings: {},
              ...spaceOverrides,
            };
            return requiresUnarchived && spaceOverrides.archivedAt
              ? undefined
              : space;
          }),
          execute: jest.fn(async () => {
            if (table === 'pages') {
              return selectedIds
                .filter((id) => !deletedSourceIds.includes(id))
                .map((id) => ({ id }));
            }
            if (table === 'databases') {
              if (selectedColumn === 'databases.pageId') {
                return selectedIds
                  .filter((pageId) => activeDatabasePageIds.includes(pageId))
                  .map((pageId) => ({ pageId }));
              }
              return selectedIds
                .filter((id) => !deletedSourceIds.includes(id))
                .map((databaseId, index) => ({
                  databaseId,
                  pageId: String(
                    activeDatabasePageIds[index] ??
                      equality.get('databases.pageId') ??
                      '',
                  ),
                }));
            }
            if (table === 'databaseRows') {
              if (selectedColumn === 'databaseRows.pageId') {
                return selectedIds
                  .filter((pageId) => activeRowPageIds.includes(pageId))
                  .map((pageId) => ({ pageId }));
              }
              return liveDatabaseRowIds
                .filter(
                  (id) => selectedIds.length === 0 || selectedIds.includes(id),
                )
                .map((id) => ({
                  id,
                  sourceId: id,
                  pageId: '',
                  databaseId: '',
                }));
            }
            if (table === 'attachments') {
              return selectedIds
                .filter((id) => !deletedSourceIds.includes(id))
                .map((sourceId) => ({ sourceId, pageId: '' }));
            }
            return [];
          }),
        };
        return query;
      }),
    };
    const rag = {
      getScope: jest.fn().mockResolvedValue(ragScope),
      getDeleted: jest.fn().mockResolvedValue(emptyFeed('maxDeletedAtMs')),
      getAttachmentDeleted: jest
        .fn()
        .mockResolvedValue(emptyFeed('maxDeletedAtMs')),
      getDictionaryDeleted: jest
        .fn()
        .mockResolvedValue(emptyFeed('maxDeletedAtMs')),
      getUpdates: jest.fn().mockResolvedValue(emptyFeed('maxUpdatedAtMs')),
      getAttachmentUpdates: jest
        .fn()
        .mockResolvedValue(emptyFeed('maxUpdatedAtMs')),
      getDictionaryUpdates: jest
        .fn()
        .mockResolvedValue(emptyFeed('maxUpdatedAtMs')),
      getDictionaryTerm: jest.fn(),
      getPageInfo: jest.fn(),
      getDatabaseSyncMetadata: jest.fn(),
      getDatabaseSyncRowsPage: jest
        .fn()
        .mockResolvedValue({ items: [], hasMore: false, nextCursor: null }),
      resolveAttachmentForDownload: jest.fn(),
    };
    const state = {
      getTimeMs: jest
        .fn()
        .mockImplementation(() => Promise.resolve(Date.now())),
      getScopeFingerprint: jest.fn().mockResolvedValue(effectiveFingerprint()),
      setScopeFingerprint: jest.fn(),
      getReconcileAt: jest.fn().mockResolvedValue(Date.now() + 60_000),
      setReconcileAt: jest.fn(),
      getFeedProgress: jest.fn().mockResolvedValue(null),
      setFeedProgress: jest.fn(),
      getDrainStartedAt: jest
        .fn()
        .mockResolvedValue(binding.updatedAtMs - 60_000),
      setDrainStartedAt: jest.fn(),
      getDrainEmptyObservedAt: jest.fn().mockResolvedValue(null),
      setDrainEmptyObservedAt: jest.fn(),
      getDatabaseWorkProgress: jest.fn().mockResolvedValue(null),
      setDatabaseWorkProgress: jest.fn(),
      deleteDatabaseWorkProgress: jest.fn(),
      clearDatabaseWorkProgress: jest.fn(),
      getCheckpoint: jest.fn().mockResolvedValue(0),
      setCheckpoint: jest.fn(),
      getMapping: jest.fn().mockResolvedValue(null),
      setMapping: jest.fn(),
      deleteMapping: jest.fn(),
      getUploadIntent: jest.fn().mockResolvedValue(null),
      hasUploadIntents: jest.fn().mockResolvedValue(false),
      setUploadIntent: jest.fn(),
      deleteUploadIntent: jest.fn(),
      getRemoteScanProgress: jest.fn().mockResolvedValue(null),
      setRemoteScanProgress: jest.fn(),
      clearRemoteScanSeen: jest.fn(),
      markRemoteScanFileIds: jest.fn(),
      scanMappings: jest.fn().mockResolvedValue({
        cursor: '0',
        items: [],
        hasMore: false,
        ackToken: null,
      }),
      scanUploadIntents: jest.fn().mockResolvedValue({
        cursor: '0',
        items: [],
        hasMore: false,
        ackToken: null,
      }),
      clearScanOverflow: jest.fn(),
      ackScanBatch: jest.fn(),
      wasRemoteScanFileIdSeen: jest.fn().mockResolvedValue(true),
      clearTargetState: jest.fn(),
    };
    const writer = {
      listKnowledgeFilesPage: jest.fn().mockResolvedValue(listing([])),
      getFile: jest.fn().mockResolvedValue(null),
      readOwnership: jest.fn().mockReturnValue(null),
      findOwnedFileByOperationId: jest.fn(),
      upload: jest.fn(),
      waitUntilProcessed: jest.fn(),
      deleteFile: jest.fn(),
    };
    const storage = { readStream: jest.fn() };
    const service = new RagSyncSourceService(
      db as any,
      rag as any,
      storage as any,
      writer as any,
      state as any,
      { run: jest.fn(async (_bytes, _signal, callback) => callback()) } as any,
    );
    return { service, rag, state, writer, storage };
  }

  it('keeps archived spaces available for draining and cleanup', async () => {
    const { service } = setup({ archivedAt: new Date() });

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({ hasMore: false });
  });

  it('stops before writes when the Open WebUI retrieval target does not match', async () => {
    const { service, writer } = setup({
      retrievalTarget: {
        retrievalAdapter: 'open-webui-knowledge-v1',
        retrievalOpenWebuiBaseUrl: 'https://other-open-webui.example',
        retrievalOpenWebuiKnowledgeId: 'other-knowledge',
      },
    });

    await expect(
      service.processQuantum(binding, context),
    ).rejects.toMatchObject({
      originalError: expect.objectContaining({
        code: 'rag_sync_target_mismatch',
        retryable: false,
      }),
    });
    expect(writer.upload).not.toHaveBeenCalled();
  });

  it('processes deletions before update feeds and advances the checkpoint', async () => {
    const { service, rag, state, writer } = setup();
    const mapping = {
      identity: 'page:page-1',
      fileId: 'file-1',
      operationId: 'operation-1',
      contentHash: 'hash-1',
      sourceType: 'page',
      sourceId: 'page-1',
      pageId: 'page-1',
      updatedAtMs: 10,
    };
    state.getMapping.mockResolvedValue(mapping);
    writer.getFile.mockResolvedValue({ id: 'file-1' });
    writer.readOwnership.mockReturnValue({
      schemaVersion: 2,
      metadata: {
        sourceType: 'page',
        sourceId: 'page-1',
        contentHash: 'hash-1',
        operationId: 'operation-1',
      },
    });
    rag.getDeleted.mockResolvedValue({
      items: [
        {
          type: 'page',
          id: 'page-1',
          deletedAt: new Date(100),
          deletedAtMs: 100,
        },
      ],
      maxDeletedAtMs: 100,
      hasMore: false,
      nextCursor: null,
    });

    const result = await service.processQuantum(binding, context);

    expect(result).toMatchObject({ hasMore: true, processedCount: 1 });
    expect(state.getMapping).toHaveBeenCalledWith(lease, 'page:page-1');
    expect(writer.getFile).toHaveBeenCalledWith(
      binding,
      'file-1',
      context.signal,
    );
    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      'file-1',
      context.signal,
    );
    expect(state.deleteMapping).toHaveBeenCalledWith(lease, 'page:page-1');
    expect(state.setCheckpoint).toHaveBeenCalledWith(lease, 'deleted', 101);
    expect(rag.getUpdates).not.toHaveBeenCalled();
  });

  it('uploads one dictionary term with nullable page ownership metadata', async () => {
    const { service, rag, state, writer } = setup();
    rag.getDictionaryUpdates.mockResolvedValue({
      items: [
        {
          type: 'dictionaryTerm',
          id: 'term-1',
          term: 'Projection',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getDictionaryTerm.mockResolvedValue({
      id: 'term-1',
      term: 'Projection',
      knowledgeMarkdown:
        '# Projection\n\n## Word forms\n\n- Projections\n\n## Definition\n\nCanonical knowledge view.',
      updatedAtMs: 200,
    });
    writer.upload.mockResolvedValue({ id: 'dictionary-file' });

    await service.processQuantum(binding, context);

    expect(writer.upload).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({
        fileName: expect.stringContaining('Projection'),
        metadata: expect.objectContaining({
          sourceType: 'dictionary_term',
          sourceId: 'term-1',
          pageId: null,
        }),
      }),
      context.signal,
    );
    expect(state.setMapping).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        sourceType: 'dictionary_term',
        sourceId: 'term-1',
        pageId: null,
        fileId: 'dictionary-file',
      }),
    );
  });

  it('does not delete a remote file when a Redis mapping is corrupted', async () => {
    const { service, rag, state, writer } = setup();
    state.getMapping.mockResolvedValue({
      identity: 'page:page-1',
      fileId: 'file-foreign',
      operationId: 'operation-1',
      contentHash: 'hash-1',
      sourceType: 'page',
      sourceId: 'page-1',
      pageId: 'page-1',
      updatedAtMs: 10,
    });
    writer.getFile.mockResolvedValue({ id: 'file-foreign' });
    writer.readOwnership.mockReturnValue(null);
    rag.getDeleted.mockResolvedValue({
      items: [{ type: 'page', id: 'page-1', deletedAtMs: 100 }],
      maxDeletedAtMs: 100,
      hasMore: false,
      nextCursor: null,
    });

    await service.processQuantum(binding, context);

    expect(writer.deleteFile).not.toHaveBeenCalled();
    expect(state.deleteMapping).toHaveBeenCalledWith(lease, 'page:page-1');
  });

  it('replays updates so an archived database row can become a regular page', async () => {
    const { service, rag, state, writer } = setup();
    rag.getDeleted
      .mockResolvedValueOnce({
        items: [
          {
            type: 'databaseRow',
            id: 'page-1',
            rowId: 'row-1',
            databaseId: 'database-1',
            deletedAtMs: 100,
          },
        ],
        maxDeletedAtMs: 100,
        hasMore: false,
        nextCursor: null,
      })
      .mockResolvedValue(emptyFeed('maxDeletedAtMs'));
    rag.getUpdates.mockResolvedValue({
      items: [{ type: 'page', id: 'page-1', updatedAtMs: 50 }],
      maxUpdatedAtMs: 50,
      hasMore: false,
      nextCursor: null,
    });
    rag.getPageInfo.mockResolvedValue({
      id: 'page-1',
      title: 'Converted page',
      contentMarkdown: 'Live content',
    });
    writer.upload.mockResolvedValue({ id: 'converted-file' });

    await service.processQuantum(binding, context);

    expect(state.setCheckpoint).toHaveBeenCalledWith(lease, 'updates', 0);
    expect(state.setFeedProgress).toHaveBeenCalledWith(lease, 'updates', null);

    await service.processQuantum(binding, context);

    expect(writer.upload).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceType: 'page',
          sourceId: 'page-1',
        }),
      }),
      context.signal,
    );
  });

  it('replays updates so a deleted database node can become a regular page', async () => {
    const { service, rag, state, writer } = setup();
    rag.getDeleted
      .mockResolvedValueOnce({
        items: [
          {
            type: 'database',
            id: 'page-1',
            databaseId: 'database-1',
            deletedAtMs: 100,
          },
        ],
        maxDeletedAtMs: 100,
        hasMore: false,
        nextCursor: null,
      })
      .mockResolvedValue(emptyFeed('maxDeletedAtMs'));
    rag.getUpdates.mockResolvedValue({
      items: [{ type: 'page', id: 'page-1', updatedAtMs: 50 }],
      maxUpdatedAtMs: 50,
      hasMore: false,
      nextCursor: null,
    });
    rag.getPageInfo.mockResolvedValue({
      id: 'page-1',
      title: 'Converted database page',
      contentMarkdown: 'Live content',
    });
    writer.upload.mockResolvedValue({ id: 'converted-database-file' });

    await service.processQuantum(binding, context);

    expect(state.setCheckpoint).toHaveBeenCalledWith(lease, 'updates', 0);
    expect(state.setFeedProgress).toHaveBeenCalledWith(lease, 'updates', null);

    await service.processQuantum(binding, context);

    expect(writer.upload).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceType: 'page',
          sourceId: 'page-1',
        }),
      }),
      context.signal,
    );
  });

  it('adopts an existing operation instead of repeating an upload', async () => {
    const { service, rag, state, writer } = setup();
    const remote = { id: 'file-existing' };
    rag.getUpdates.mockResolvedValue({
      items: [
        {
          type: 'page',
          id: 'page-1',
          updatedAt: new Date(200),
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getPageInfo.mockResolvedValue({
      id: 'page-1',
      title: 'Page',
      contentMarkdown: 'Content',
    });
    state.getUploadIntent.mockResolvedValue({
      operationId: hex(123),
      identity: 'page:page-1',
      configVersion: 1,
      createdAt: 0,
      notBefore: 0,
      scanPage: 1,
      scanPass: 1,
    });
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([remote]));
    writer.findOwnedFileByOperationId.mockReturnValue(remote);

    const result = await service.processQuantum(binding, context);

    expect(result).toMatchObject({ hasMore: true, processedCount: 1 });
    expect(writer.upload).not.toHaveBeenCalled();
    expect(state.setMapping).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        identity: 'page:page-1',
        fileId: remote.id,
        sourceId: 'page-1',
      }),
    );
  });

  it('reconciles pending upload intents before the periodic deadline', async () => {
    const { service, rag, state, writer } = setup();
    const operationId = hex(124);
    const failed = {
      ...remoteFile('failed-file', {
        sourceId: 'page-1',
        pageId: 'page-1',
        operationId,
      }),
      data: { status: 'failed' },
    };
    state.hasUploadIntents.mockResolvedValue(true);
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([failed]));
    writer.readOwnership.mockImplementation((file: any) => file.ownership);

    await service.processQuantum(binding, context);

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      failed.id,
      context.signal,
    );
    expect(state.deleteUploadIntent).toHaveBeenCalledWith(lease, operationId);
    expect(rag.getUpdates).not.toHaveBeenCalled();
  });

  it('cleans a superseded upload intent without deleting the current mapping', async () => {
    const { service, state, writer } = setup();
    const staleOperationId = hex(125);
    const currentOperationId = hex(126);
    const intent = {
      operationId: staleOperationId,
      identity: 'attachment:attachment-1',
      sourceType: 'attachment' as const,
      sourceId: 'attachment-1',
      pageId: 'page-1',
      configVersion: binding.configVersion,
      createdAt: 1,
      notBefore: 2,
    };
    const stale = remoteFile('stale-file', {
      sourceType: 'attachment',
      sourceId: 'attachment-1',
      pageId: 'page-1',
      operationId: staleOperationId,
    });
    state.hasUploadIntents.mockResolvedValue(true);
    state.getRemoteScanProgress.mockResolvedValue({
      configVersion: binding.configVersion,
      phase: 'intents',
      page: 1,
      mappingCursor: '0',
      expectedTotal: 1,
      scopeFingerprint: effectiveFingerprint(),
    });
    state.scanUploadIntents.mockResolvedValue({
      cursor: '0',
      items: [intent],
      hasMore: false,
      ackToken: null,
    });
    state.getMapping.mockResolvedValue({
      identity: intent.identity,
      fileId: 'current-file',
      operationId: currentOperationId,
      contentHash: hex(127),
      sourceType: intent.sourceType,
      sourceId: intent.sourceId,
      pageId: intent.pageId,
      updatedAtMs: 3,
    });
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([stale]));
    writer.findOwnedFileByOperationId.mockReturnValue(stale);

    await service.processQuantum(binding, context);

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      stale.id,
      context.signal,
    );
    expect(state.deleteUploadIntent).toHaveBeenCalledWith(
      lease,
      staleOperationId,
    );
    expect(state.deleteMapping).not.toHaveBeenCalled();
  });

  it('isolates concurrent ambiguous upload scans by operation id', async () => {
    const { service, state, writer } = setup();
    state.getTimeMs.mockResolvedValue(10_000);
    const sources = [
      syncSource('page:page-1', 'page-1', 'First'),
      syncSource('page:page-2', 'page-2', 'Second'),
    ];
    const intents = new Map(
      sources.map((source) => {
        const operationId = operationIdForSource(source);
        return [
          operationId,
          {
            operationId,
            identity: source.identity,
            configVersion: binding.configVersion,
            createdAt: 1,
            notBefore: 1,
            scanPage: 1,
            scanPass: 1 as const,
          },
        ];
      }),
    );
    state.getUploadIntent.mockImplementation(
      (_lease: unknown, operationId: string) =>
        Promise.resolve(intents.get(operationId) ?? null),
    );
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([]));

    await Promise.all(
      sources.map((source) =>
        (service as any).upsertSource(
          {
            binding,
            context,
            scope: {
              accessMode: 'system',
              workspace: { id: binding.workspaceId },
              space: { id: binding.spaceId },
            },
            ragScope,
            processedCount: 0,
            lagMs: null,
          },
          source,
          true,
        ),
      ),
    );

    const operationIds = [...intents.keys()].sort();
    const markedPurposes = state.markRemoteScanFileIds.mock.calls
      .map((call) => call[1])
      .filter((purpose) => purpose?.kind === 'intent')
      .map((purpose) => purpose.operationId)
      .sort();
    expect(markedPurposes).toEqual(operationIds);
    expect(state.clearRemoteScanSeen).not.toHaveBeenCalledWith(lease, 'intent');
  });

  it('uses Redis time for upload intent safety deadlines', async () => {
    const { service, rag, state, writer } = setup();
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(1);
    state.getTimeMs.mockResolvedValue(123_456);
    rag.getUpdates.mockResolvedValue({
      items: [{ type: 'page', id: 'page-1', updatedAtMs: 200 }],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getPageInfo.mockResolvedValue({
      id: 'page-1',
      title: 'Page',
      contentMarkdown: 'Content',
    });
    writer.upload.mockResolvedValue({ id: 'file-1' });

    try {
      await service.processQuantum(binding, context);
    } finally {
      dateNow.mockRestore();
    }

    expect(state.setUploadIntent).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        createdAt: 123_456,
        notBefore: 158_456,
      }),
    );
  });

  it('treats a page removed after feed creation as a deletion', async () => {
    const { service, rag, state, writer } = setup();
    rag.getUpdates.mockResolvedValue({
      items: [{ type: 'page', id: 'page-1', updatedAtMs: 200 }],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getPageInfo.mockRejectedValue(new NotFoundException('Page not found'));

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({ hasMore: true, processedCount: 1 });

    expect(state.getMapping).toHaveBeenCalledWith(lease, 'page:page-1');
    expect(state.setCheckpoint).toHaveBeenCalledWith(lease, 'updates', 201);
    expect(writer.upload).not.toHaveBeenCalled();
  });

  it('treats a database removed after feed creation as a deletion', async () => {
    const { service, rag, state } = setup();
    rag.getUpdates.mockResolvedValue({
      items: [
        {
          type: 'database',
          id: 'database-page-1',
          databaseId: 'database-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getDatabaseSyncMetadata.mockRejectedValue(
      new NotFoundException('Database not found'),
    );

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({ hasMore: true, processedCount: 1 });

    expect(state.deleteDatabaseWorkProgress).toHaveBeenCalledWith(
      lease,
      'delete',
      'database-1',
    );
    expect(state.setCheckpoint).toHaveBeenCalledWith(lease, 'updates', 201);
    expect(rag.getDatabaseSyncRowsPage).not.toHaveBeenCalled();
  });

  it('treats an attachment removed after feed creation as a deletion', async () => {
    const { service, rag, state, storage, writer } = setup();
    rag.getAttachmentUpdates.mockResolvedValue({
      items: [
        {
          id: 'attachment-1',
          fileName: 'attachment.txt',
          fileExt: '.txt',
          mimeType: 'text/plain',
          fileSize: 100,
          pageId: 'page-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.resolveAttachmentForDownload.mockRejectedValue(
      new NotFoundException('File not found'),
    );

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({ hasMore: true, processedCount: 1 });

    expect(state.getMapping).toHaveBeenCalledWith(
      lease,
      'attachment:attachment-1',
    );
    expect(state.setCheckpoint).toHaveBeenCalledWith(
      lease,
      'attachment-updates',
      201,
    );
    expect(storage.readStream).not.toHaveBeenCalled();
    expect(writer.upload).not.toHaveBeenCalled();
  });

  it('uploads extracted text for PDF attachments when local indexing is ready', async () => {
    const { service, rag, state, storage, writer } = setup(
      {},
      [],
      [],
      [],
      [],
      {
        'attachment-1': {
          textContent: 'Extracted searchable content',
          contentIndexStatus: 'ready',
          spaceId: null,
        },
      },
    );
    rag.getAttachmentUpdates.mockResolvedValue({
      items: [
        {
          id: 'attachment-1',
          fileName: 'guide.pdf',
          fileExt: '.pdf',
          mimeType: 'application/pdf',
          fileSize: 100,
          pageId: 'page-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    writer.upload.mockResolvedValue({ id: 'attachment-file' });

    await service.processQuantum(binding, context);

    expect(writer.upload).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({
        fileName: 'guide.pdf-attachment-1.md',
        mimeType: 'text/markdown',
        content: expect.any(Uint8Array),
        metadata: expect.objectContaining({
          sourceType: 'attachment',
          sourceId: 'attachment-1',
          pageId: 'page-1',
        }),
      }),
      context.signal,
    );
    const upload = writer.upload.mock.calls[0][1];
    expect(new TextDecoder().decode(upload.content)).toBe(
      '# guide.pdf\n\nExtracted searchable content',
    );
    expect(rag.resolveAttachmentForDownload).not.toHaveBeenCalled();
    expect(storage.readStream).not.toHaveBeenCalled();
    expect(state.setMapping).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        sourceType: 'attachment',
        sourceId: 'attachment-1',
        fileId: 'attachment-file',
      }),
    );
  });

  it('uses distinct remote names for attachments with the same source name', async () => {
    const { service, rag, writer } = setup(
      {},
      [],
      [],
      [],
      [],
      {
        'attachment-1': {
          textContent: 'First extracted content',
          contentIndexStatus: 'ready',
        },
        'attachment-2': {
          textContent: 'Second extracted content',
          contentIndexStatus: 'ready',
        },
      },
    );
    rag.getAttachmentUpdates.mockResolvedValue({
      items: [
        {
          id: 'attachment-1',
          fileName: 'guide.pdf',
          fileExt: '.pdf',
          mimeType: 'application/pdf',
          fileSize: 100,
          pageId: 'page-1',
          updatedAtMs: 200,
        },
        {
          id: 'attachment-2',
          fileName: 'guide.pdf',
          fileExt: '.pdf',
          mimeType: 'application/pdf',
          fileSize: 100,
          pageId: 'page-2',
          updatedAtMs: 201,
        },
      ],
      maxUpdatedAtMs: 201,
      hasMore: false,
      nextCursor: null,
    });
    writer.upload
      .mockResolvedValueOnce({ id: 'attachment-file-1' })
      .mockResolvedValueOnce({ id: 'attachment-file-2' });

    await service.processQuantum(binding, context);

    expect(writer.upload).toHaveBeenCalledTimes(2);
    expect(
      writer.upload.mock.calls.map((call) => call[1].fileName).sort(),
    ).toEqual(['guide.pdf-attachment-1.md', 'guide.pdf-attachment-2.md']);
  });

  it('adds only safe feed stage and source-kind diagnostics to unknown errors', async () => {
    const { service, rag } = setup();
    rag.getUpdates.mockResolvedValue({
      items: [{ type: 'page', id: 'page-1', updatedAtMs: 200 }],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getPageInfo.mockRejectedValue(new TypeError('simulated failure'));

    let failure: unknown;
    try {
      await service.processQuantum(binding, context);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(RagSyncDiagnosticError);
    expect(failure).toMatchObject({
      stage: 'feed:updates',
      sourceKind: 'page',
      originalError: expect.any(TypeError),
    });
    expect(failure).not.toHaveProperty('sourceId');
  });

  it('destroys a blocked attachment stream when the quantum is aborted', async () => {
    const { service, storage } = setup();
    const stream = new Readable({ read: jest.fn() });
    const controller = new AbortController();
    storage.readStream.mockResolvedValue(stream);

    const reading = (service as any).readAttachmentBounded(
      'attachment.bin',
      1024,
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(new DOMException('Stopped', 'AbortError'));

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(stream.destroyed).toBe(true);
  });

  it('propagates abort while acquiring an attachment stream', async () => {
    const { service, storage } = setup();
    const controller = new AbortController();
    storage.readStream.mockImplementation(
      (_filePath: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );

    const reading = (service as any).readAttachmentBounded(
      'attachment.bin',
      1024,
      controller.signal,
    );
    controller.abort(new DOMException('Stopped', 'AbortError'));

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(storage.readStream).toHaveBeenCalledWith(
      'attachment.bin',
      controller.signal,
    );
  });

  it('uploads a new operation when the authoritative source tuple changes with identical content', async () => {
    const { service, state, writer } = setup();
    const oldSource = syncSource('page:page-1', 'page-1', 'Same content');
    const newSource = syncSource(
      'page:page-1',
      'page-1',
      'Same content',
      'database-1',
    );
    const contentHash = createHash('sha256')
      .update(oldSource.content)
      .digest('hex');
    const oldOperationId = operationIdForSource(oldSource);
    state.getMapping.mockResolvedValue({
      identity: oldSource.identity,
      fileId: 'old-file',
      operationId: oldOperationId,
      contentHash,
      sourceType: oldSource.sourceType,
      sourceId: oldSource.sourceId,
      pageId: oldSource.pageId,
      updatedAtMs: oldSource.updatedAtMs,
    });
    writer.upload.mockResolvedValue({ id: 'new-file' });
    writer.getFile.mockResolvedValue({ id: 'old-file' });
    writer.readOwnership.mockReturnValue({
      schemaVersion: 2,
      metadata: {
        sourceType: oldSource.sourceType,
        sourceId: oldSource.sourceId,
        pageId: oldSource.pageId,
        contentHash,
        operationId: oldOperationId,
      },
    });

    await (service as any).upsertSource(
      {
        binding,
        context,
        scope: {
          accessMode: 'system',
          workspace: { id: binding.workspaceId },
          space: { id: binding.spaceId },
        },
        ragScope,
        processedCount: 0,
        lagMs: null,
      },
      newSource,
      true,
    );

    expect(writer.upload).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({
        metadata: expect.objectContaining({
          databaseId: 'database-1',
          operationId: operationIdForSource(newSource),
        }),
      }),
      context.signal,
    );
    expect(operationIdForSource(newSource)).not.toBe(oldOperationId);
    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      'old-file',
      context.signal,
    );
  });

  it('marks an ambiguous earlier upload for cleanup when a page becomes empty', async () => {
    const { service, rag, state, writer } = setup();
    const intent = {
      operationId: hex(71),
      identity: 'page:page-1',
      sourceType: 'page' as const,
      sourceId: 'page-1',
      pageId: 'page-1',
      configVersion: binding.configVersion,
      createdAt: 1,
      notBefore: 2,
    };
    rag.getUpdates.mockResolvedValue({
      items: [{ type: 'page', id: 'page-1', updatedAtMs: 200 }],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getPageInfo.mockResolvedValue({
      id: 'page-1',
      title: ' ',
      contentMarkdown: '',
    });
    state.scanUploadIntents.mockResolvedValue({ cursor: '0', items: [intent] });

    await service.processQuantum(binding, context);

    expect(writer.upload).not.toHaveBeenCalled();
    expect(state.setUploadIntent).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        operationId: intent.operationId,
        cleanupRequested: true,
      }),
    );
    expect(state.setReconcileAt).toHaveBeenCalledWith(lease, 0);
  });

  it('marks an ambiguous earlier upload for cleanup when an attachment becomes unsupported', async () => {
    const { service, rag, state } = setup();
    const intent = {
      operationId: hex(72),
      identity: 'attachment:attachment-1',
      sourceType: 'attachment' as const,
      sourceId: 'attachment-1',
      pageId: 'page-1',
      configVersion: binding.configVersion,
      createdAt: 1,
      notBefore: 2,
    };
    rag.getAttachmentUpdates.mockResolvedValue({
      items: [
        {
          id: 'attachment-1',
          fileName: 'archive.zip',
          fileExt: '.zip',
          mimeType: 'application/zip',
          fileSize: 100,
          pageId: 'page-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    state.scanUploadIntents.mockResolvedValue({ cursor: '0', items: [intent] });

    await service.processQuantum(binding, context);

    expect(rag.resolveAttachmentForDownload).not.toHaveBeenCalled();
    expect(state.setUploadIntent).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        operationId: intent.operationId,
        cleanupRequested: true,
      }),
    );
  });

  it('does not send raster images to an Open WebUI document index', async () => {
    const { service, rag, state, writer } = setup();
    rag.getAttachmentUpdates.mockResolvedValue({
      items: [
        {
          id: 'attachment-1',
          fileName: 'diagram.png',
          fileExt: '.png',
          mimeType: 'image/png',
          fileSize: 100,
          pageId: 'page-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({ hasMore: true, processedCount: 1 });

    expect(rag.resolveAttachmentForDownload).not.toHaveBeenCalled();
    expect(writer.upload).not.toHaveBeenCalled();
    expect(state.setCheckpoint).toHaveBeenCalledWith(
      lease,
      'attachment-updates',
      201,
    );
  });

  it('persists database row progress and never exceeds the quantum budget', async () => {
    const { service, rag, state, writer } = setup();
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: `row-${String(index).padStart(3, '0')}`,
      pageId: `row-page-${String(index).padStart(3, '0')}`,
      pageTitle: `Row ${index}`,
      rowMarkdown: `Content ${index}`,
      cells: [],
    }));
    rag.getUpdates.mockResolvedValue({
      items: [
        {
          type: 'database',
          id: 'database-page-1',
          databaseId: 'database-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getDatabaseSyncMetadata.mockResolvedValue({
      id: 'database-page-1',
      databaseId: 'database-1',
      title: 'Database',
      knowledgeMarkdown: 'Database content',
    });
    rag.getDatabaseSyncRowsPage.mockResolvedValue({
      items: rows.slice(0, 99),
      hasMore: true,
      nextCursor: 'row-cursor-99',
    });
    writer.upload.mockImplementation(async () => ({
      id: `file-${writer.upload.mock.calls.length}`,
    }));

    const result = await service.processQuantum(binding, {
      ...context,
      maxItems: 250,
    });

    expect(result).toMatchObject({ hasMore: true, processedCount: 100 });
    expect(rag.getUpdates).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.objectContaining({ limit: 1 }),
    );
    expect(writer.upload).toHaveBeenCalledTimes(100);
    expect(state.setMapping).toHaveBeenCalledTimes(100);
    expect(rag.getDatabaseSyncRowsPage).toHaveBeenCalledWith(
      expect.anything(),
      'database-1',
      { limit: 99 },
    );
    expect(state.setDatabaseWorkProgress).toHaveBeenLastCalledWith(
      lease,
      expect.objectContaining({
        operation: 'upsert',
        databaseId: 'database-1',
        phase: 'rows',
        rowCursor: 'row-cursor-99',
      }),
    );
    expect(state.deleteDatabaseWorkProgress).not.toHaveBeenCalled();
    expect(state.setCheckpoint).not.toHaveBeenCalledWith(
      lease,
      'updates',
      expect.anything(),
    );
  });

  it('resumes a database update from the fenced row offset', async () => {
    const { service, rag, state, writer } = setup();
    const rows = Array.from({ length: 102 }, (_, index) => ({
      id: `row-${String(index).padStart(3, '0')}`,
      pageId: `row-page-${String(index).padStart(3, '0')}`,
      pageTitle: `Row ${index}`,
      cells: [],
    }));
    rag.getUpdates.mockResolvedValue({
      items: [
        {
          type: 'database',
          id: 'database-page-1',
          databaseId: 'database-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getDatabaseSyncMetadata.mockResolvedValue({
      id: 'database-page-1',
      databaseId: 'database-1',
      title: 'Database',
    });
    rag.getDatabaseSyncRowsPage.mockResolvedValue({
      items: rows.slice(99, 101),
      hasMore: true,
      nextCursor: 'row-cursor-101',
    });
    state.getDatabaseWorkProgress.mockResolvedValue({
      operation: 'upsert',
      databaseId: 'database-1',
      pageId: 'database-page-1',
      sourceUpdatedAtMs: 200,
      phase: 'rows',
      rowCursor: 'row-cursor-99',
      mappingCursor: '0',
      mappingChangedInPass: false,
    });
    writer.upload.mockImplementation(async () => ({
      id: `file-${writer.upload.mock.calls.length}`,
    }));

    const result = await service.processQuantum(binding, {
      ...context,
      maxItems: 2,
    });

    expect(result).toMatchObject({ hasMore: true, processedCount: 2 });
    expect(
      writer.upload.mock.calls.map((call) => call[1].metadata.sourceId),
    ).toEqual(['row-099', 'row-100']);
    expect(rag.getDatabaseSyncRowsPage).toHaveBeenCalledWith(
      expect.anything(),
      'database-1',
      { cursor: 'row-cursor-99', limit: 2 },
    );
    expect(state.setDatabaseWorkProgress).toHaveBeenLastCalledWith(
      lease,
      expect.objectContaining({ rowCursor: 'row-cursor-101' }),
    );
    expect(state.deleteDatabaseWorkProgress).not.toHaveBeenCalled();
  });

  it('deletes an excluded database without loading its metadata', async () => {
    const { service, rag, state } = setup();
    rag.getScope.mockResolvedValue({
      ...ragScope,
      excludedPageIds: ['database-page-1'],
    });
    rag.getUpdates.mockResolvedValue({
      items: [
        {
          type: 'database',
          id: 'database-page-1',
          databaseId: 'database-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });

    const result = await service.processQuantum(binding, context);

    expect(result).toMatchObject({ hasMore: true, processedCount: 1 });
    expect(rag.getDatabaseSyncMetadata).not.toHaveBeenCalled();
    expect(state.scanMappings).toHaveBeenCalledWith(
      lease,
      '0',
      99,
      'database-delete:database-1',
    );
    expect(state.deleteDatabaseWorkProgress).toHaveBeenCalledWith(
      lease,
      'delete',
      'database-1',
    );
  });

  it('bounds stale database-row reconciliation with a persistent cursor', async () => {
    const { service, rag, state, writer } = setup({}, ['row-000', 'row-002']);
    const mappings = Array.from({ length: 5 }, (_, index) => ({
      identity: `database_row:row-${String(index).padStart(3, '0')}`,
      fileId: `file-${String(index).padStart(3, '0')}`,
      operationId: hex(index + 1),
      contentHash: hex(index + 11),
      sourceType: 'database_row',
      sourceId: `row-${String(index).padStart(3, '0')}`,
      pageId: `row-page-${String(index).padStart(3, '0')}`,
      databaseId: 'database-1',
      updatedAtMs: index + 1,
    }));
    const mappingsByIdentity = new Map(
      mappings.map((mapping) => [mapping.identity, mapping]),
    );
    state.scanMappings.mockResolvedValue({
      cursor: '17',
      items: mappings.slice(0, 3),
      hasMore: true,
      ackToken: 'stale-row-batch',
    });
    state.getMapping.mockImplementation((_lease: unknown, identity: string) =>
      Promise.resolve(mappingsByIdentity.get(identity) ?? null),
    );
    state.getDatabaseWorkProgress.mockResolvedValue({
      operation: 'upsert',
      databaseId: 'database-1',
      pageId: 'database-page-1',
      sourceUpdatedAtMs: 200,
      phase: 'stale-rows',
      rowCursor: null,
      mappingCursor: '0',
      mappingChangedInPass: false,
    });
    rag.getUpdates.mockResolvedValue({
      items: [
        {
          type: 'database',
          id: 'database-page-1',
          databaseId: 'database-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getDatabaseSyncMetadata.mockResolvedValue({
      id: 'database-page-1',
      databaseId: 'database-1',
      title: 'Database',
    });
    writer.getFile.mockImplementation((_binding: unknown, fileId: string) =>
      Promise.resolve({ id: fileId }),
    );
    writer.readOwnership.mockImplementation((file: { id: string }) => {
      const mapping = mappings.find(
        (candidate) => candidate.fileId === file.id,
      );
      return mapping
        ? {
            schemaVersion: 2,
            metadata: {
              sourceType: mapping.sourceType,
              sourceId: mapping.sourceId,
              contentHash: mapping.contentHash,
              operationId: mapping.operationId,
            },
          }
        : null;
    });

    const result = await service.processQuantum(binding, {
      ...context,
      maxItems: 3,
    });

    expect(result).toMatchObject({ hasMore: true, processedCount: 3 });
    expect(writer.deleteFile).toHaveBeenCalledTimes(1);
    expect(state.deleteMapping).toHaveBeenCalledWith(
      lease,
      'database_row:row-001',
    );
    expect(state.setDatabaseWorkProgress).toHaveBeenLastCalledWith(
      lease,
      expect.objectContaining({
        phase: 'stale-rows',
        mappingCursor: '17',
        mappingChangedInPass: true,
      }),
    );
    expect(state.deleteDatabaseWorkProgress).not.toHaveBeenCalled();
  });

  it('repeats stale-row HSCAN until a complete pass makes no deletions', async () => {
    const { service, rag, state } = setup();
    state.getDatabaseWorkProgress.mockResolvedValue({
      operation: 'upsert',
      databaseId: 'database-1',
      pageId: 'database-page-1',
      sourceUpdatedAtMs: 200,
      phase: 'stale-rows',
      rowCursor: null,
      mappingCursor: '42',
      mappingChangedInPass: true,
    });
    state.scanMappings.mockResolvedValue({ cursor: '0', items: [] });
    rag.getUpdates.mockResolvedValue({
      items: [
        {
          type: 'database',
          id: 'database-page-1',
          databaseId: 'database-1',
          updatedAtMs: 200,
        },
      ],
      maxUpdatedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    rag.getDatabaseSyncMetadata.mockResolvedValue({
      id: 'database-page-1',
      databaseId: 'database-1',
      title: 'Database',
    });

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({
      hasMore: true,
      processedCount: 0,
    });
    expect(state.setDatabaseWorkProgress).toHaveBeenLastCalledWith(
      lease,
      expect.objectContaining({
        mappingCursor: '0',
        mappingChangedInPass: false,
      }),
    );
    expect(state.deleteDatabaseWorkProgress).not.toHaveBeenCalled();
  });

  it('bounds a database deletion cascade and persists its mapping cursor', async () => {
    const { service, rag, state, writer } = setup();
    const mappings = Array.from({ length: 10 }, (_, index) => ({
      identity: `database_row:row-${String(index).padStart(3, '0')}`,
      fileId: `file-${String(index).padStart(3, '0')}`,
      operationId: hex(index + 1),
      contentHash: hex(index + 11),
      sourceType: 'database_row',
      sourceId: `row-${String(index).padStart(3, '0')}`,
      pageId: `row-page-${String(index).padStart(3, '0')}`,
      databaseId: 'database-1',
      updatedAtMs: index + 1,
    }));
    const mappingsByIdentity = new Map(
      mappings.map((mapping) => [mapping.identity, mapping]),
    );
    state.scanMappings.mockResolvedValue({
      cursor: '29',
      items: mappings.slice(0, 2),
      hasMore: true,
      ackToken: 'database-delete-batch',
    });
    state.getMapping.mockImplementation((_lease: unknown, identity: string) =>
      Promise.resolve(mappingsByIdentity.get(identity) ?? null),
    );
    rag.getDeleted.mockResolvedValue({
      items: [
        {
          type: 'database',
          id: 'database-page-1',
          databaseId: 'database-1',
          deletedAtMs: 200,
        },
      ],
      maxDeletedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });
    writer.getFile.mockImplementation((_binding: unknown, fileId: string) =>
      Promise.resolve({ id: fileId }),
    );
    writer.readOwnership.mockImplementation((file: { id: string }) => {
      const mapping = mappings.find(
        (candidate) => candidate.fileId === file.id,
      );
      return mapping
        ? {
            schemaVersion: 2,
            metadata: {
              sourceType: mapping.sourceType,
              sourceId: mapping.sourceId,
              contentHash: mapping.contentHash,
              operationId: mapping.operationId,
            },
          }
        : null;
    });

    const result = await service.processQuantum(binding, {
      ...context,
      maxItems: 3,
    });

    expect(result).toMatchObject({ hasMore: true, processedCount: 3 });
    expect(writer.deleteFile).toHaveBeenCalledTimes(2);
    expect(state.setDatabaseWorkProgress).toHaveBeenLastCalledWith(
      lease,
      expect.objectContaining({
        operation: 'delete',
        phase: 'rows',
        mappingCursor: '29',
        mappingChangedInPass: true,
      }),
    );
    expect(state.setCheckpoint).not.toHaveBeenCalledWith(
      lease,
      'deleted',
      expect.anything(),
    );
  });

  it('repeats database deletion HSCAN after a mutating pass', async () => {
    const { service, rag, state } = setup();
    state.getDatabaseWorkProgress.mockResolvedValue({
      operation: 'delete',
      databaseId: 'database-1',
      pageId: 'database-page-1',
      phase: 'rows',
      mappingCursor: '42',
      mappingChangedInPass: true,
    });
    state.scanMappings.mockResolvedValue({ cursor: '0', items: [] });
    rag.getDeleted.mockResolvedValue({
      items: [
        {
          type: 'database',
          id: 'database-page-1',
          databaseId: 'database-1',
          deletedAtMs: 200,
        },
      ],
      maxDeletedAtMs: 200,
      hasMore: false,
      nextCursor: null,
    });

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({
      hasMore: true,
      processedCount: 0,
    });
    expect(state.setDatabaseWorkProgress).toHaveBeenLastCalledWith(
      lease,
      expect.objectContaining({
        mappingCursor: '0',
        mappingChangedInPass: false,
      }),
    );
    expect(state.deleteDatabaseWorkProgress).not.toHaveBeenCalled();
  });

  it('bounds reconciliation mapping writes to 100 operations', async () => {
    const { service, rag, state, writer } = setup();
    state.getReconcileAt.mockResolvedValue(0);
    writer.listKnowledgeFilesPage.mockResolvedValue(
      listing(
        Array.from({ length: 150 }, (_, index) =>
          remoteFile(`file-${String(index).padStart(3, '0')}`, {
            sourceId: `page-${String(index).padStart(3, '0')}`,
            pageId: `page-${String(index).padStart(3, '0')}`,
            sourceUpdatedAtMs: index + 1,
            operationId: hex(index + 1),
            contentHash: hex(index + 151),
          }),
        ),
      ),
    );
    writer.readOwnership.mockImplementation((file: any) => file.ownership);

    const result = await service.processQuantum(binding, context);

    expect(result).toMatchObject({ hasMore: true, processedCount: 100 });
    expect(state.setMapping).toHaveBeenCalledTimes(100);
    expect(writer.deleteFile).not.toHaveBeenCalled();
    expect(state.setReconcileAt).not.toHaveBeenCalled();
    expect(rag.getDeleted).not.toHaveBeenCalled();
  });

  it('removes a mapping whose global file is detached from the Knowledge', async () => {
    const { service, state, writer } = setup();
    const mapping = {
      identity: 'page:page-1',
      fileId: 'file-detached',
      operationId: hex(1),
      contentHash: hex(2),
      sourceType: 'page',
      sourceId: 'page-1',
      pageId: 'page-1',
      updatedAtMs: 10,
    } as const;
    state.getReconcileAt.mockResolvedValue(0);
    state.getRemoteScanProgress.mockResolvedValue({
      configVersion: binding.configVersion,
      phase: 'mappings',
      page: 1,
      mappingCursor: '0',
      expectedTotal: 0,
      scopeFingerprint: effectiveFingerprint(),
    });
    state.scanMappings.mockResolvedValue({ cursor: '0', items: [mapping] });
    state.wasRemoteScanFileIdSeen.mockResolvedValue(false);
    writer.getFile.mockResolvedValue({ id: mapping.fileId });
    writer.readOwnership.mockReturnValue({
      schemaVersion: 2,
      metadata: {
        sourceType: mapping.sourceType,
        sourceId: mapping.sourceId,
        contentHash: mapping.contentHash,
        operationId: mapping.operationId,
      },
    });

    await service.processQuantum(binding, context);

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      mapping.fileId,
      context.signal,
    );
    expect(state.deleteMapping).toHaveBeenCalledWith(lease, mapping.identity);
    expect(state.setCheckpoint).toHaveBeenCalledWith(lease, 'updates', 0);
    expect(state.setFeedProgress).toHaveBeenCalledWith(lease, 'updates', null);
  });

  it('does not acknowledge a reconciliation batch until replay checkpoints are durable', async () => {
    const { service, state, writer } = setup();
    const mapping = {
      identity: 'page:page-1',
      fileId: 'file-detached',
      operationId: hex(1),
      contentHash: hex(2),
      sourceType: 'page',
      sourceId: 'page-1',
      pageId: 'page-1',
      updatedAtMs: 10,
    } as const;
    state.getReconcileAt.mockResolvedValue(0);
    state.getRemoteScanProgress.mockResolvedValue({
      configVersion: binding.configVersion,
      phase: 'mappings',
      page: 1,
      mappingCursor: '0',
      expectedTotal: 0,
      scopeFingerprint: effectiveFingerprint(),
    });
    state.scanMappings.mockResolvedValue({
      cursor: '0',
      items: [mapping],
      hasMore: true,
      ackToken: 'reconcile-batch',
    });
    state.wasRemoteScanFileIdSeen.mockResolvedValue(false);
    state.setCheckpoint
      .mockRejectedValueOnce(new Error('simulated crash'))
      .mockResolvedValue(undefined);
    writer.getFile.mockResolvedValue({ id: mapping.fileId });
    writer.readOwnership.mockReturnValue({
      schemaVersion: 2,
      metadata: {
        sourceType: mapping.sourceType,
        sourceId: mapping.sourceId,
        contentHash: mapping.contentHash,
        operationId: mapping.operationId,
      },
    });

    await expect(service.processQuantum(binding, context)).rejects.toThrow(
      'simulated crash',
    );
    expect(state.ackScanBatch).not.toHaveBeenCalled();

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({ hasMore: true });
    expect(state.scanMappings).toHaveBeenCalledTimes(2);
    expect(state.setCheckpoint).toHaveBeenLastCalledWith(lease, 'updates', 0);
    expect(state.setFeedProgress).toHaveBeenLastCalledWith(
      lease,
      'updates',
      null,
    );
    expect(state.ackScanBatch).toHaveBeenCalledWith(
      lease,
      'mappings',
      'reconcile',
      'reconcile-batch',
    );
    expect(
      state.setRemoteScanProgress.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(state.ackScanBatch.mock.invocationCallOrder.at(-1)!);
  });

  it('bounds duplicate cleanup together with its mapping write', async () => {
    const { service, state, writer } = setup();
    state.getReconcileAt.mockResolvedValue(0);
    writer.listKnowledgeFilesPage.mockResolvedValue(
      listing(
        Array.from({ length: 150 }, (_, index) =>
          remoteFile(`duplicate-${String(index).padStart(3, '0')}`, {
            sourceId: 'page-1',
            pageId: 'page-1',
            sourceUpdatedAtMs: index + 1,
            operationId: hex(index + 1),
            contentHash: hex(index + 151),
          }),
        ),
      ),
    );
    writer.readOwnership.mockImplementation((file: any) => file.ownership);

    const result = await service.processQuantum(binding, context);

    expect(result).toMatchObject({ hasMore: true, processedCount: 100 });
    expect(state.setMapping).toHaveBeenCalledTimes(1);
    expect(writer.deleteFile).toHaveBeenCalledTimes(99);
    expect(state.setReconcileAt).not.toHaveBeenCalled();
  });

  it('deletes a legacy-only owned file and replays its source feed', async () => {
    const { service, state, writer } = setup();
    state.getReconcileAt.mockResolvedValue(0);
    const legacy = { id: 'legacy-file' };
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([legacy]));
    writer.readOwnership.mockReturnValue({
      schemaVersion: 1,
      metadata: {
        schemaVersion: 1,
        workspaceId: binding.workspaceId,
        spaceId: binding.spaceId,
        sourceType: 'page',
        sourceId: 'deleted-page',
        pageId: 'deleted-page',
        sourceUpdatedAtMs: 1,
        contentHash: hex(1),
      },
    });

    await expect(
      service.processQuantum(binding, context),
    ).resolves.toMatchObject({
      hasMore: true,
      processedCount: 1,
    });

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      legacy.id,
      context.signal,
    );
    expect(state.setMapping).not.toHaveBeenCalled();
    expect(state.setCheckpoint).toHaveBeenCalledWith(lease, 'updates', 0);
    expect(state.setFeedProgress).toHaveBeenCalledWith(lease, 'updates', null);
  });

  it('removes a target-test marker without creating a mapping', async () => {
    const { service, state, writer } = setup();
    state.getReconcileAt.mockResolvedValue(0);
    const marker = remoteFile('marker-1', {
      sourceId: 'marker-1',
      pageId: 'marker-1',
      sourceUpdatedAtMs: 1,
      operationId: hex(1),
      contentHash: hex(2),
      marker: 'target-test',
    });
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([marker]));
    writer.readOwnership.mockReturnValue(marker.ownership);

    const result = await service.processQuantum(binding, context);

    expect(result).toMatchObject({ hasMore: true, processedCount: 1 });
    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      marker.id,
      context.signal,
    );
    expect(state.setMapping).not.toHaveBeenCalled();
  });

  it('removes a late excluded upload after the first policy scan and keeps the transition pending', async () => {
    const { service, rag, state, writer } = setup();
    const excludedScope = {
      ...ragScope,
      fingerprint: hex(41),
      excludedPageIds: ['page-1'],
    };
    const operationId = hex(42);
    const intent = {
      operationId,
      identity: 'page:page-1',
      sourceType: 'page' as const,
      sourceId: 'page-1',
      pageId: 'page-1',
      configVersion: binding.configVersion,
      createdAt: 1_000,
      notBefore: 36_000,
    };
    const late = remoteFile('late-excluded', {
      sourceId: 'page-1',
      pageId: 'page-1',
      sourceUpdatedAtMs: 100,
      operationId,
      contentHash: hex(43),
    });
    const progress = new Map<string, any>();
    let redisNow = 1_000;
    let intentActive = true;
    rag.getScope.mockResolvedValue(excludedScope);
    state.getScopeFingerprint.mockResolvedValue(hex(40));
    state.getTimeMs.mockImplementation(async () => redisNow);
    state.getRemoteScanProgress.mockImplementation(
      async (_lease: unknown, purpose: unknown) =>
        progress.get(JSON.stringify(purpose)) ?? null,
    );
    state.setRemoteScanProgress.mockImplementation(
      async (_lease: unknown, purpose: unknown, value: unknown) => {
        const key = JSON.stringify(purpose);
        if (value === null) progress.delete(key);
        else progress.set(key, value);
      },
    );
    state.scanUploadIntents.mockImplementation(async () => ({
      cursor: '0',
      items: intentActive ? [intent] : [],
    }));
    state.deleteUploadIntent.mockImplementation(async () => {
      intentActive = false;
    });
    writer.listKnowledgeFilesPage
      .mockResolvedValueOnce(listing([]))
      .mockResolvedValueOnce(listing([late]));
    writer.readOwnership.mockImplementation((file: any) => file.ownership);

    await service.processQuantum(binding, context);
    await service.processQuantum(binding, context);
    const waiting = await service.processQuantum(binding, context);
    expect(waiting).toMatchObject({ hasMore: true, retryAfterMs: 35_000 });
    expect(writer.listKnowledgeFilesPage).not.toHaveBeenCalled();

    redisNow = 36_001;
    await service.processQuantum(binding, context);
    expect(writer.deleteFile).not.toHaveBeenCalled();
    await service.processQuantum(binding, context);

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      late.id,
      context.signal,
    );
    expect(state.setScopeFingerprint).not.toHaveBeenCalled();
    expect(progress.get(JSON.stringify('policy'))).toMatchObject({
      phase: 'files',
      stablePasses: 0,
    });
  });

  it('deletes a late accepted upload after its tombstone checkpoint advanced', async () => {
    const { service, rag, state, writer } = setup({}, [], ['page-1']);
    const operationId = hex(51);
    const intent = {
      operationId,
      identity: 'page:page-1',
      sourceType: 'page' as const,
      sourceId: 'page-1',
      pageId: 'page-1',
      configVersion: binding.configVersion,
      createdAt: 1,
      notBefore: 2,
    };
    const late = remoteFile('late-deleted', {
      sourceId: 'page-1',
      pageId: 'page-1',
      sourceUpdatedAtMs: 100,
      operationId,
      contentHash: hex(52),
    });
    rag.getDeleted.mockResolvedValueOnce({
      items: [{ type: 'page', id: 'page-1', deletedAtMs: 100 }],
      maxDeletedAtMs: 100,
      hasMore: false,
      nextCursor: null,
    });
    state.scanUploadIntents.mockResolvedValue({
      cursor: '0',
      items: [intent],
    });
    state.getReconcileAt
      .mockResolvedValueOnce(Date.now() + 60_000)
      .mockResolvedValue(0);

    await service.processQuantum(binding, context);

    expect(state.setUploadIntent).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        operationId,
        cleanupRequested: true,
      }),
    );
    expect(state.setCheckpoint).toHaveBeenCalledWith(lease, 'deleted', 101);

    writer.listKnowledgeFilesPage.mockResolvedValue(listing([late]));
    writer.readOwnership.mockImplementation((file: any) => file.ownership);
    await service.processQuantum(binding, context);

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      late.id,
      context.signal,
    );
    expect(state.setMapping).not.toHaveBeenCalled();
    expect(state.deleteMapping).toHaveBeenCalledWith(lease, 'page:page-1');
  });

  it('does not adopt a live source whose upload intent was marked for cleanup', async () => {
    const { service, state, writer } = setup();
    const operationId = hex(61);
    const late = remoteFile('late-ineligible', {
      sourceId: 'page-1',
      pageId: 'page-1',
      sourceUpdatedAtMs: 100,
      operationId,
      contentHash: hex(62),
    });
    state.getReconcileAt.mockResolvedValue(0);
    state.getUploadIntent.mockResolvedValue({
      operationId,
      identity: 'page:page-1',
      sourceType: 'page',
      sourceId: 'page-1',
      pageId: 'page-1',
      configVersion: binding.configVersion,
      createdAt: 1,
      notBefore: 2,
      cleanupRequested: true,
    });
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([late]));
    writer.readOwnership.mockImplementation((file: any) => file.ownership);

    await service.processQuantum(binding, context);

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      late.id,
      context.signal,
    );
    expect(state.setMapping).not.toHaveBeenCalled();
    expect(state.deleteUploadIntent).toHaveBeenCalledWith(lease, operationId);
  });

  it('does not adopt standalone page metadata after the page becomes a database node', async () => {
    const { service, state, writer } = setup({}, [], [], ['page-1']);
    const remote = remoteFile('stale-page-shape', {
      sourceId: 'page-1',
      pageId: 'page-1',
      sourceUpdatedAtMs: 100,
      operationId: hex(63),
      contentHash: hex(64),
    });
    state.getReconcileAt.mockResolvedValue(0);
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([remote]));
    writer.readOwnership.mockImplementation((file: any) => file.ownership);

    await service.processQuantum(binding, context);

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      remote.id,
      context.signal,
    );
    expect(state.setMapping).not.toHaveBeenCalled();
  });

  it('evaluates liveness per metadata tuple when live and stale files share an identity', async () => {
    const { service, state, writer } = setup({}, [], [], ['page-1']);
    const stale = remoteFile('stale-regular-page', {
      sourceId: 'page-1',
      pageId: 'page-1',
      sourceUpdatedAtMs: 90,
      operationId: hex(65),
      contentHash: hex(66),
    });
    const live = remoteFile('live-database-page', {
      sourceId: 'page-1',
      pageId: 'page-1',
      databaseId: 'database-1',
      sourceUpdatedAtMs: 100,
      operationId: hex(67),
      contentHash: hex(68),
    });
    state.getReconcileAt.mockResolvedValue(0);
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([stale, live]));
    writer.readOwnership.mockImplementation((file: any) => file.ownership);

    await service.processQuantum(binding, context);

    expect(writer.deleteFile).toHaveBeenCalledWith(
      binding,
      stale.id,
      context.signal,
    );
    expect(writer.deleteFile).not.toHaveBeenCalledWith(
      binding,
      live.id,
      context.signal,
    );
    expect(state.setMapping).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        identity: 'page:page-1',
        fileId: live.id,
        databaseId: 'database-1',
      }),
    );
  });

  it('drains only owned files after two stable empty observations', async () => {
    const { service, state, writer } = setup();
    const owned = { id: 'file-owned' };
    const foreign = { id: 'file-foreign' };
    writer.listKnowledgeFilesPage.mockResolvedValue(listing([owned, foreign]));
    writer.readOwnership.mockImplementation((file: { id: string }) =>
      file.id === owned.id ? { schemaVersion: 2, metadata: {} } : null,
    );

    const deleting = await service.processQuantum(
      { ...binding, state: 'draining' },
      context,
    );

    expect(deleting).toMatchObject({ hasMore: true });
    expect(writer.deleteFile).toHaveBeenCalledTimes(1);
    expect(writer.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: binding.id }),
      owned.id,
      context.signal,
    );
    expect(state.setDrainEmptyObservedAt).toHaveBeenCalledWith(
      lease,
      binding.configVersion,
      null,
    );
    expect(state.clearTargetState).not.toHaveBeenCalled();

    writer.listKnowledgeFilesPage.mockResolvedValue(listing([foreign]));
    const transitionToIntentScan = await service.processQuantum(
      { ...binding, state: 'draining' },
      context,
    );
    expect(transitionToIntentScan).toMatchObject({ hasMore: true });
    state.getRemoteScanProgress.mockResolvedValue(drainIntentProgress());
    const firstEmpty = await service.processQuantum(
      { ...binding, state: 'draining' },
      context,
    );
    expect(firstEmpty).toMatchObject({ hasMore: false });
    expect(firstEmpty).not.toHaveProperty('drained', true);
    expect(state.setDrainEmptyObservedAt).toHaveBeenCalledWith(
      lease,
      binding.configVersion,
      expect.any(Number),
    );
    expect(state.clearTargetState).not.toHaveBeenCalled();

    state.getDrainEmptyObservedAt.mockResolvedValue(Date.now() - 5_001);
    state.getRemoteScanProgress.mockResolvedValue(null);
    await expect(
      service.processQuantum({ ...binding, state: 'draining' }, context),
    ).resolves.toMatchObject({ hasMore: true });
    state.getRemoteScanProgress.mockResolvedValue(drainIntentProgress());
    const confirmedEmpty = await service.processQuantum(
      { ...binding, state: 'draining' },
      context,
    );
    expect(confirmedEmpty).toMatchObject({ drained: true, hasMore: false });
    expect(state.clearTargetState).toHaveBeenCalledWith(lease);
  });

  it('persists the bounded upload-intent HSCAN cursor during drain', async () => {
    const { service, state, writer } = setup();
    state.getRemoteScanProgress.mockResolvedValue(drainIntentProgress('17'));
    state.scanUploadIntents.mockResolvedValue({
      cursor: '29',
      items: [],
      hasMore: true,
      ackToken: null,
    });

    await expect(
      service.processQuantum({ ...binding, state: 'draining' }, context),
    ).resolves.toMatchObject({ hasMore: true, processedCount: 0 });

    expect(writer.listKnowledgeFilesPage).not.toHaveBeenCalled();
    expect(state.scanUploadIntents).toHaveBeenCalledWith(
      lease,
      '17',
      100,
      'drain',
    );
    expect(state.setRemoteScanProgress).toHaveBeenLastCalledWith(
      lease,
      'drain',
      expect.objectContaining({ phase: 'mappings', mappingCursor: '29' }),
    );
  });

  it('uses a Redis-time drain start barrier despite application clock skew', async () => {
    const { service, state } = setup();
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(9_000_000_000_000);
    state.getDrainStartedAt.mockResolvedValue(null);
    state.getTimeMs.mockResolvedValueOnce(10_000).mockResolvedValueOnce(10_001);
    state.getRemoteScanProgress.mockResolvedValue(drainIntentProgress());

    try {
      await expect(
        service.processQuantum(
          { ...binding, state: 'draining', updatedAtMs: 1 },
          context,
        ),
      ).resolves.toMatchObject({ hasMore: false });
    } finally {
      dateNow.mockRestore();
    }

    expect(state.setDrainStartedAt).toHaveBeenCalledWith(
      lease,
      binding.configVersion,
      10_000,
    );
    expect(state.setDrainEmptyObservedAt).toHaveBeenCalledWith(
      lease,
      binding.configVersion,
      null,
    );
    expect(state.clearTargetState).not.toHaveBeenCalled();
  });
});

function emptyFeed(checkpoint: 'maxUpdatedAtMs' | 'maxDeletedAtMs') {
  return {
    items: [],
    [checkpoint]: 0,
    hasMore: false,
    nextCursor: null,
  };
}

function listing(items: unknown[], total = items.length) {
  return { items, total, hasMore: items.length < total };
}

function drainIntentProgress(mappingCursor = '0') {
  return {
    configVersion: 1,
    phase: 'mappings' as const,
    page: 1,
    mappingCursor,
    expectedTotal: 0,
    scopeFingerprint: null,
  };
}

function effectiveFingerprint(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 2,
        serverScopeFingerprint: 'scope-fingerprint',
        maxAttachmentBytes: 25 * 1024 * 1024,
        supportedAttachmentExtensions: ['.docx', '.md', '.pdf', '.txt'],
      }),
    )
    .digest('hex');
}

function remoteFile(
  id: string,
  metadata: Partial<{
    sourceType: 'page' | 'attachment';
    sourceId: string;
    pageId: string;
    databaseId: string;
    sourceUpdatedAtMs: number;
    operationId: string;
    contentHash: string;
    marker: 'target-test';
  }>,
) {
  return {
    id,
    ownership: {
      schemaVersion: 2,
      metadata: {
        schemaVersion: 2,
        bindingId: 'binding-1',
        targetVersion: 1,
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        sourceType: metadata.sourceType ?? 'page',
        sourceId: metadata.sourceId ?? 'page-1',
        pageId: metadata.pageId ?? 'page-1',
        ...(metadata.databaseId ? { databaseId: metadata.databaseId } : {}),
        sourceUpdatedAtMs: metadata.sourceUpdatedAtMs ?? 1,
        operationId: metadata.operationId ?? hex(1),
        contentHash: metadata.contentHash ?? hex(2),
        ...(metadata.marker ? { marker: metadata.marker } : {}),
      },
    },
  } as const;
}

function syncSource(
  identity: string,
  pageId: string,
  content: string,
  databaseId?: string,
) {
  return {
    identity,
    sourceType: 'page' as const,
    sourceId: pageId,
    pageId,
    databaseId,
    updatedAtMs: 1,
    fileName: `${pageId}.md`,
    mimeType: 'text/markdown',
    content: new TextEncoder().encode(content),
  };
}

function operationIdForSource(source: ReturnType<typeof syncSource>): string {
  const contentHash = createHash('sha256').update(source.content).digest('hex');
  return createHash('sha256')
    .update(
      `binding-1\n1\n${source.identity}\n${source.pageId}\n${source.databaseId ?? ''}\n${contentHash}`,
    )
    .digest('hex');
}

function hex(value: number): string {
  return value.toString(16).padStart(64, '0');
}
