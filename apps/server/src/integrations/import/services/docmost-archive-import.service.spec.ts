jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { DocmostArchiveImportService } from './docmost-archive-import.service';
import {
  remapDatabasePageReference,
  remapDatabaseViewConfig,
} from '../../../core/database/utils/database-copy.utils';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('DocmostArchiveImportService reference rewriting', () => {
  const service = new DocmostArchiveImportService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const report = () => ({
    created: {
      pages: 0,
      databases: 0,
      rows: 0,
      attachments: 0,
      labels: 0,
      dictionaryTerms: 0,
    },
    updated: { dictionaryTerms: 0 },
    skipped: {
      dictionaryTerms: 0,
      userReferences: 0,
      pageReferences: 0,
    },
    warnings: [],
  });

  it('preserves editable diagram nodes while remapping their attachments', () => {
    const oldAttachmentId = '019ed000-0000-7000-8000-000000000001';
    const newAttachmentId = '019ed000-0000-7000-8000-000000000002';
    const content = {
      type: 'doc',
      content: [
        {
          type: 'drawio',
          attrs: {
            attachmentId: oldAttachmentId,
            src: `/api/files/${oldAttachmentId}/diagram.svg`,
          },
        },
        {
          type: 'excalidraw',
          attrs: {
            attachmentId: oldAttachmentId,
            src: `/api/files/${oldAttachmentId}/drawing.svg`,
          },
        },
        {
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'graph TD; A-->B' }],
        },
      ],
    };

    const rewritten = (service as any).rewritePmNode(content, {
      pageIdMap: new Map(),
      slugIdMap: new Map(),
      databaseIdMap: new Map(),
      attachmentIdMap: new Map([[oldAttachmentId, newAttachmentId]]),
      userIdMap: new Map(),
      transclusionSnapshots: new Map(),
      fallbackUserId: 'user-target',
      report: report(),
    });

    expect(rewritten.content.map((node: any) => node.type)).toEqual([
      'drawio',
      'excalidraw',
      'codeBlock',
    ]);
    expect(rewritten.content[0].attrs).toEqual(
      expect.objectContaining({
        attachmentId: newAttachmentId,
        src: `/api/files/${newAttachmentId}/diagram.svg`,
      }),
    );
    expect(rewritten.content[2].content[0].text).toBe('graph TD; A-->B');
  });

  it('remaps page, user and synced-block references', () => {
    const state = report();
    const rewritten = (service as any).rewritePmNode(
      {
        type: 'doc',
        content: [
          {
            type: 'mention',
            attrs: {
              id: 'mention-old',
              entityType: 'page',
              entityId: 'page-old',
              slugId: 'slug-old',
              creatorId: 'user-old',
              label: 'Page',
            },
          },
          {
            type: 'mention',
            attrs: {
              id: 'mention-user-old',
              entityType: 'user',
              entityId: 'user-old',
              creatorId: 'user-old',
              label: 'User',
            },
          },
          {
            type: 'transclusionReference',
            attrs: {
              sourcePageId: 'page-old',
              transclusionId: 'block-1',
            },
          },
        ],
      },
      {
        pageIdMap: new Map([['page-old', 'page-new']]),
        slugIdMap: new Map([['slug-old', 'slug-new']]),
        databaseIdMap: new Map(),
        attachmentIdMap: new Map(),
        userIdMap: new Map([['user-old', 'user-new']]),
        transclusionSnapshots: new Map(),
        fallbackUserId: 'importer',
        report: state,
      },
    );

    expect(rewritten.content[0].attrs.entityId).toBe('page-new');
    expect(rewritten.content[0].attrs.slugId).toBe('slug-new');
    expect(rewritten.content[0].attrs.creatorId).toBe('user-new');
    expect(rewritten.content[1].attrs.entityId).toBe('user-new');
    expect(rewritten.content[2].attrs.sourcePageId).toBe('page-new');
    expect(state.skipped).toEqual(
      expect.objectContaining({ pageReferences: 0, userReferences: 0 }),
    );
  });

  it('restores external synced blocks as editable unsynced content', () => {
    const rewritten = (service as any).rewritePmNode(
      {
        type: 'doc',
        content: [
          {
            type: 'transclusionReference',
            attrs: {
              sourcePageId: 'external-page',
              transclusionId: 'block-1',
            },
          },
        ],
      },
      {
        pageIdMap: new Map(),
        slugIdMap: new Map(),
        databaseIdMap: new Map(),
        attachmentIdMap: new Map(),
        userIdMap: new Map(),
        transclusionSnapshots: new Map([
          [
            '*::external-page::block-1',
            {
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Snapshot content' }],
                  },
                ],
              },
              attachmentIdMap: new Map(),
            },
          ],
        ]),
        fallbackUserId: 'importer',
        report: report(),
      },
    );

    expect(rewritten.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Snapshot content' }],
      },
    ]);
  });

  it('resolves external page snapshots by consumer and occurrence', () => {
    const snapshots = new Map([
      [
        'consumer-a::occurrence::external-page',
        {
          content: {
            type: 'doc',
            content: [
              {
                type: 'image',
                attrs: {
                  attachmentId: 'attachment-old',
                  src: '/api/files/attachment-old/image.png',
                },
              },
            ],
          },
          attachmentIdMap: new Map(),
        },
      ],
      [
        'consumer-b::occurrence::external-page',
        {
          content: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
            ],
          },
          attachmentIdMap: new Map(),
        },
      ],
    ]);
    const rewrite = (
      consumerId: string,
      attachmentIdMap: Map<string, string>,
    ) =>
      (service as any).rewritePmNode(
        {
          type: 'pageEmbed',
          attrs: { id: 'occurrence', sourcePageId: 'external-page' },
        },
        {
          pageIdMap: new Map(),
          slugIdMap: new Map(),
          databaseIdMap: new Map(),
          attachmentIdMap: new Map(),
          externalSnapshotAttachmentIdMap: attachmentIdMap,
          sourceArchivePageId: consumerId,
          userIdMap: new Map(),
          transclusionSnapshots: new Map(),
          pageEmbedSnapshots: snapshots,
          allowPageEmbeds: true,
          fallbackUserId: 'importer',
          report: report(),
        },
      );

    const consumerA = rewrite(
      'consumer-a',
      new Map([['attachment-old', 'attachment-consumer-a']]),
    );
    const consumerB = rewrite('consumer-b', new Map());

    expect(consumerA[0].attrs).toMatchObject({
      attachmentId: 'attachment-consumer-a',
      src: '/api/files/attachment-consumer-a/image.png',
    });
    expect(consumerB[0].content[0].text).toBe('B');
  });

  it('uses the consumer attachment mapping when disabled internal embeds materialize', () => {
    const rewritten = (service as any).rewritePmNode(
      {
        type: 'pageEmbed',
        attrs: { id: 'occurrence', sourcePageId: 'source-page' },
      },
      {
        pageIdMap: new Map([['source-page', 'source-page-new']]),
        slugIdMap: new Map(),
        databaseIdMap: new Map(),
        attachmentIdMap: new Map([
          ['attachment-old', 'attachment-source-page'],
        ]),
        externalSnapshotAttachmentIdMap: new Map([
          ['attachment-old', 'attachment-consumer-page'],
        ]),
        sourceArchivePageId: 'consumer-page',
        userIdMap: new Map(),
        transclusionSnapshots: new Map(),
        pageEmbedSnapshots: new Map(),
        archivePageContentById: new Map([
          [
            'source-page',
            {
              type: 'doc',
              content: [
                {
                  type: 'image',
                  attrs: {
                    attachmentId: 'attachment-old',
                    src: '/api/files/attachment-old/image.png',
                  },
                },
              ],
            },
          ],
        ]),
        allowPageEmbeds: false,
        fallbackUserId: 'importer',
        report: report(),
      },
    );

    expect(rewritten[0].attrs).toMatchObject({
      attachmentId: 'attachment-consumer-page',
      src: '/api/files/attachment-consumer-page/image.png',
    });
  });

  it('restores external references without snapshots as placeholders', () => {
    const rewritten = (service as any).rewritePmNode(
      {
        type: 'doc',
        content: [
          {
            type: 'transclusionReference',
            attrs: {
              sourcePageId: 'external-page',
              transclusionId: 'block-1',
            },
          },
        ],
      },
      {
        pageIdMap: new Map(),
        slugIdMap: new Map(),
        databaseIdMap: new Map(),
        attachmentIdMap: new Map(),
        userIdMap: new Map(),
        transclusionSnapshots: new Map(),
        fallbackUserId: 'importer',
        report: report(),
      },
    );

    expect(rewritten.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '[Synced block unavailable after import]' },
        ],
      },
    ]);
  });

  it('remaps database identifiers embedded in editor JSON', () => {
    const rewritten = (service as any).rewritePmNode(
      {
        type: 'doc',
        content: [
          {
            type: 'database',
            attrs: { databaseId: 'database-old' },
          },
        ],
      },
      {
        pageIdMap: new Map(),
        slugIdMap: new Map(),
        databaseIdMap: new Map([['database-old', 'database-new']]),
        attachmentIdMap: new Map(),
        userIdMap: new Map(),
        transclusionSnapshots: new Map(),
        fallbackUserId: 'importer',
        report: report(),
      },
    );

    expect(rewritten.content[0].attrs.databaseId).toBe('database-new');
  });

  it('remaps property identifiers in database view keys and values', () => {
    const rewritten = remapDatabaseViewConfig(
      {
        'property-old': { propertyId: 'property-old' },
        sortPropertyId: 'property-old',
      },
      new Map([['property-old', 'property-new']]),
    );

    expect(rewritten).toEqual({
      'property-new': { propertyId: 'property-new' },
      sortPropertyId: 'property-new',
    });
  });

  it('remaps object page references and clears unresolved references', () => {
    const pageIdMap = new Map([['page-old', 'page-new']]);

    expect(
      remapDatabasePageReference(
        { id: 'page-old', title: 'Page' },
        'page_reference',
        pageIdMap,
        null,
      ),
    ).toEqual({ id: 'page-new', title: 'Page' });
    expect(
      remapDatabasePageReference(
        { pageId: 'missing-page' },
        'page_reference',
        pageIdMap,
        null,
      ),
    ).toBeNull();
  });

  it('clears a missing user cell instead of preserving a partial object', () => {
    const state = report();
    const value = (service as any).remapDatabaseUserReference(
      { id: 'user-missing', name: 'Former user' },
      new Map(),
      state,
    );

    expect(value).toBeNull();
    expect(state.skipped.userReferences).toBe(1);
  });
});

