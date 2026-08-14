import { Hocuspocus } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { StarterKit } from '@tiptap/starter-kit';
import { ForbiddenException } from '@nestjs/common';
import * as Y from 'yjs';
import { PersistenceExtension } from './persistence.extension';
import { hashProseMirrorJson } from '../../common/helpers/prosemirror/ai-page-operation';

jest.mock('../../common/helpers/prosemirror/utils', () => ({
  extractMentions: jest.fn(() => []),
  extractPageMentions: jest.fn(() => []),
  extractUserMentions: jest.fn(() => []),
  getProsemirrorContent: jest.fn((content) => content),
}));

const PAGE_ID = '550e8400-e29b-41d4-a716-446655440000';
const DOCUMENT_NAME = `page.${PAGE_ID}`;
const USER_ID = 'user-1';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const ydocFor = (content: ReturnType<typeof doc>) =>
  TiptapTransformer.toYdoc(content, 'default', [StarterKit]);

const persistedPage = () => ({
  id: PAGE_ID,
  slugId: 'page-1',
  spaceId: 'space-1',
  workspaceId: 'workspace-1',
  creatorId: 'creator-1',
  contributorIds: ['creator-1'],
  createdAt: new Date('2020-01-01T00:00:00.000Z'),
  content: doc('persisted'),
  ydoc: Buffer.from(Y.encodeStateAsUpdate(ydocFor(doc('persisted')))),
});

