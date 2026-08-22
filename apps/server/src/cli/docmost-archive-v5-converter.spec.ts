import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  convertDocmostArchiveJson,
  convertDocmostArchivePath,
} from './docmost-archive-v5-converter';

describe('Docmost archive V5 offline converter', () => {
  const baseData = (schemaVersion = 3) => ({
    schemaVersion,
    scope: 'space',
    sourceSpace: { id: 'space-1', name: 'Space', settings: {} },
    pages: [],
    attachments: [],
    users: [],
    transclusionSnapshots: [],
    databases: [],
    databaseProperties: [],
    databaseRows: [],
    databaseCells: [],
    databaseViews: [],
    labels: [],
    dictionary: [],
  });

  it('materializes nested legacy embeds from archive pages without source access', () => {
    const source = {
      ...baseData(),
      pages: [
        {
          id: 'consumer',
          content: {
            type: 'doc',
            content: [
              {
                type: 'blockquote',
                content: [
                  {
                    type: 'pageEmbed',
                    attrs: { id: 'embed-1', sourcePageId: 'source' },
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'source',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Offline source' }],
              },
            ],
          },
        },
      ],
    };

    const converted = convertDocmostArchiveJson(source);
    const serialized = JSON.stringify(converted.value);

    expect(converted.report).toEqual({
      materializedPageEmbeds: 1,
      unavailablePageEmbeds: 0,
    });
    expect(serialized).toContain('Offline source');
    expect(serialized).not.toContain('pageEmbed');
    expect((converted.value as any).schemaVersion).toBe(5);
  });

  it('normalizes string-encoded consumer and source documents before V5 stamping', () => {
    const source = {
      ...baseData(2),
      pages: [
        {
          id: 'consumer',
          content: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'pageEmbed',
                attrs: { sourcePageId: 'source' },
              },
            ],
          }),
        },
        {
          id: 'source',
          content: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'String source' }],
              },
            ],
          }),
        },
      ],
    };

    const converted = convertDocmostArchiveJson(source).value as any;

    expect(converted.schemaVersion).toBe(5);
    expect(typeof converted.pages[0].content).toBe('object');
    expect(JSON.stringify(converted)).toContain('String source');
    expect(JSON.stringify(converted)).not.toContain('pageEmbed');
  });

  it('fails closed for an unparseable encoded pageEmbed document', () => {
    const source = {
      ...baseData(4),
      pages: [{ id: 'consumer', content: '{"type":"pageEmbed"' }],
    };

    expect(() => convertDocmostArchiveJson(source)).toThrow(
      'unparseable pageEmbed node',
    );
  });

  it('uses a legacy snapshot, removes its sidecar, and preserves modern transclusion snapshots', () => {
    const modernSnapshot = {
      referencePageId: 'consumer',
      sourcePageId: 'external-source',
      transclusionId: 'block-1',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Synced' }] },
        ],
      },
    };
    const source = {
      ...baseData(),
      pages: [
        {
          id: 'consumer',
          content: {
            type: 'doc',
            content: [
              {
                type: 'pageEmbed',
                attrs: { id: 'embed-1', sourcePageId: 'missing-source' },
              },
            ],
          },
        },
      ],
      pageEmbedSnapshots: [
        {
          referencePageId: 'consumer',
          referenceNodeId: 'embed-1',
          sourcePageId: 'missing-source',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Snapshot source' }],
              },
            ],
          },
        },
      ],
      transclusionSnapshots: [modernSnapshot],
    };

    const converted = convertDocmostArchiveJson(source).value as any;

    expect(converted.pageEmbedSnapshots).toBeUndefined();
    expect(converted.transclusionSnapshots).toEqual([modernSnapshot]);
    expect(JSON.stringify(converted.pages)).toContain('Snapshot source');
  });

  it('copies external snapshot attachments to the consumer with deterministic ids', () => {
    const sourceAttachmentId = '11111111-1111-4111-8111-111111111111';
    const source = {
      ...baseData(),
      pages: [
        {
          id: 'consumer',
          content: {
            type: 'doc',
            content: [
              {
                type: 'pageEmbed',
                attrs: { id: 'embed-1', sourcePageId: 'external-source' },
              },
            ],
          },
        },
      ],
      attachments: [
        {
          id: sourceAttachmentId,
          pageId: 'external-source',
          fileName: 'snapshot.png',
          fileSize: 12,
          fileExt: '.png',
          mimeType: 'image/png',
          type: 'file',
          archivePath: `files/${sourceAttachmentId}/snapshot.png`,
          sha256: 'snapshot-sha256',
        },
      ],
      pageEmbedSnapshots: [
        {
          referencePageId: 'consumer',
          referenceNodeId: 'embed-1',
          sourcePageId: 'external-source',
          content: {
            type: 'doc',
            content: [
              {
                type: 'image',
                attrs: {
                  attachmentId: sourceAttachmentId,
                  src: `/api/attachments/files/${sourceAttachmentId}/snapshot.png`,
                },
              },
            ],
          },
        },
      ],
    };

    const first = convertDocmostArchiveJson(source).value as any;
    const second = convertDocmostArchiveJson(source).value as any;
    const copied = first.attachments.find(
      (attachment: any) => attachment.pageId === 'consumer',
    );
    const materialized = first.pages[0].content.content[0];

    expect(copied.id).not.toBe(sourceAttachmentId);
    expect(copied.archivePath).toBe(`files/${sourceAttachmentId}/snapshot.png`);
    expect(copied.sha256).toBe('snapshot-sha256');
    expect(materialized.attrs.attachmentId).toBe(copied.id);
    expect(materialized.attrs.src).toContain(copied.id);
    expect(materialized.attrs.src).not.toContain(sourceAttachmentId);
    expect(
      second.attachments.find(
        (attachment: any) => attachment.pageId === 'consumer',
      ).id,
    ).toBe(copied.id);
  });

  it('keeps source attachments separate from per-consumer materialized copies', () => {
    const sourceAttachmentId = '22222222-2222-4222-8222-222222222222';
    const sourceNode = {
      type: 'attachment',
      attrs: {
        attachmentId: sourceAttachmentId,
        url: `/api/attachments/files/${sourceAttachmentId}/source.pdf`,
      },
    };
    const source = {
      ...baseData(),
      pages: [
        {
          id: 'consumer',
          content: {
            type: 'doc',
            content: [
              {
                type: 'pageEmbed',
                attrs: { id: 'embed-1', sourcePageId: 'source' },
              },
            ],
          },
        },
        {
          id: 'source',
          content: { type: 'doc', content: [sourceNode] },
        },
      ],
      attachments: [
        {
          id: sourceAttachmentId,
          pageId: 'source',
          fileName: 'source.pdf',
          fileSize: 24,
          fileExt: '.pdf',
          mimeType: 'application/pdf',
          type: 'file',
          archivePath: `files/${sourceAttachmentId}/source.pdf`,
          sha256: 'source-sha256',
        },
      ],
    };

    const converted = convertDocmostArchiveJson(source).value as any;
    const sourceAttachment = converted.attachments.find(
      (attachment: any) => attachment.pageId === 'source',
    );
    const consumerAttachment = converted.attachments.find(
      (attachment: any) => attachment.pageId === 'consumer',
    );
    const consumerNode = converted.pages[0].content.content[0];
    const retainedSourceNode = converted.pages[1].content.content[0];

    expect(sourceAttachment.id).toBe(sourceAttachmentId);
    expect(consumerAttachment.id).not.toBe(sourceAttachmentId);
    expect(consumerAttachment.archivePath).toBe(sourceAttachment.archivePath);
    expect(consumerAttachment.sha256).toBe(sourceAttachment.sha256);
    expect(consumerNode.attrs.attachmentId).toBe(consumerAttachment.id);
    expect(consumerNode.attrs.url).toContain(consumerAttachment.id);
    expect(retainedSourceNode.attrs.attachmentId).toBe(sourceAttachmentId);
    expect(retainedSourceNode.attrs.url).toContain(sourceAttachmentId);
  });

  it('materializes database descriptions with their page as the exact snapshot and attachment consumer', () => {
    const sourceAttachmentId = '33333333-3333-4333-8333-333333333333';
    const source = {
      ...baseData(),
      pages: [
        {
          id: 'database-page',
          content: { type: 'doc', content: [] },
        },
        {
          id: 'source-page',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Page fallback' }],
              },
            ],
          },
        },
      ],
      attachments: [
        {
          id: sourceAttachmentId,
          pageId: 'source-page',
          fileName: 'database-description.png',
          fileSize: null,
          fileExt: '.png',
          mimeType: 'image/png',
          type: 'file',
          archivePath: `files/${sourceAttachmentId}/database-description.png`,
          sha256: 'database-description-sha256',
        },
      ],
      databases: [
        {
          id: 'database-1',
          pageId: 'database-page',
          name: 'Database',
          description: null,
          descriptionContent: {
            type: 'doc',
            content: [
              {
                type: 'pageEmbed',
                attrs: { id: 'description-embed', sourcePageId: 'source-page' },
              },
            ],
          },
          icon: null,
        },
      ],
      pageEmbedSnapshots: [
        {
          referencePageId: 'database-page',
          referenceNodeId: 'description-embed',
          sourcePageId: 'source-page',
          content: {
            type: 'doc',
            content: [
              {
                type: 'image',
                attrs: {
                  attachmentId: sourceAttachmentId,
                  src: `/api/attachments/files/${sourceAttachmentId}/database-description.png`,
                },
              },
            ],
          },
        },
      ],
    };

    const first = convertDocmostArchiveJson(source).value as any;
    const second = convertDocmostArchiveJson(source).value as any;
    const materialized = first.databases[0].descriptionContent.content[0];
    const copied = first.attachments.find(
      (attachment: any) => attachment.pageId === 'database-page',
    );

    expect(JSON.stringify(first.databases)).not.toContain('Page fallback');
    expect(materialized.attrs.attachmentId).toBe(copied.id);
    expect(materialized.attrs.src).toContain(copied.id);
    expect(copied.archivePath).toBe(
      `files/${sourceAttachmentId}/database-description.png`,
    );
    expect(copied.sha256).toBe('database-description-sha256');
    expect(copied.fileSize).toBeNull();
    expect(
      second.attachments.find(
        (attachment: any) => attachment.pageId === 'database-page',
      ).id,
    ).toBe(copied.id);
  });

  it('materializes encoded database cell content with the row page as the attachment consumer', () => {
    const sourceAttachmentId = '44444444-4444-4444-8444-444444444444';
    const source = {
      ...baseData(4),
      pages: [
        { id: 'row-page', content: { type: 'doc', content: [] } },
        {
          id: 'source-page',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Cell page fallback' }],
              },
            ],
          },
        },
      ],
      attachments: [
        {
          id: sourceAttachmentId,
          pageId: 'source-page',
          fileName: 'cell.pdf',
          fileSize: 44,
          fileExt: '.pdf',
          mimeType: 'application/pdf',
          type: 'file',
          archivePath: `files/${sourceAttachmentId}/cell.pdf`,
          sha256: 'cell-sha256',
        },
      ],
      databases: [
        {
          id: 'database-1',
          pageId: 'row-page',
          name: 'Database',
          description: null,
          descriptionContent: null,
          icon: null,
        },
      ],
      databaseProperties: [
        {
          id: 'property-1',
          databaseId: 'database-1',
          name: 'Rich content',
          type: 'text',
          position: 1,
          settings: {},
        },
      ],
      databaseRows: [
        {
          id: 'row-1',
          databaseId: 'database-1',
          pageId: 'row-page',
          archived: false,
        },
      ],
      databaseCells: [
        {
          id: 'cell-1',
          databaseId: 'database-1',
          pageId: 'row-page',
          propertyId: 'property-1',
          attachmentId: null,
          value: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'pageEmbed',
                attrs: { id: 'cell-embed', sourcePageId: 'source-page' },
              },
            ],
          }),
        },
        {
          id: 'cell-plain',
          databaseId: 'database-1',
          pageId: 'row-page',
          propertyId: 'property-1',
          attachmentId: null,
          value: '123',
        },
      ],
      pageEmbedSnapshots: [
        {
          referencePageId: 'row-page',
          referenceNodeId: 'cell-embed',
          sourcePageId: 'source-page',
          content: {
            type: 'doc',
            content: [
              {
                type: 'attachment',
                attrs: {
                  attachmentId: sourceAttachmentId,
                  url: `/api/attachments/files/${sourceAttachmentId}/cell.pdf`,
                },
              },
            ],
          },
        },
      ],
    };

    const converted = convertDocmostArchiveJson(source).value as any;
    const materialized = converted.databaseCells[0].value.content[0];
    const copied = converted.attachments.find(
      (attachment: any) => attachment.pageId === 'row-page',
    );

    expect(typeof converted.databaseCells[0].value).toBe('object');
    expect(converted.databaseCells[1].value).toBe('123');
    expect(JSON.stringify(converted.databaseCells)).not.toContain(
      'Cell page fallback',
    );
    expect(materialized.attrs.attachmentId).toBe(copied.id);
    expect(materialized.attrs.url).toContain(copied.id);
    expect(copied.archivePath).toBe(`files/${sourceAttachmentId}/cell.pdf`);
    expect(copied.sha256).toBe('cell-sha256');
  });

  it.each([
    {
      label: 'database description',
      patch: {
        databases: [
          {
            id: 'database-1',
            pageId: null,
            name: 'Database',
            description: null,
            descriptionContent: {
              type: 'doc',
              content: [
                { type: 'pageEmbed', attrs: { sourcePageId: 'source-page' } },
              ],
            },
            icon: null,
          },
        ],
      },
    },
    {
      label: 'database cell',
      patch: {
        databaseCells: [
          {
            id: 'cell-1',
            databaseId: 'database-1',
            pageId: 'unknown-page',
            propertyId: 'property-1',
            attachmentId: null,
            value: {
              type: 'doc',
              content: [
                { type: 'pageEmbed', attrs: { sourcePageId: 'source-page' } },
              ],
            },
          },
        ],
      },
    },
  ])('fails closed when a $label has no known consumer page', ({ patch }) => {
    const source = {
      ...baseData(),
      pages: [
        {
          id: 'source-page',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Source' }],
              },
            ],
          },
        },
      ],
      ...patch,
    };

    expect(() => convertDocmostArchiveJson(source)).toThrow(
      'without a known consumer page',
    );
  });

  it('replaces unresolved and cyclic embeds with neutral content', () => {
    const source = {
      ...baseData(4),
      pages: [
        {
          id: 'page-1',
          content: {
            type: 'doc',
            content: [
              { type: 'pageEmbed', attrs: { sourcePageId: 'page-1' } },
              { type: 'pageEmbed', attrs: { sourcePageId: 'missing' } },
            ],
          },
        },
      ],
    };

    const converted = convertDocmostArchiveJson(source);

    expect(converted.report.unavailablePageEmbeds).toBe(2);
    expect(JSON.stringify(converted.value)).not.toContain('pageEmbed');
    expect(JSON.stringify(converted.value)).toContain(
      'unavailable during offline archive conversion',
    );
  });

  it('rejects malformed and newer schemas instead of guessing', () => {
    expect(() =>
      convertDocmostArchiveJson({ ...baseData(), schemaVersion: '3' }),
    ).toThrow('Only Docmost archive schema versions 2, 3, 4, and 5');
    expect(() => convertDocmostArchiveJson(baseData(6))).toThrow(
      'Only Docmost archive schema versions 2, 3, 4, and 5',
    );
  });

  it('does not stamp a malicious manifest containing a nested pageEmbed node', () => {
    expect(() =>
      convertDocmostArchiveJson({
        source: 'docmost',
        schemaVersion: 4,
        dataFile: 'docmost-data.json',
        malicious: { nested: [{ type: 'pageEmbed' }] },
      }),
    ).toThrow('manifest cannot contain pageEmbed nodes');
  });

  it('converts an extracted archive directory and copies non-JSON artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'docmost-v5-converter-'));
    const input = join(root, 'input');
    const output = join(root, 'output');
    await mkdir(join(input, 'files'), { recursive: true });
    writeFileSync(
      join(input, 'docmost-metadata.json'),
      JSON.stringify({
        source: 'docmost',
        schemaVersion: 3,
        dataFile: 'docmost-data.json',
      }),
    );
    writeFileSync(join(input, 'docmost-data.json'), JSON.stringify(baseData()));
    writeFileSync(join(input, 'files', 'payload.bin'), 'payload');

    try {
      await expect(convertDocmostArchivePath(input, output)).resolves.toEqual({
        materializedPageEmbeds: 0,
        unavailablePageEmbeds: 0,
      });
      expect(
        JSON.parse(readFileSync(join(output, 'docmost-metadata.json'), 'utf8'))
          .schemaVersion,
      ).toBe(5);
      expect(
        JSON.parse(readFileSync(join(output, 'docmost-data.json'), 'utf8'))
          .schemaVersion,
      ).toBe(5);
      expect(readFileSync(join(output, 'files', 'payload.bin'), 'utf8')).toBe(
        'payload',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing JSON output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'docmost-v5-converter-output-'));
    const input = join(root, 'input.json');
    const output = join(root, 'output.json');
    writeFileSync(input, JSON.stringify(baseData(4)));
    writeFileSync(output, 'keep-me');

    try {
      await expect(convertDocmostArchivePath(input, output)).rejects.toThrow();
      expect(readFileSync(output, 'utf8')).toBe('keep-me');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
