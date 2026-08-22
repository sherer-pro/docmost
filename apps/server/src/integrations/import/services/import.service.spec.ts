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

function duplicateCentralDirectoryEntry(
  archive: Buffer,
  entryName: string,
): Buffer {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const centralSignature = 0x02014b50;
  const endOffset = archive.lastIndexOf(endSignature);
  if (endOffset < 0) throw new Error('ZIP end record not found');

  const centralOffset = archive.readUInt32LE(endOffset + 16);
  let cursor = centralOffset;
  let duplicate: Buffer | undefined;
  while (cursor < endOffset) {
    if (archive.readUInt32LE(cursor) !== centralSignature) break;
    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const recordLength = 46 + fileNameLength + extraLength + commentLength;
    const name = archive
      .subarray(cursor + 46, cursor + 46 + fileNameLength)
      .toString('utf8');
    if (name === entryName) {
      duplicate = Buffer.from(archive.subarray(cursor, cursor + recordLength));
      break;
    }
    cursor += recordLength;
  }
  if (!duplicate) throw new Error(`ZIP entry not found: ${entryName}`);

  const endRecord = Buffer.from(archive.subarray(endOffset));
  endRecord.writeUInt16LE(endRecord.readUInt16LE(8) + 1, 8);
  endRecord.writeUInt16LE(endRecord.readUInt16LE(10) + 1, 10);
  endRecord.writeUInt32LE(endRecord.readUInt32LE(12) + duplicate.length, 12);
  return Buffer.concat([archive.subarray(0, endOffset), duplicate, endRecord]);
}

