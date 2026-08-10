jest.mock('../../collaboration/collaboration.util', () => ({
  jsonToHtml: (input: any) => {
    const render = (node: any): string => {
      const text = (node.content ?? [])
        .map((child: any) => child.text ?? '')
        .join('');
      if (node.type === 'heading') {
        return `<h${node.attrs?.level}>${text}</h${node.attrs?.level}>`;
      }
      if (node.type === 'transclusionSource') {
        return `<div data-type="transclusionSource" data-docmost-transclusion="true" style="border: 1px dashed"><div data-docmost-transclusion-content>${(node.content ?? []).map(render).join('')}</div></div>`;
      }
      if (node.type === 'pageBreak') {
        return '<div data-type="pageBreak" class="page-break"></div>';
      }
      return `<p>${text || 'mock-content'}</p>`;
    };

    return (input.content ?? []).map(render).join('');
  },
  jsonToNode: (input: any) => ({
    descendants: (callback: (node: any, pos?: number) => void) => {
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') {
          return;
        }

        if (typeof node.type === 'string') {
          callback(
            {
              type: { name: node.type },
              attrs: node.attrs ?? {},
              marks: node.marks ?? [],
              isText: node.type === 'text',
              text: node.type === 'text' ? (node.text ?? '') : undefined,
            },
            0,
          );
        }

        if (Array.isArray(node.content)) {
          node.content.forEach(visit);
        }
      };

      (input.content ?? []).forEach(visit);
    },
    toJSON: () => input,
  }),
}));

import { ExportService } from './export.service';
import { ExportFormat } from './dto/export-dto';
import * as JSZip from 'jszip';

