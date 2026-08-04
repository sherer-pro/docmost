jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { DocmostArchiveImportService } from './docmost-archive-import.service';
import {
  remapDatabasePageReference,
  remapDatabaseViewConfig,
} from '../../../core/database/utils/database-copy.utils';

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
            'external-page::block-1',
            {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Snapshot content' }],
                },
              ],
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