describe('DocmostArchiveImportService label import', () => {
  it('uses the same canonical label name as the page label API', async () => {
    const insertedLabels: Array<Record<string, unknown>> = [];
    const selectQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([]),
    };
    const trx = {
      selectFrom: jest.fn().mockReturnValue(selectQuery),
      insertInto: jest.fn((table: string) => {
        const query = {
          values: jest.fn((values: Record<string, unknown>) => {
            if (table === 'labels') insertedLabels.push(values);
            return query;
          }),
          onConflict: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue(undefined),
        };
        return query;
      }),
    };
    const service = new DocmostArchiveImportService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).insertLabels({
      data: {
        labels: [
          {
            id: 'source-label',
            name: '  Mixed Case Label  ',
            pageIds: [],
          },
        ],
      },
      fileTask: {
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
      },
      pageIdMap: new Map(),
      report: {
        created: { labels: 0 },
      },
      trx,
    });

    expect(insertedLabels).toHaveLength(1);
    expect(insertedLabels[0]).toEqual(
      expect.objectContaining({ name: 'mixed-case-label' }),
    );
  });
});

describe('DocmostArchiveImportService dictionary import', () => {
  it('deduplicates aliases after Unicode and case normalization', async () => {
    let insertedAliases: Array<Record<string, unknown>> = [];
    const spacesQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ settings: {} }),
    };
    const aliasesQuery = {
      innerJoin: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([]),
    };
    const trx = {
      selectFrom: jest.fn((table: string) =>
        table === 'spaces' ? spacesQuery : aliasesQuery,
      ),
      updateTable: jest.fn(() => ({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      })),
      insertInto: jest.fn((table: string) => {
        const query = {
          values: jest.fn((values: Array<Record<string, unknown>>) => {
            if (table === 'dictionaryTermAliases') insertedAliases = values;
            return query;
          }),
          execute: jest.fn().mockResolvedValue(undefined),
        };
        return query;
      }),
    };
    const service = new DocmostArchiveImportService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).applySettingsAndDictionary({
      data: {
        sourceSpace: { settings: {} },
        dictionary: [
          {
            term: 'Foo',
            forms: [' foo ', '\uff26\uff4f\uff4f'],
            definitionMarkdown: 'definition',
          },
        ],
      },
      fileTask: {
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
        creatorId: 'user-1',
      },
      options: {
        applyDictionary: true,
        applyDocumentFields: false,
        applyHeadingNumbering: false,
        cleanupLegacyHeadingNumbers: true,
      },
      report: {
        created: { dictionaryTerms: 0 },
        updated: { dictionaryTerms: 0 },
        skipped: { dictionaryTerms: 0 },
        warnings: [],
      },
      trx,
    });

    expect(insertedAliases).toHaveLength(1);
    expect(insertedAliases[0]).toEqual(
      expect.objectContaining({ alias: 'Foo', normalizedAlias: 'foo' }),
    );
  });
});