describe('ExportService PDF export', () => {
  let spaceSettings: Record<string, unknown> = {};

  const pageRepo = {
    findById: jest.fn(),
    getPageAndDescendants: jest.fn(),
  };

  const db = {
    selectFrom: jest.fn(),
  };

  const storageService = {
    read: jest.fn(),
  };

  const environmentService = {
    getAppUrl: jest.fn(() => 'http://localhost:3000'),
    getMaxPageEmbedDepth: jest.fn(() => 5),
  };

  const htmlPdfRendererService = {
    render: jest.fn<
      Promise<Buffer>,
      [
        string,
        {
          attachmentToken?: string;
          attachmentTokens?: Record<string, string>;
        }?,
      ]
    >(async () => Buffer.from('%PDF-1.7 mock')),
  };

  const tokenService = {
    generateAttachmentToken: jest.fn(
      async ({ attachmentId }: { attachmentId: string }) =>
        `attachment-token:${attachmentId}`,
    ),
    generateAttachmentPageToken: jest.fn(async () => 'attachment-page-token'),
    generateAttachmentPageSetToken: jest.fn(
      async () => 'attachment-page-token',
    ),
  };

  const pageAccessService = {
    getEffectiveAccessForPages: jest.fn(
      async (pages: Array<{ id: string }>) => {
        return new Map(
          pages.map((page) => [page.id, { capabilities: { canRead: true } }]),
        );
      },
    ),
  };

  const transclusionService = {
    lookup: jest.fn(async () => ({ items: [] })),
  };
  const pageEmbedService = {
    lookup: jest.fn(async () => ({ items: [] })),
  };

  const service = new ExportService(
    pageRepo as any,
    db as any,
    storageService as any,
    environmentService as any,
    htmlPdfRendererService as any,
    tokenService as any,
    pageAccessService as any,
    transclusionService as any,
    pageEmbedService as any,
  );

  const streamToBuffer = async (
    stream: NodeJS.ReadableStream,
  ): Promise<Buffer> => {
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
          return;
        }

        chunks.push(Buffer.from(chunk));
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  };

  const createPage = (params: {
    id: string;
    slugId: string;
    title: string;
    parentPageId: string | null;
    text: string;
    settings?: Record<string, unknown>;
  }) => ({
    id: params.id,
    slugId: params.slugId,
    title: params.title,
    parentPageId: params.parentPageId,
    position: 'a1',
    icon: null,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: params.text }],
        },
      ],
    },
    settings: params.settings ?? {},
    spaceId: 'space-1',
    workspaceId: 'ws-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const mockUserLookup = (users: Array<{ id: string; name: string }>) => {
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'spaces') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => ({ settings: spaceSettings }),
            }),
          }),
        };
      }

      if (tableName !== 'users') {
        return {
          select: () => ({
            where: () => ({
              where: () => ({
                execute: async () => [],
              }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          where: () => ({
            where: () => ({
              execute: async () => users,
            }),
          }),
        }),
      };
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    spaceSettings = {};
    mockUserLookup([]);
    transclusionService.lookup.mockResolvedValue({ items: [] });
  });

  it('materializes references with a framed localized snapshot', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'unused',
    });
    (page as any).content = {
      type: 'doc',
      content: [
        {
          type: 'transclusionReference',
          attrs: { sourcePageId: 'source-1', transclusionId: 'block-1' },
        },
      ],
    };
    const user = { id: 'user-1', workspaceId: 'ws-1' } as any;
    transclusionService.lookup.mockResolvedValue({
      items: [
        {
          sourcePageId: 'source-1',
          transclusionId: 'block-1',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Shared text' }],
              },
            ],
          },
          sourceUpdatedAt: new Date(),
        },
      ],
    });

    const exported = await service.exportPage(
      ExportFormat.HTML,
      page as any,
      true,
      'ru-RU',
      undefined,
      undefined,
      user,
    );

    expect(transclusionService.lookup).toHaveBeenCalledWith(
      [{ sourcePageId: 'source-1', transclusionId: 'block-1' }],
      user,
    );
    expect(exported).toContain('Синхронизируемый блок');
    expect(exported).toContain('Shared text');
    expect(exported).toContain('border: 1px dashed');
  });

  it('does not expose denied reference content', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'unused',
    });
    (page as any).content = {
      type: 'doc',
      content: [
        {
          type: 'transclusionReference',
          attrs: { sourcePageId: 'source-1', transclusionId: 'block-1' },
        },
      ],
    };
    transclusionService.lookup.mockResolvedValue({
      items: [
        {
          sourcePageId: 'source-1',
          transclusionId: 'block-1',
          status: 'no_access',
        },
      ],
    });

    const exported = await service.exportPage(
      ExportFormat.HTML,
      page as any,
      true,
      'ru-RU',
      undefined,
      undefined,
      { id: 'user-1', workspaceId: 'ws-1' } as any,
    );

    expect(exported).toContain('Содержимое недоступно');
    expect(exported).not.toContain('Secret source content');
  });

  it('exports a page as PDF through HTML renderer', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });
    (page as any).content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    };

    const exported = await service.exportPage(
      ExportFormat.PDF,
      page as any,
      true,
    );

    expect(Buffer.isBuffer(exported)).toBe(true);
    expect(htmlPdfRendererService.render).toHaveBeenCalledTimes(1);
    const [renderedHtml, renderOpts] =
      htmlPdfRendererService.render.mock.calls[0];
    expect(renderedHtml).toContain('<meta charset="UTF-8" />');
    expect(renderedHtml).toContain('table-layout: fixed;');
    expect(renderedHtml).toContain('overflow-wrap: anywhere;');
    expect(renderedHtml).toContain('word-break: break-word;');
    expect(renderedHtml).toContain('page-break-after: always;');
    expect(renderedHtml).toContain(
      '<div data-type="pageBreak" class="page-break"></div>',
    );
    expect(renderOpts).toEqual({
      attachmentToken: undefined,
      attachmentTokens: {},
    });
  });

  it('numbers body headings without numbering the page title', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'unused',
      settings: { headingNumbering: { enabled: false } },
    });
    (page as any).content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Section' }],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Child' }],
        },
      ],
    };

    const exported = await service.exportPage(
      ExportFormat.HTML,
      page as any,
      true,
      undefined,
      true,
    );

    expect(exported).toContain('<h1>Root</h1>');
    expect(exported).not.toContain('<h1>1. Root</h1>');
    expect(exported).toContain('<h2>1. Section</h2>');
    expect(exported).toContain('<h3>1.1. Child</h3>');
  });

  it('normalizes private attachment URLs to public URLs for PDF content', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });

    const firstAttachmentId = '11111111-1111-4111-8111-111111111111';
    const secondAttachmentId = '22222222-2222-4222-8222-222222222222';
    const previousSelectFromImplementation =
      db.selectFrom.getMockImplementation();
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'attachments') {
        const query: any = {
          select: () => query,
          where: () => query,
          executeTakeFirst: async () => undefined,
          execute: async () => [
            { id: firstAttachmentId, pageId: 'page-1', filePath: null },
            {
              id: secondAttachmentId,
              pageId: 'embedded-page',
              filePath: null,
            },
          ],
        };
        return query;
      }
      return previousSelectFromImplementation?.(tableName);
    });

    const body = await service.buildPagePdfBody({
      page: page as any,
      pageHtml: `<p><img src="/api/files/${firstAttachmentId}/image.png?t=10" alt="img" /></p><div data-type="drawio" data-src="/api/files/${secondAttachmentId}/diagram.drawio.svg"></div>`,
      attachmentPageIds: ['page-1', 'embedded-page'],
      attachmentIds: [],
    });

    expect(body.bodyHtml).toContain(
      `http://localhost:3000/api/files/public/${firstAttachmentId}/image.png?t=10`,
    );
    expect(body.bodyHtml).toContain(
      `http://localhost:3000/api/files/public/${secondAttachmentId}/diagram.drawio.svg`,
    );
    expect(body.bodyHtml).toContain('<img');
    expect(body.attachmentTokens).toEqual({
      [firstAttachmentId]: `attachment-token:${firstAttachmentId}`,
      [secondAttachmentId]: `attachment-token:${secondAttachmentId}`,
    });
    expect(tokenService.generateAttachmentToken).toHaveBeenCalledTimes(2);
    db.selectFrom.mockImplementation(previousSelectFromImplementation!);
  });

  it('does not ZIP an attachment whose proven owner page is outside the materialized set', async () => {
    const attachmentId = '11111111-1111-4111-8111-111111111111';
    const previousSelectFromImplementation =
      db.selectFrom.getMockImplementation();
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'attachments') {
        const query: any = {
          selectAll: () => query,
          where: () => query,
          execute: async () => [
            {
              id: attachmentId,
              pageId: 'foreign-page',
              filePath: 'foreign/file.png',
              fileName: 'file.png',
            },
          ],
        };
        return query;
      }

      return previousSelectFromImplementation?.(tableName);
    });
    const zip = new JSZip();

    await service.zipAttachments(
      {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              attachmentId,
              src: `/api/files/${attachmentId}/file.png`,
            },
          },
        ],
      },
      'space-1',
      'workspace-1',
      zip,
      new Set(['consumer-page']),
    );

    expect(storageService.read).not.toHaveBeenCalled();
    expect(Object.keys(zip.files)).toEqual([]);
    db.selectFrom.mockImplementation(previousSelectFromImplementation!);
  });

  it('stores exported attachments under relative archive paths', async () => {
    const attachmentId = '11111111-1111-4111-8111-111111111111';
    const previousSelectFromImplementation =
      db.selectFrom.getMockImplementation();
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'attachments') {
        const query: any = {
          selectAll: () => query,
          where: () => query,
          execute: async () => [
            {
              id: attachmentId,
              pageId: 'page-1',
              filePath: 'page/file.png',
              fileName: 'file.png',
            },
          ],
        };
        return query;
      }

      return previousSelectFromImplementation?.(tableName);
    });
    storageService.read.mockResolvedValue(Buffer.from('image'));
    const zip = new JSZip();

    await service.zipAttachments(
      {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              attachmentId,
              src: `/api/files/${attachmentId}/file.png`,
            },
          },
        ],
      },
      'space-1',
      'workspace-1',
      zip,
      new Set(['page-1']),
    );

    expect(Object.keys(zip.files)).toEqual([
      'files/',
      `files/${attachmentId}/`,
      `files/${attachmentId}/file.png`,
    ]);
    expect(Object.keys(zip.files).every((name) => !name.startsWith('/'))).toBe(
      true,
    );
    db.selectFrom.mockImplementation(previousSelectFromImplementation!);
  });

  it('inlines excalidraw diagram svg from storage for PDF content', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });
    const attachmentId = '11111111-1111-4111-8111-111111111111';
    const previousSelectFromImplementation =
      db.selectFrom.getMockImplementation();
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'attachments') {
        return {
          select: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: async () => ({
                  id: attachmentId,
                  filePath: 'storage/diagram.excalidraw.svg',
                  mimeType: 'image/svg+xml',
                  pageId: 'page-1',
                  deletedAt: null,
                }),
              }),
            }),
          }),
        };
      }

      if (previousSelectFromImplementation) {
        return previousSelectFromImplementation(tableName);
      }

      return null;
    });
    storageService.read.mockResolvedValueOnce(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    );

    const body = await service.buildPagePdfBody({
      page: page as any,
      pageHtml: `<div data-type="excalidraw" data-src="/api/files/${attachmentId}/diagram.excalidraw.svg?t=10" data-attachment-id="${attachmentId}" data-title="Excalidraw"></div>`,
    });

    expect(storageService.read).toHaveBeenCalledWith(
      'storage/diagram.excalidraw.svg',
    );
    expect(body.bodyHtml).toContain('<svg');
    expect(body.bodyHtml).toContain('docmost-diagram-image');
  });

  it('replaces an existing Draw.io image with sanitized inline svg', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });
    const attachmentId = '11111111-1111-4111-8111-111111111111';
    const previousSelectFromImplementation =
      db.selectFrom.getMockImplementation();
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'attachments') {
        return {
          select: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: async () => ({
                  id: attachmentId,
                  filePath: 'storage/diagram.drawio.svg',
                  mimeType: 'image/svg+xml',
                  pageId: 'page-1',
                  deletedAt: null,
                }),
              }),
            }),
          }),
        };
      }

      if (previousSelectFromImplementation) {
        return previousSelectFromImplementation(tableName);
      }

      return null;
    });
    storageService.read.mockResolvedValueOnce(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="20" height="20" /></svg>',
      ),
    );

    const body = await service.buildPagePdfBody({
      page: page as any,
      pageHtml: `<div data-type="drawio" data-src="/api/files/${attachmentId}/diagram.drawio.svg" data-attachment-id="${attachmentId}" data-title="Draw.io"><img src="/api/files/${attachmentId}/diagram.drawio.svg" alt="Draw.io" /></div>`,
    });

    expect(storageService.read).toHaveBeenCalledWith(
      'storage/diagram.drawio.svg',
    );
    expect(body.bodyHtml).toContain('<svg');
    expect(body.bodyHtml).toContain('docmost-diagram-image');
    expect(body.bodyHtml).not.toContain('<script');
    expect(body.bodyHtml).not.toContain('onload');
    expect(body.bodyHtml).not.toContain('/api/files/public/');
  });

  it('does not inline a diagram attachment owned by an unauthorized page', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });
    const attachmentId = '11111111-1111-4111-8111-111111111111';
    const previousSelectFromImplementation =
      db.selectFrom.getMockImplementation();
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'attachments') {
        const attachment = {
          id: attachmentId,
          filePath: 'storage/private.drawio.svg',
          mimeType: 'image/svg+xml',
          pageId: 'private-page',
          deletedAt: null,
        };
        const query: any = {
          select: () => query,
          where: () => query,
          executeTakeFirst: async () => attachment,
          execute: async () => [attachment],
        };
        return query;
      }

      return previousSelectFromImplementation?.(tableName);
    });

    const body = await service.buildPagePdfBody({
      page: page as any,
      pageHtml: `<div data-type="drawio" data-src="/api/files/${attachmentId}/private.drawio.svg" data-attachment-id="${attachmentId}"></div>`,
      attachmentPageIds: ['page-1'],
    });

    expect(storageService.read).not.toHaveBeenCalled();
    expect(body.bodyHtml).toContain('/api/files/public/');
    expect(body.bodyHtml).not.toContain('<svg');
    expect(body.attachmentTokens).toEqual({});
    db.selectFrom.mockImplementation(previousSelectFromImplementation!);
  });

  it('inlines authorized raster images for deterministic PDF rendering', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });
    const attachmentId = '11111111-1111-4111-8111-111111111111';
    const previousSelectFromImplementation =
      db.selectFrom.getMockImplementation();
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'attachments') {
        const query: any = {
          select: () => query,
          where: () => query,
          executeTakeFirst: async () => undefined,
          execute: async () => [
            {
              id: attachmentId,
              pageId: 'page-1',
              filePath: 'storage/image.png',
              mimeType: 'image/png',
              deletedAt: null,
            },
          ],
        };
        return query;
      }

      return previousSelectFromImplementation?.(tableName);
    });
    storageService.read.mockResolvedValueOnce(Buffer.from('png-bytes'));

    const body = await service.buildPagePdfBody({
      page: page as any,
      pageHtml: `<p><img src="/api/files/${attachmentId}/image.png" alt="Audit image" /></p>`,
      attachmentPageIds: ['page-1'],
    });

    expect(storageService.read).toHaveBeenCalledWith('storage/image.png');
    expect(body.bodyHtml).toContain(
      `src="data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}"`,
    );
    expect(body.attachmentTokens).toEqual({
      [attachmentId]: `attachment-token:${attachmentId}`,
    });
    db.selectFrom.mockImplementation(previousSelectFromImplementation!);
  });

  it('replaces PDF and built-in iframe viewers with printable fallbacks', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });
    const attachmentId = '11111111-1111-4111-8111-111111111111';
    const previousSelectFromImplementation =
      db.selectFrom.getMockImplementation();
    db.selectFrom.mockImplementation((tableName: string) => {
      if (tableName === 'attachments') {
        const query: any = {
          select: () => query,
          where: () => query,
          executeTakeFirst: async () => undefined,
          execute: async () => [
            { id: attachmentId, pageId: 'page-1', filePath: null },
          ],
        };
        return query;
      }

      return previousSelectFromImplementation?.(tableName);
    });

    const body = await service.buildPagePdfBody({
      page: page as any,
      pageHtml: `<iframe src="/api/files/${attachmentId}/document.pdf"></iframe><iframe src="https://www.youtube.com/embed/audit"></iframe>`,
      attachmentPageIds: ['page-1'],
    });

    expect(body.bodyHtml).not.toContain('<iframe');
    expect(body.bodyHtml).toContain('PDF attachment');
    expect(body.bodyHtml).toContain('Embedded content');
    expect(body.bodyHtml).toContain(
      `http://localhost:3000/api/files/public/${attachmentId}/document.pdf`,
    );
    expect(body.bodyHtml).toContain('https://www.youtube.com/embed/audit');
    db.selectFrom.mockImplementation(previousSelectFromImplementation!);
  });

  it('localizes custom field labels and omits metadata heading', async () => {
    mockUserLookup([
      { id: 'u-1', name: 'Alice' },
      { id: 'u-2', name: 'Bob' },
      { id: 'u-3', name: 'Charlie' },
    ]);

    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
      settings: {
        status: 'IN_PROGRESS',
        assigneeId: 'u-1',
        stakeholderIds: ['u-2', 'u-3'],
      },
    });

    await service.exportPage(ExportFormat.PDF, page as any, true, 'ru-RU');

    const [renderedHtml] = htmlPdfRendererService.render.mock.calls[0];
    expect(renderedHtml).toContain('Статус');
    expect(renderedHtml).toContain('Ответственный');
    expect(renderedHtml).toContain('Интересанты');
    expect(renderedHtml).not.toContain('Document fields');
    expect(renderedHtml).toContain('In progress');
    expect(renderedHtml).toContain('Alice');
    expect(renderedHtml).toContain('Bob, Charlie');
  });

  it('falls back to english custom field labels when locale is unknown', async () => {
    mockUserLookup([{ id: 'u-1', name: 'Alice' }]);

    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
      settings: {
        status: 'DONE',
        assigneeId: 'u-1',
      },
    });

    await service.exportPage(ExportFormat.PDF, page as any, true, 'zz-ZZ');

    const [renderedHtml] = htmlPdfRendererService.render.mock.calls[0];
    expect(renderedHtml).toContain('Status');
    expect(renderedHtml).toContain('Assignee');
    expect(renderedHtml).not.toContain('Document fields');
  });

  it('localizes AI role metadata when the space field is enabled', async () => {
    spaceSettings = { documentFields: { aiRole: true } };
    mockUserLookup([]);
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
      settings: { aiRole: 'COAUTHOR_PLUS' },
    });

    await service.exportPage(ExportFormat.PDF, page as any, true, 'ru-RU');

    const [renderedHtml] = htmlPdfRendererService.render.mock.calls[0];
    expect(renderedHtml).toContain('\u0420\u043e\u043b\u044c \u0418\u0418');
    expect(renderedHtml).toContain(
      '\u0421\u043e\u0430\u0432\u0442\u043e\u0440+',
    );
  });

  it('omits AI role metadata when the space field is disabled', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
      settings: { aiRole: 'AUTHOR' },
    });

    await service.exportPage(ExportFormat.PDF, page as any, true, 'en-US');

    const [renderedHtml] = htmlPdfRendererService.render.mock.calls[0];
    expect(renderedHtml).not.toContain('AI role');
    expect(renderedHtml).not.toContain('Author');
  });

  it('exports pages PDF as ZIP keeping tree hierarchy', async () => {
    pageRepo.getPageAndDescendants.mockResolvedValue([
      createPage({
        id: 'root-page',
        slugId: 'root-slug',
        title: 'Root',
        parentPageId: null,
        text: 'Root content',
      }),
      createPage({
        id: 'child-page',
        slugId: 'child-slug',
        title: 'Child',
        parentPageId: 'root-page',
        text: 'Child content',
      }),
    ]);

    const zipStream = await service.exportPages(
      'root-page',
      ExportFormat.PDF,
      false,
      true,
    );

    const zipBuffer = await streamToBuffer(zipStream as NodeJS.ReadableStream);
    const zip = await JSZip.loadAsync(zipBuffer);

    expect(zip.file('Root.pdf')).toBeDefined();
    expect(zip.file('Root/Child.pdf')).toBeDefined();
    expect(zip.file('docmost-metadata.json')).toBeDefined();
  });

  it('excludes descendants the authorized user may not read', async () => {
    const root = createPage({
      id: 'root-page',
      slugId: 'root-slug',
      title: 'Root',
      parentPageId: null,
      text: 'Root content',
    });
    const denied = createPage({
      id: 'denied-page',
      slugId: 'denied-slug',
      title: 'Denied',
      parentPageId: 'root-page',
      text: 'Secret content',
    });
    // A page below a denied branch must not resurface in the archive.
    const deniedChild = createPage({
      id: 'denied-child-page',
      slugId: 'denied-child-slug',
      title: 'DeniedChild',
      parentPageId: 'denied-page',
      text: 'Secret child content',
    });
    pageRepo.getPageAndDescendants.mockResolvedValue([
      root,
      denied,
      deniedChild,
    ]);

    pageAccessService.getEffectiveAccessForPages.mockResolvedValueOnce(
      new Map<string, any>([
        ['root-page', { capabilities: { canRead: true } }],
        ['denied-page', { capabilities: { canRead: false } }],
        ['denied-child-page', { capabilities: { canRead: true } }],
      ]),
    );

    const zipStream = await service.exportPages(
      'root-page',
      ExportFormat.HTML,
      false,
      true,
      undefined,
      undefined,
      { id: 'user-1', workspaceId: 'workspace-1' } as any,
    );

    const zipBuffer = await streamToBuffer(zipStream as NodeJS.ReadableStream);
    const zip = await JSZip.loadAsync(zipBuffer);

    expect(zip.file('Root.html')).toBeDefined();
    expect(zip.file('Root/Denied.html')).toBeNull();
    expect(zip.file('Root/Denied/DeniedChild.html')).toBeNull();
  });

  it('keeps the whole subtree when no authorized user is supplied', async () => {
    pageRepo.getPageAndDescendants.mockResolvedValue([
      createPage({
        id: 'root-page',
        slugId: 'root-slug',
        title: 'Root',
        parentPageId: null,
        text: 'Root content',
      }),
      createPage({
        id: 'child-page',
        slugId: 'child-slug',
        title: 'Child',
        parentPageId: 'root-page',
        text: 'Child content',
      }),
    ]);

    const zipStream = await service.exportPages(
      'root-page',
      ExportFormat.HTML,
      false,
      true,
    );

    const zipBuffer = await streamToBuffer(zipStream as NodeJS.ReadableStream);
    const zip = await JSZip.loadAsync(zipBuffer);

    expect(zip.file('Root.html')).toBeDefined();
    expect(zip.file('Root/Child.html')).toBeDefined();
    expect(pageAccessService.getEffectiveAccessForPages).not.toHaveBeenCalled();
  });

  it('reparents allowed descendants whose filtered parent is omitted', async () => {
    pageRepo.getPageAndDescendants.mockResolvedValue([
      createPage({
        id: 'root-page',
        slugId: 'root-slug',
        title: 'Root',
        parentPageId: null,
        text: 'Root content',
      }),
      createPage({
        id: 'filtered-parent',
        slugId: 'filtered-parent-slug',
        title: 'Filtered parent',
        parentPageId: 'root-page',
        text: 'Filtered content',
      }),
      createPage({
        id: 'allowed-child',
        slugId: 'allowed-child-slug',
        title: 'Allowed child',
        parentPageId: 'filtered-parent',
        text: 'Allowed content',
      }),
    ]);

    const zipStream = await service.exportPages(
      'root-page',
      ExportFormat.HTML,
      false,
      true,
      undefined,
      undefined,
      undefined,
      new Set(['root-page', 'allowed-child']),
    );
    const zip = await JSZip.loadAsync(
      await streamToBuffer(zipStream as NodeJS.ReadableStream),
    );

    expect(zip.file('Root/Allowed child.html')).toBeDefined();
    expect(zip.file('Root/Filtered parent.html')).toBeNull();
  });

  it('ignores legacy page overrides in one ZIP export', async () => {
    spaceSettings = { headingNumbering: { enabled: true } };
    const root = createPage({
      id: 'root-page',
      slugId: 'root-slug',
      title: 'Root',
      parentPageId: null,
      text: 'unused',
    });
    const child = createPage({
      id: 'child-page',
      slugId: 'child-slug',
      title: 'Child',
      parentPageId: 'root-page',
      text: 'unused',
      settings: { headingNumbering: { enabled: false } },
    });
    for (const page of [root, child]) {
      (page as any).content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Section' }],
          },
        ],
      };
    }
    pageRepo.getPageAndDescendants.mockResolvedValue([root, child]);

    const zipStream = await service.exportPages(
      'root-page',
      ExportFormat.HTML,
      false,
      true,
    );
    const zip = await JSZip.loadAsync(
      await streamToBuffer(zipStream as NodeJS.ReadableStream),
    );
    const rootHtml = await zip.file('Root.html')?.async('string');
    const childHtml = await zip.file('Root/Child.html')?.async('string');

    expect(rootHtml).toContain('<h2>1. Section</h2>');
    expect(childHtml).toContain('<h2>1. Section</h2>');
    expect(
      db.selectFrom.mock.calls.filter(([tableName]) => tableName === 'spaces'),
    ).toHaveLength(1);
  });
});
