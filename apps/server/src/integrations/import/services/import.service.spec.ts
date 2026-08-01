jest.mock('../../../collaboration/collaboration.util', () => ({
  htmlToJson: jest.fn(),
  jsonToText: jest.fn(),
  tiptapExtensions: [],
  jsonToNode: (content: any) => {
    const supported = new Set([
      'doc',
      'paragraph',
      'text',
      'heading',
      'codeBlock',
      'drawio',
      'excalidraw',
    ]);
    const visit = (node: any) => {
      if (!supported.has(node?.type)) throw new Error('unsupported');
      node.content?.forEach(visit);
    };
    visit(content);
    return content;
  },
  strictJsonToNode: (content: any) => {
    const supported = new Set([
      'doc',
      'paragraph',
      'text',
      'heading',
      'codeBlock',
      'drawio',
      'excalidraw',
    ]);
    const visit = (node: any) => {
      if (!supported.has(node?.type)) throw new Error('unsupported');
      node.content?.forEach(visit);
    };
    visit(content);
    return content;
  },
}));

import * as JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { ImportService } from './import.service';
import { DOCMOST_ARCHIVE_SCHEMA_VERSION } from '@docmost/api-contract';

describe('ImportService Docmost archive preview', () => {
  const service = new ImportService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const buildArchive = async (overrides?: {
    schemaVersion?: number;
    includeAttachmentFile?: boolean;
    unknownNode?: boolean;
    corruptAttachmentChecksum?: boolean;
  }) => {
    const schemaVersion =
      overrides?.schemaVersion ?? DOCMOST_ARCHIVE_SCHEMA_VERSION;
    const attachmentPayload = '<svg/>';
    const zip = new JSZip();
    zip.file(
      'docmost-metadata.json',
      JSON.stringify({
        source: 'docmost',
        schemaVersion,
        version: 'test',
        exportedAt: '2026-07-23T00:00:00.000Z',
        scope: 'space',
        displayName: 'Example',
        dataFile: 'docmost-data.json',
        pages: {},
      }),
    );
    zip.file(
      'docmost-data.json',
      JSON.stringify({
        schemaVersion,
        scope: 'space',
        sourceSpace: {
          id: 'space-source',
          name: 'Example',
          settings: {
            documentFields: { status: true },
            dictionary: { enabled: true },
            headingNumbering: { enabled: true },
          },
        },
        pages: [
          {
            id: 'page-source',
            slugId: 'slug',
            title: 'Page',
            icon: null,
            position: 'a1',
            parentPageId: null,
            content: {
              type: 'doc',
              content: [
                overrides?.unknownNode
                  ? { type: 'futureEditorNode' }
                  : {
                      type: 'paragraph',
                      attrs: { textAlign: 'left' },
                    },
              ],
            },
            settings: {},
          },
        ],
        attachments: [
          {
            id: 'attachment-source',
            pageId: 'page-source',
            fileName: 'diagram.svg',
            fileSize: Buffer.byteLength(attachmentPayload),
            fileExt: '.svg',
            mimeType: 'image/svg+xml',
            type: 'file',
            archivePath: 'files/attachment-source/diagram.svg',
            sha256: overrides?.corruptAttachmentChecksum
              ? '0'.repeat(64)
              : createHash('sha256').update(attachmentPayload).digest('hex'),
          },
        ],
        users: [],
        transclusionSnapshots: [],
        databases: [
          {
            id: 'db-source',
            pageId: 'page-source',
            name: 'Database',
            description: null,
            descriptionContent: null,
            icon: null,
          },
        ],
        databaseProperties: [],
        databaseRows: [
          {
            id: 'row-source',
            databaseId: 'db-source',
            pageId: 'page-source',
            archived: false,
          },
        ],
        databaseCells: [],
        databaseViews: [],
        labels: [{ id: 'label-source', name: 'Label', pageIds: [] }],
        dictionary: [{ term: 'Term', forms: [], definitionMarkdown: '' }],
      }),
    );
    if (overrides?.includeAttachmentFile !== false) {
      zip.file('files/attachment-source/diagram.svg', attachmentPayload);
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  };

  it('returns counts and portable settings for a valid archive', async () => {
    const preview = await (service as any).inspectDocmostArchive(
      await buildArchive(),
    );

    expect(preview).toEqual(
      expect.objectContaining({
        schemaVersion: DOCMOST_ARCHIVE_SCHEMA_VERSION,
        scope: 'space',
        displayName: 'Example',
        counts: {
          pages: 1,
          databases: 1,
          rows: 1,
          attachments: 1,
          dictionaryTerms: 1,
          labels: 1,
        },
        availableSettings: {
          documentFields: true,
          dictionary: true,
          headingNumbering: true,
        },
      }),
    );
  });

  it('rejects a newer archive schema', async () => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({ schemaVersion: 999 }),
      ),
    ).rejects.toThrow('newer than supported');
  });

  it('rejects an archive with a missing attachment payload', async () => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({ includeAttachmentFile: false }),
      ),
    ).rejects.toThrow('Archive attachment is missing');
  });

  it('rejects an archive containing an unknown editor node', async () => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({ unknownNode: true }),
      ),
    ).rejects.toThrow('unsupported editor node');
  });

  it('rejects an attachment whose checksum does not match metadata', async () => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({ corruptAttachmentChecksum: true }),
      ),
    ).rejects.toThrow('checksum does not match');
  });

  it('rejects an unsafe ZIP entry before reading archive metadata', async () => {
    const zip = new JSZip();
    zip.file('../outside.txt', 'unsafe');

    await expect(
      (service as any).inspectDocmostArchive(
        await zip.generateAsync({ type: 'nodebuffer' }),
      ),
    ).rejects.toThrow('Unsafe ZIP entry path');
  });
});