describe('ImportService Docmost archive preview', () => {
  const service = new ImportService({} as any, {} as any, {} as any, {} as any);

  const buildArchive = async (overrides?: {
    schemaVersion?: number | string;
    includeAttachmentFile?: boolean;
    unknownNode?: boolean;
    nestedPageEmbed?: boolean;
    corruptAttachmentChecksum?: boolean;
    attachmentConsumers?: number;
    corruptRepeatedAttachmentChecksum?: boolean;
    attachmentFileSize?: number | string | null;
    attachmentPayload?: string;
  }) => {
    const schemaVersion =
      overrides?.schemaVersion ?? DOCMOST_ARCHIVE_SCHEMA_VERSION;
    const attachmentPayload = overrides?.attachmentPayload ?? '<svg/>';
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
            tags: { disabled: ['future'] },
            ...(overrides?.nestedPageEmbed
              ? {
                  maliciousPayload: {
                    nested: [{ type: 'pageEmbed', attrs: {} }],
                  },
                }
              : {}),
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
        attachments: Array.from(
          { length: overrides?.attachmentConsumers ?? 1 },
          (_, index) => ({
            id:
              index === 0 ? 'attachment-source' : `attachment-source-${index}`,
            pageId: 'page-source',
            fileName: `diagram-${index}.svg`,
            fileSize: Object.prototype.hasOwnProperty.call(
              overrides ?? {},
              'attachmentFileSize',
            )
              ? overrides?.attachmentFileSize
              : Buffer.byteLength(attachmentPayload),
            fileExt: '.svg',
            mimeType: 'image/svg+xml',
            type: 'file',
            archivePath: 'files/attachment-source/diagram.svg',
            sha256:
              overrides?.corruptAttachmentChecksum ||
              (overrides?.corruptRepeatedAttachmentChecksum && index === 1)
                ? '0'.repeat(64)
                : createHash('sha256').update(attachmentPayload).digest('hex'),
          }),
        ),
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
          tags: true,
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

  it.each([2, 3, 4])('rejects retired archive schema %s', async (version) => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({ schemaVersion: version }),
      ),
    ).rejects.toThrow(
      `schema ${version} is not supported; only schema ${DOCMOST_ARCHIVE_SCHEMA_VERSION} is accepted`,
    );
  });

  it('requires the schema version to be the exact numeric value', async () => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({
          schemaVersion: String(DOCMOST_ARCHIVE_SCHEMA_VERSION),
        }),
      ),
    ).rejects.toThrow('schema unknown is not supported');
  });

  it('rejects a deeply nested pageEmbed marker outside editor content', async () => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({ nestedPageEmbed: true }),
      ),
    ).rejects.toThrow('schema 5 cannot contain pageEmbed nodes');
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

  it('reads a shared attachment entry once for every consumer descriptor', async () => {
    const readEntry = jest.spyOn(service as any, 'readArchiveEntry');
    try {
      const preview = await (service as any).inspectDocmostArchive(
        await buildArchive({ attachmentConsumers: 32 }),
      );

      expect(preview.counts.attachments).toBe(32);
      expect(readEntry).toHaveBeenCalledTimes(3);
    } finally {
      readEntry.mockRestore();
    }
  });

  it('accepts a legacy nullable attachment size after verifying non-empty bytes', async () => {
    const preview = await (service as any).inspectDocmostArchive(
      await buildArchive({ attachmentFileSize: null }),
    );

    expect(preview.counts.attachments).toBe(1);
  });

  it.each([
    'abc',
    '01',
    '9223372036854775808',
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects non-canonical attachment size metadata %p', async (fileSize) => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({ attachmentFileSize: fileSize }),
      ),
    ).rejects.toThrow('invalid size metadata');
  });

  it('rejects attachment descriptor amplification above the count cap', async () => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({ attachmentConsumers: 10_001 }),
      ),
    ).rejects.toThrow('attachment descriptor count exceeds 10000');
  });

  it('counts shared physical bytes once per descriptor against the logical cap', async () => {
    await expect(
      (service as any).inspectDocmostArchive(
        await buildArchive({
          attachmentConsumers: 513,
          attachmentPayload: 'x'.repeat(1024 * 1024),
        }),
      ),
    ).rejects.toThrow('logical attachment size exceeds the limit');
  });

  it('checks every shared-entry descriptor against cached physical metadata', async () => {
    const readEntry = jest.spyOn(service as any, 'readArchiveEntry');
    try {
      await expect(
        (service as any).inspectDocmostArchive(
          await buildArchive({
            attachmentConsumers: 2,
            corruptRepeatedAttachmentChecksum: true,
          }),
        ),
      ).rejects.toThrow('checksum does not match');
      expect(readEntry).toHaveBeenCalledTimes(3);
    } finally {
      readEntry.mockRestore();
    }
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

  it('rejects symbolic-link entries during preview', async () => {
    const archive = await buildArchive();
    const zip = await JSZip.loadAsync(archive);
    zip.file('unsafe-link', '../outside.txt', {
      unixPermissions: 0o120777,
    });

    await expect(
      (service as any).inspectDocmostArchive(
        await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }),
      ),
    ).rejects.toThrow('symbolic link');
  });

  it('rejects duplicate ZIP entry names during preview', async () => {
    const archive = duplicateCentralDirectoryEntry(
      await buildArchive(),
      'docmost-data.json',
    );

    await expect(
      (service as any).inspectDocmostArchive(archive),
    ).rejects.toThrow('duplicate ZIP entry');
  });

  it.each([2, 3, 4, 6])(
    'rejects confirmation of a task previewed with schema %s',
    async (schemaVersion) => {
      const query: any = {
        selectAll: jest.fn(() => query),
        where: jest.fn(() => query),
        executeTakeFirst: jest.fn(async () => ({
          id: 'task-1',
          source: 'docmost',
          creatorId: 'user-1',
          workspaceId: 'workspace-1',
          status: 'pending',
          result: { preview: { schemaVersion } },
        })),
      };
      const confirmationService = new ImportService(
        {} as any,
        {} as any,
        { selectFrom: jest.fn(() => query) } as any,
        {} as any,
      );

      await expect(
        (confirmationService as any).getPendingDocmostImportTask(
          'task-1',
          'user-1',
          'workspace-1',
        ),
      ).rejects.toThrow(
        schemaVersion > DOCMOST_ARCHIVE_SCHEMA_VERSION
          ? 'newer than supported'
          : `schema ${schemaVersion} is not supported`,
      );
    },
  );
});