describe('DocmostArchiveImportService import durability', () => {
  const createService = (db: any, storageService: any) =>
    new DocmostArchiveImportService(
      db,
      {} as any,
      {} as any,
      storageService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  const report = {
    created: {
      pages: 1,
      databases: 0,
      rows: 0,
      attachments: 1,
      labels: 0,
      dictionaryTerms: 0,
    },
    updated: { dictionaryTerms: 0 },
    skipped: {
      dictionaryTerms: 0,
      userReferences: 0,
      pageReferences: 0,
    },
    warnings: [],
  };

  it('retries attachment uploads with a fresh stream and succeeds', async () => {
    const extractDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'docmost-attachment-retry-'),
    );
    await fs.mkdir(path.join(extractDir, 'attachments'), { recursive: true });
    await fs.writeFile(
      path.join(extractDir, 'attachments', 'source.bin'),
      'portable attachment',
    );
    let attempts = 0;
    const streams = new Set<unknown>();
    const storageService = {
      uploadStream: jest.fn(async (_filePath: string, stream: any) => {
        streams.add(stream);
        stream.destroy();
        attempts += 1;
        if (attempts < 3) throw new Error('synthetic storage failure');
      }),
      delete: jest.fn(async () => undefined),
    };
    const service = createService({}, storageService);
    jest
      .spyOn(service as any, 'waitForAttachmentRetry')
      .mockResolvedValue(undefined);

    try {
      const staged = await (service as any).stageAttachments({
        extractDir,
        fileTask: {
          workspaceId: 'workspace-1',
          spaceId: 'space-1',
          creatorId: 'user-1',
        },
        data: {
          attachments: [
            {
              id: 'attachment-source',
              pageId: 'page-source',
              archivePath: 'attachments/source.bin',
              fileName: 'source.bin',
              fileSize: 19,
              fileExt: 'bin',
              mimeType: 'application/octet-stream',
              type: 'file',
            },
          ],
        },
        pageIdMap: new Map([['page-source', 'page-target']]),
        attachmentIdMap: new Map([
          ['attachment-source', 'attachment-target'],
        ]),
        snapshotAttachmentMapsByConsumer: new Map(),
      });

      expect(storageService.uploadStream).toHaveBeenCalledTimes(3);
      expect(streams.size).toBe(3);
      expect(staged).toHaveLength(1);
      expect(storageService.delete).not.toHaveBeenCalled();
    } finally {
      await fs.rm(extractDir, { recursive: true, force: true });
    }
  });

  it('removes a partial storage object after retries are exhausted', async () => {
    const extractDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'docmost-attachment-failure-'),
    );
    await fs.mkdir(path.join(extractDir, 'attachments'), { recursive: true });
    await fs.writeFile(
      path.join(extractDir, 'attachments', 'source.bin'),
      'portable attachment',
    );
    const storageService = {
      uploadStream: jest.fn(async (_filePath: string, stream: any) => {
        stream.destroy();
        throw new Error('synthetic storage failure');
      }),
      delete: jest.fn(async () => undefined),
    };
    const service = createService({}, storageService);
    jest
      .spyOn(service as any, 'waitForAttachmentRetry')
      .mockResolvedValue(undefined);

    try {
      await expect(
        (service as any).stageAttachments({
          extractDir,
          fileTask: {
            workspaceId: 'workspace-1',
            spaceId: 'space-1',
            creatorId: 'user-1',
          },
          data: {
            attachments: [
              {
                id: 'attachment-source',
                pageId: 'page-source',
                archivePath: 'attachments/source.bin',
                fileName: 'source.bin',
                fileSize: 19,
                fileExt: 'bin',
                mimeType: 'application/octet-stream',
                type: 'file',
              },
            ],
          },
          pageIdMap: new Map([['page-source', 'page-target']]),
          attachmentIdMap: new Map([
            ['attachment-source', 'attachment-target'],
          ]),
          snapshotAttachmentMapsByConsumer: new Map(),
        }),
      ).rejects.toThrow('synthetic storage failure');
      expect(storageService.uploadStream).toHaveBeenCalledTimes(3);
      expect(storageService.delete).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(extractDir, { recursive: true, force: true });
    }
  });

  it('marks task success inside the materialization transaction', async () => {
    const executeTakeFirst = jest.fn(async () => ({ numUpdatedRows: 1n }));
    const secondWhere = jest.fn(() => ({ executeTakeFirst }));
    const firstWhere = jest.fn(() => ({ where: secondWhere }));
    const set = jest.fn(() => ({ where: firstWhere }));
    const trx = { updateTable: jest.fn(() => ({ set })) };
    const service = createService({}, {});

    await (service as any).markImportCommitted(
      trx,
      {
        id: 'task-1',
        result: { preview: { displayName: 'Archive' } },
      },
      report,
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        errorMessage: null,
        result: {
          preview: { displayName: 'Archive' },
          report,
        },
      }),
    );
    expect(secondWhere).toHaveBeenCalledWith('status', '=', 'processing');
  });

  it('aborts materialization when the task state fence is lost', async () => {
    const executeTakeFirst = jest.fn(async () => ({ numUpdatedRows: 0n }));
    const trx = {
      updateTable: jest.fn(() => ({
        set: () => ({
          where: () => ({ where: () => ({ executeTakeFirst }) }),
        }),
      })),
    };
    const service = createService({}, {});

    await expect(
      (service as any).markImportCommitted(
        trx,
        { id: 'task-1', result: null },
        report,
      ),
    ).rejects.toThrow('no longer in processing state');
  });
});
