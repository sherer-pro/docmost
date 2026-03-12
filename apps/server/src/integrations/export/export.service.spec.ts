jest.mock('../../collaboration/collaboration.util', () => ({
  jsonToHtml: () => '<p>mock-content</p>',
  jsonToNode: (input: any) => ({
    descendants: (callback: (node: any, pos?: number) => void) => {
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') {
          return;
        }

        if (node.type === 'mention') {
          callback(
            {
              type: { name: 'mention' },
              attrs: node.attrs ?? {},
              marks: node.marks ?? [],
              isText: false,
            },
            0,
          );
        }

        if (node.type === 'text') {
          callback({
            type: { name: 'text' },
            attrs: node.attrs ?? {},
            marks: node.marks ?? [],
            isText: true,
            text: node.text ?? '',
          });
        }

        if (Array.isArray(node.content)) {
          node.content.forEach(visit);
        }
      };

      visit(input);
    },
    toJSON: () => input,
  }),
}));

import { ExportService } from './export.service';
import { ExportFormat } from './dto/export-dto';
import * as JSZip from 'jszip';

describe('ExportService PDF export', () => {
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
  };

  const htmlPdfRendererService = {
    render: jest.fn<Promise<Buffer>, [string, { attachmentToken?: string }?]>(
      async () => Buffer.from('%PDF-1.7 mock'),
    ),
  };

  const tokenService = {
    generateAttachmentPageToken: jest.fn(async () => 'attachment-page-token'),
  };

  const service = new ExportService(
    pageRepo as any,
    db as any,
    storageService as any,
    environmentService as any,
    htmlPdfRendererService as any,
    tokenService as any,
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
    mockUserLookup([]);
  });

  it('exports a page as PDF through HTML renderer', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });

    const exported = await service.exportPage(ExportFormat.PDF, page as any, true);

    expect(Buffer.isBuffer(exported)).toBe(true);
    expect(htmlPdfRendererService.render).toHaveBeenCalledTimes(1);
    const [renderedHtml, renderOpts] = htmlPdfRendererService.render.mock.calls[0];
    expect(renderedHtml).toContain('<meta charset="UTF-8" />');
    expect(renderOpts).toEqual({ attachmentToken: 'attachment-page-token' });
  });

  it('normalizes private attachment URLs to public URLs for PDF content', async () => {
    const page = createPage({
      id: 'page-1',
      slugId: 'slug-1',
      title: 'Root',
      parentPageId: null,
      text: 'Hello from page',
    });

    const body = await service.buildPagePdfBody({
      page: page as any,
      pageHtml:
        '<p><img src="/api/files/file-1/image.png?t=10" alt="img" /></p>' +
        '<div data-type="drawio" data-src="/api/files/file-2/diagram.drawio.svg"></div>',
    });

    expect(body.bodyHtml).toContain(
      'http://localhost:3000/api/files/public/file-1/image.png?t=10',
    );
    expect(body.bodyHtml).toContain(
      'http://localhost:3000/api/files/public/file-2/diagram.drawio.svg',
    );
    expect(body.bodyHtml).toContain('<img');
    expect(body.attachmentToken).toBe('attachment-page-token');
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
    const previousSelectFromImplementation = db.selectFrom.getMockImplementation();
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
});