function createHarness() {
  const instanceQuery = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    executeTakeFirst: jest.fn().mockResolvedValue(undefined),
  };
  const operationQuery = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    forUpdate: jest.fn().mockReturnThis(),
    executeTakeFirst: jest.fn().mockResolvedValue({
      id: 'operation-1',
      operationKind: 'template_sync',
      sourcePageId: 'source-1',
    }),
  };
  const trx = {
    updateTable: jest.fn(),
    selectFrom: jest.fn((tableName: string) =>
      tableName === 'pageTemplateOperations' ? operationQuery : instanceQuery,
    ),
  };
  const db = {
    transaction: () => ({
      execute: (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(trx),
    }),
  };
  const pageRepo = {
    findById: jest.fn().mockResolvedValue(persistedPage()),
    updatePage: jest.fn().mockResolvedValue(undefined),
  };
  const generalQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const collabHistory = {
    addContributors: jest.fn().mockResolvedValue(undefined),
    enqueuePageContentHistory: jest.fn().mockResolvedValue(undefined),
  };
  const transclusionService = {
    syncPageTransclusions: jest.fn().mockResolvedValue(undefined),
    syncPageReferences: jest.fn().mockResolvedValue(undefined),
  };
  const pageEmbedService = {
    syncPageReferences: jest.fn().mockResolvedValue(undefined),
  };
  const eventEmitter = { emitAsync: jest.fn().mockResolvedValue(undefined) };
  const collabPageUpdates = {
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const pageTemplatePolicy = {
    assertAction: jest.fn().mockResolvedValue(undefined),
  };
  const extension = new PersistenceExtension(
    pageRepo as never,
    db as never,
    generalQueue as never,
    notificationQueue as never,
    collabHistory as never,
    transclusionService as never,
    pageEmbedService as never,
    eventEmitter as never,
    collabPageUpdates as never,
    pageTemplatePolicy as never,
  );
  jest.spyOn(extension['logger'], 'debug').mockImplementation(() => undefined);
  jest.spyOn(extension['logger'], 'warn').mockImplementation(() => undefined);
  jest.spyOn(extension['logger'], 'error').mockImplementation(() => undefined);

  return {
    extension,
    pageRepo,
    generalQueue,
    notificationQueue,
    collabHistory,
    eventEmitter,
    collabPageUpdates,
    pageTemplatePolicy,
    instanceQuery,
    operationQuery,
    trx,
  };
}

function createStorePayload(instance?: { unloadDocument: jest.Mock }) {
  const document = ydocFor(doc('uncommitted')) as any;
  document.broadcastStateless = jest.fn();
  document.connections = new Map();
  return {
    documentName: DOCUMENT_NAME,
    document,
    context: { user: { id: USER_ID } },
    instance: instance ?? { unloadDocument: jest.fn() },
  } as any;
}

describe('PersistenceExtension failure boundary', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries a classified transient error while the Y.Doc is available', async () => {
    const {
      extension,
      pageRepo,
      generalQueue,
      eventEmitter,
      collabPageUpdates,
    } = createHarness();
    pageRepo.updatePage
      .mockRejectedValueOnce(
        Object.assign(new Error('serialization'), { code: '40001' }),
      )
      .mockResolvedValueOnce(undefined);

    await extension.onStoreDocument(createStorePayload());

    expect(pageRepo.updatePage).toHaveBeenCalledTimes(2);
    expect(generalQueue.add).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(collabPageUpdates.publish).toHaveBeenCalledWith({
      pageIds: [PAGE_ID],
      workspaceId: 'workspace-1',
    });
    expect(extension['dirtyDocuments']).toHaveProperty('size', 0);
  });

  it('retains contributors, suppresses effects and vetoes unload after retry exhaustion', async () => {
    const {
      extension,
      pageRepo,
      generalQueue,
      notificationQueue,
      collabHistory,
      eventEmitter,
    } = createHarness();
    pageRepo.updatePage.mockRejectedValue(
      Object.assign(new Error('serialization'), { code: '40001' }),
    );
    const payload = createStorePayload();
    await extension.onChange({
      documentName: DOCUMENT_NAME,
      context: { user: { id: USER_ID } },
    } as any);

    await expect(extension.onStoreDocument(payload)).resolves.toBeUndefined();

    expect(pageRepo.updatePage).toHaveBeenCalledTimes(3);
    expect(extension['contributors'].get(DOCUMENT_NAME)).toEqual(
      new Set([USER_ID]),
    );
    expect(generalQueue.add).not.toHaveBeenCalled();
    expect(notificationQueue.add).not.toHaveBeenCalled();
    expect(collabHistory.addContributors).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    await expect(
      extension.beforeUnloadDocument({
        documentName: DOCUMENT_NAME,
        document: payload.document,
        instance: payload.instance,
      } as any),
    ).rejects.toThrow('collaboration_document_has_unpersisted_changes');
    extension['clearDocumentDirty'](DOCUMENT_NAME);
  });

  it('does not retry a permanent database error', async () => {
    const { extension, pageRepo, generalQueue, eventEmitter } = createHarness();
    pageRepo.updatePage.mockRejectedValue(
      Object.assign(new Error('constraint violation'), { code: '23514' }),
    );

    await extension.onStoreDocument(createStorePayload());

    expect(pageRepo.updatePage).toHaveBeenCalledTimes(1);
    expect(generalQueue.add).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    expect(extension['dirtyDocuments'].has(DOCUMENT_NAME)).toBe(true);
    extension['clearDocumentDirty'](DOCUMENT_NAME);
  });

  it('rejects an older synchronized-template revision before persisting page content', async () => {
    const { extension, pageRepo, trx } = createHarness();
    trx.updateTable.mockImplementation((tableName: string) => {
      const query: any = {
        set: () => query,
        where: () => query,
        returning: () => query,
        executeTakeFirst: async () =>
          tableName === 'pageTemplateInstances' ? undefined : { id: 'op-1' },
      };
      return query;
    });
    const payload = createStorePayload();
    payload.context = {
      user: { id: USER_ID },
      pageTemplateMutationId: 'operation-1',
      pageTemplateOperationLeaseToken: 'lease-1',
      pageTemplateSystemSyncRevision: 1,
    };

    await expect(extension.onStoreDocument(payload)).rejects.toMatchObject({
      response: { code: 'page_template_revision_stale' },
    });

    expect(trx.updateTable).toHaveBeenCalledWith('pageTemplateInstances');
    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('commits clean content, detach state and operation completion atomically', async () => {
    const { extension, pageRepo, operationQuery, trx } = createHarness();
    operationQuery.executeTakeFirst.mockResolvedValue({
      id: 'operation-1',
      operationKind: 'template_detach',
      sourcePageId: 'template-1',
    });
    const detachSet = jest.fn();
    const operationSet = jest.fn();
    trx.updateTable.mockImplementation((tableName: string) => {
      const query: any = {
        set: (value: unknown) => {
          if (tableName === 'pageTemplateInstances') detachSet(value);
          if (tableName === 'pageTemplateOperations') operationSet(value);
          return query;
        },
        where: () => query,
        returning: () => query,
        executeTakeFirst: async () =>
          tableName === 'pageTemplateInstances'
            ? { id: 'instance-1' }
            : { id: 'operation-1' },
      };
      return query;
    });
    const payload = createStorePayload();
    payload.context = {
      user: { id: USER_ID },
      pageTemplateMutationId: 'operation-1',
      pageTemplateOperationLeaseToken: 'lease-1',
    };

    await extension.onStoreDocument(payload);

    expect(detachSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'detached',
        templatePageId: null,
        detachedById: USER_ID,
      }),
    );
    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      expect.objectContaining({ content: doc('uncommitted') }),
      PAGE_ID,
      trx,
    );
    expect(operationSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
    expect(trx.updateTable).toHaveBeenCalledWith('pageTemplateInstances');
    expect(trx.updateTable).toHaveBeenCalledWith('pageTemplateOperations');
  });

  it('accepts a duplicate store after the same template mutation completed', async () => {
    const { extension, pageRepo, operationQuery, trx } = createHarness();
    pageRepo.findById.mockResolvedValue({
      ...persistedPage(),
      content: doc('uncommitted'),
    });
    operationQuery.executeTakeFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'operation-1',
        afterContentHash: hashProseMirrorJson(doc('uncommitted')),
      });
    const payload = createStorePayload();
    payload.context = {
      user: { id: USER_ID },
      pageTemplateMutationId: 'operation-1',
      pageTemplateOperationLeaseToken: 'expired-lease',
    };

    await expect(extension.onStoreDocument(payload)).resolves.toBeUndefined();

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
    expect(trx.updateTable).not.toHaveBeenCalled();
  });

  it('rejects a completed template mutation when the document no longer matches', async () => {
    const { extension, pageRepo, operationQuery } = createHarness();
    pageRepo.findById.mockResolvedValue({
      ...persistedPage(),
      content: doc('uncommitted'),
    });
    operationQuery.executeTakeFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'operation-1',
        afterContentHash: hashProseMirrorJson(doc('different')),
      });
    const payload = createStorePayload();
    payload.context = {
      user: { id: USER_ID },
      pageTemplateMutationId: 'operation-1',
      pageTemplateOperationLeaseToken: 'expired-lease',
    };

    await expect(extension.onStoreDocument(payload)).rejects.toMatchObject({
      response: { code: 'page_template_operation_lease_lost' },
    });

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('requires manage_template policy before persisting source template edits', async () => {
    const { extension, pageRepo, pageTemplatePolicy } = createHarness();
    pageRepo.findById.mockResolvedValue({
      ...persistedPage(),
      templateKind: 'synced',
    });
    pageTemplatePolicy.assertAction.mockRejectedValue(
      new ForbiddenException({
        code: 'page_template_policy_denied',
        message: 'Template policy denied',
      }),
    );
    const payload = createStorePayload();
    const socket = { close: jest.fn() };
    payload.document.connections.set(socket, {});
    const restorePersistedDocument = jest
      .spyOn(extension as any, 'restorePersistedDocument')
      .mockResolvedValue(undefined);

    await expect(extension.onStoreDocument(payload)).resolves.toBeUndefined();

    expect(pageTemplatePolicy.assertAction).toHaveBeenCalledWith(
      'workspace-1',
      'space-1',
      USER_ID,
      'manage_template',
    );
    expect(pageRepo.updatePage).not.toHaveBeenCalled();
    expect(restorePersistedDocument).toHaveBeenCalledWith(
      payload.document,
      PAGE_ID,
    );
    expect(payload.document.broadcastStateless).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'page_content_integrity_error',
        code: 'page_template_policy_denied',
      }),
    );
    expect(socket.close).toHaveBeenCalledWith(
      4409,
      'page_content_integrity_error',
    );
    expect(extension['dirtyDocuments'].has(DOCUMENT_NAME)).toBe(false);
    expect(extension['dirtyRetryTimers'].has(DOCUMENT_NAME)).toBe(false);
  });

  it('does not let a post-commit dependency failure reject the store hook', async () => {
    const { extension, pageRepo, generalQueue, eventEmitter } = createHarness();
    generalQueue.add.mockRejectedValueOnce(new Error('redis unavailable'));
    eventEmitter.emitAsync.mockRejectedValueOnce(
      new Error('listener unavailable'),
    );

    await expect(
      extension.onStoreDocument(createStorePayload()),
    ).resolves.toBeUndefined();

    expect(pageRepo.updatePage).toHaveBeenCalledTimes(1);
    expect(extension['dirtyDocuments']).toHaveProperty('size', 0);
  });

  it('keeps a failed document loaded through the real Hocuspocus unload lifecycle', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { extension, pageRepo } = createHarness();
    pageRepo.updatePage.mockRejectedValue(
      Object.assign(new Error('serialization'), { code: '40001' }),
    );
    const server = new Hocuspocus({
      extensions: [extension],
      debounce: 0,
      maxDebounce: 0,
      unloadImmediately: false,
      quiet: true,
    });

    const connection = await server.openDirectConnection(DOCUMENT_NAME, {
      user: { id: USER_ID },
    });
    await connection.transact((document) => {
      const update = ydocFor(doc('latest in-memory edit'));
      document
        .getXmlFragment('default')
        .delete(0, document.getXmlFragment('default').length);
      document.transact(() => {
        const state = Buffer.from(Y.encodeStateAsUpdate(update));
        Y.applyUpdate(document, state);
      });
    });
    await connection.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.documents.has(DOCUMENT_NAME)).toBe(true);
    expect(server.documents.get(DOCUMENT_NAME)?.isDestroyed).toBe(false);

    extension['clearDocumentDirty'](DOCUMENT_NAME);
    const loadedDocument = server.documents.get(DOCUMENT_NAME);
    if (loadedDocument) await server.unloadDocument(loadedDocument);
    consoleError.mockRestore();
  });

  it('cancels dirty retries when a lost lease forces local discard', async () => {
    const { extension, pageRepo } = createHarness();
    pageRepo.updatePage.mockRejectedValue(
      Object.assign(new Error('constraint violation'), { code: '23514' }),
    );
    const payload = createStorePayload();
    await extension.onChange({
      documentName: DOCUMENT_NAME,
      context: { user: { id: USER_ID } },
    } as any);

    await extension.onStoreDocument(payload);
    expect(extension['dirtyDocuments'].has(DOCUMENT_NAME)).toBe(true);
    expect(extension['dirtyRetryTimers'].has(DOCUMENT_NAME)).toBe(true);

    (extension as any).discardUnpersistedDocument(DOCUMENT_NAME);

    expect(extension['dirtyDocuments'].has(DOCUMENT_NAME)).toBe(false);
    expect(extension['dirtyRetryTimers'].has(DOCUMENT_NAME)).toBe(false);
    expect(extension['contributors'].has(DOCUMENT_NAME)).toBe(false);
  });
});
