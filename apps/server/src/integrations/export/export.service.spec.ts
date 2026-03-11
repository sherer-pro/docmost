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
    render: jest.fn<Promise<Buffer>, [string]>(
      async () => Buffer.from('%PDF-1.7 mock'),
    ),
  };

  const service = new ExportService(
    pageRepo as any,
    db as any,
    storageService as any,
    environmentService as any,
    htmlPdfRendererService as any,
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
    const [renderedHtml] = htmlPdfRendererService.render.mock.calls[0];
    expect(renderedHtml).toContain('<meta charset="UTF-8" />');
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
