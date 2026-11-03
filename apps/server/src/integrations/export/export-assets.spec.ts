jest.mock('../../collaboration/collaboration.util', () => {
  const { Schema } = jest.requireActual('@tiptap/pm/model');
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      text: { group: 'inline' },
      image: {
        group: 'block',
        attrs: { attachmentId: {}, src: {}, url: { default: null } },
      },
    },
    marks: { link: { attrs: { href: {}, target: { default: null } } } },
  });
  return {
    jsonToNode: (input) => schema.nodeFromJSON(input),
    jsonToHtml: () => '',
  };
});

import * as JSZip from 'jszip';
import * as path from 'node:path';
import { ExportService } from './export.service';
import { ExportFormat } from './dto/export-dto';
import { buildTree, updateAttachmentUrlsToLocalPaths } from './utils';

const id = '11111111-1111-4111-8111-111111111111';
const missingId = '22222222-2222-4222-8222-222222222222';
const origin = 'https://docs.example.test';
const image = (src: string, attachmentId = id) => ({
  type: 'doc',
  content: [{ type: 'image', attrs: { attachmentId, src } }],
});

describe('portable attachment URLs', () => {
  const included = [
    { attachmentId: id, archivePath: `Parent/files/${id}/Report % # 日本.png` },
  ];
  it.each([
    `/api/attachments/files/${id}/old.png?token=private`,
    `/api/attachments/files/public/${id}/old.png?token=private`,
    `/api/files/${id}/old.png?download=true`,
    `/api/files/public/${id}/old.png`,
    `/files/${id}/old.png`,
    `${origin}/api/attachments/files/${id}/old.png?token=private#fragment`,
  ])(
    'maps a permitted included attachment from %s to its actual encoded archive entry',
    (src) => {
      const result = updateAttachmentUrlsToLocalPaths(
        image(src),
        included,
        'Parent/Child.html',
        origin,
      );
      expect(result.content[0].attrs.src).toBe(
        `files/${id}/Report%20%25%20%23%20%E6%97%A5%E6%9C%AC.png`,
      );
      expect(JSON.stringify(result)).not.toContain('private');
    },
  );
  it.each([
    `https://foreign.example.test/api/attachments/files/${id}/old.png`,
    `//foreign.example.test/api/files/${id}/old.png`,
    `https://user:password@docs.example.test/api/files/${id}/old.png`,
    `data:image/png;base64,abc`,
    `/api/files/${missingId}/old.png`,
    `/api/files/${id}/old.png/extra`,
    `/api/files-not-an-attachment/${id}/old.png`,
  ])('preserves an unowned or non-attachment URL %s', (src) => {
    expect(
      updateAttachmentUrlsToLocalPaths(
        image(src),
        included,
        'Root.html',
        origin,
      ).content[0].attrs.src,
    ).toBe(src);
  });
});

describe('ZIP attachment and format policies', () => {
  const filename = 'Report % # 日本.png';
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const make = () => {
    const query: any = {
      execute: async () => [
        { id, pageId: 'child', fileName: filename, filePath: 'present' },
        {
          id: missingId,
          pageId: 'child',
          fileName: 'missing.png',
          filePath: 'missing',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          pageId: 'foreign',
          fileName: 'foreign.png',
          filePath: 'foreign',
        },
      ],
    };
    query.selectAll = query.where = () => query;
    const read = jest.fn(async (file: string) => {
      if (file === 'present') return bytes;
      throw new Error('Unavailable fixture');
    });
    const service = new ExportService(
      {} as any,
      { selectFrom: () => query } as any,
      { read } as any,
      { getAppUrl: () => origin } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'materializeTransclusionsWithAccess')
      .mockImplementation(async (content) => ({
        content,
        attachmentPageIds: new Set(['child']),
      }));
    jest
      .spyOn(service, 'turnPageMentionsToLinks')
      .mockImplementation(async (content) => content);
    return { service, read };
  };
  it('resolves a child HTML URL to the exact bytes included in a serialized ZIP and never invents missing entries', async () => {
    const { service, read } = make();
    const zip = new JSZip();
    const rootPage = {
      id: 'root',
      slugId: 'root',
      title: 'Parent',
      parentPageId: null,
      workspaceId: 'workspace',
      content: image(`/api/files/${id}/old.png`),
    } as any;
    const childPage = {
      ...rootPage,
      id: 'child',
      slugId: 'child',
      title: 'Child',
      parentPageId: 'root',
      content: {
        type: 'doc',
        content: [
          image(`/api/attachments/files/${id}/old.png?token=private`)
            .content[0],
          image(`/api/files/${missingId}/missing.png`, missingId).content[0],
        ],
      },
    };
    jest
      .spyOn(service, 'exportPage')
      .mockImplementation(async (_format, page) =>
        JSON.stringify(page.content),
      );
    await service.zipPages(
      buildTree([rootPage, childPage]),
      ExportFormat.HTML,
      zip,
      true,
    );
    const saved = await JSZip.loadAsync(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    const content = JSON.parse(
      await saved.file('Parent/Child.html')!.async('string'),
    );
    const href = content.content[0].attrs.src;
    const entry = path.posix.normalize(
      path.posix.join('Parent', decodeURIComponent(href)),
    );
    expect(entry).toBe(`Parent/files/${id}/${filename}`);
    expect(await saved.file(entry)!.async('nodebuffer')).toEqual(bytes);
    expect(content.content[1].attrs.src).toBe(
      `/api/files/${missingId}/missing.png`,
    );
    expect(
      Object.keys(saved.files).some((name) => name.endsWith('missing.png')),
    ).toBe(false);
    expect(read).not.toHaveBeenCalledWith('foreign');
    expect(JSON.stringify(content)).not.toContain('private');
  });
  it.each([
    ExportFormat.PDF,
    ExportFormat.DOCX,
    ExportFormat.HTML,
    ExportFormat.Markdown,
  ])('keeps the page-link policy for %s', async (format) => {
    const { service } = make();
    const sourceLink = `${origin}/s/space/p/child-child`;
    const rootPage = {
      id: 'root',
      slugId: 'root',
      title: 'Parent',
      parentPageId: null,
      workspaceId: 'workspace',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Open child',
                marks: [{ type: 'link', attrs: { href: sourceLink } }],
              },
            ],
          },
        ],
      },
    } as any;
    const childPage = {
      ...rootPage,
      id: 'child',
      slugId: 'child',
      title: 'Child',
      parentPageId: 'root',
    };
    const outputs: any[] = [];
    jest
      .spyOn(service, 'exportPage')
      .mockImplementation(async (_format, page) => {
        outputs.push(page.content);
        return Buffer.from('fixture');
      });
    await service.zipPages(
      buildTree([rootPage, childPage]),
      format,
      new JSZip(),
      false,
    );
    const href = outputs[0].content[0].content[0].marks[0].attrs.href;
    expect(href).toBe(
      [ExportFormat.PDF, ExportFormat.DOCX].includes(format)
        ? sourceLink
        : `Parent/Child.${format === ExportFormat.HTML ? 'html' : 'md'}`,
    );
  });
});
