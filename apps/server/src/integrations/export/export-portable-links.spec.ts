jest.mock('@docmost/editor-ext/server', () =>
  jest.requireActual('../../../../../packages/editor-ext/src/server'),
);
jest.mock(
  '../../../../../packages/editor-ext/src/lib/custom-code-block/lowlight-plugin.js',
  () =>
    jest.requireActual(
      '../../../../../packages/editor-ext/src/lib/custom-code-block/lowlight-plugin.ts',
    ),
  { virtual: true },
);
jest.mock('happy-dom', () => {
  const { JSDOM } = jest.requireActual(
    '../../../../../packages/editor-ext/node_modules/jsdom',
  );
  return {
    Window: class {
      constructor() {
        const window = new JSDOM('').window;
        window.happyDOM = {
          abort: () => undefined,
          close: () => window.close(),
        };
        return window;
      }
    },
  };
});

import * as JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { ExportService } from './export.service';
import { ExportFormat } from './dto/export-dto';
import { buildTree } from './utils';
import { jsonToHtml } from '../../collaboration/collaboration.util';

const source = 'https://docs.example.test/s/space/p/childslug';
const link = (text: string, href: string) => ({
  type: 'text',
  text,
  marks: [{ type: 'link', attrs: { href } }],
});
const document = (links: any[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: links }],
});

describe('portable page links through the real JSON-to-HTML renderer', () => {
  const make = () => {
    const renderer = {
      render: jest.fn(async () => Buffer.from('%PDF-fixture')),
    };
    const service = new ExportService(
      {} as any,
      {} as any,
      {} as any,
      { getAppUrl: () => 'https://docs.example.test' } as any,
      renderer as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'materializeTransclusionsWithAccess')
      .mockImplementation(async (content) => ({
        content,
        attachmentPageIds: new Set(['root', 'child']),
      }));
    return { service, renderer };
  };
  const pages = () =>
    [
      {
        id: 'root',
        slugId: 'rootslug',
        workspaceId: 'workspace',
        spaceId: 'space',
        parentPageId: null,
        title: 'Portable export parent % #',
        content: document([
          link('APPROVED_CHILD', source),
          link('UNKNOWN_RELATIVE', 'Unknown%20directory/other%20%25.html'),
          link('EXTERNAL', 'https://example.test/reference?source=export'),
          link(
            'UNAPPROVED_PAGE',
            'https://docs.example.test/s/space/p/missing',
          ),
          link('ENCODED_SCRIPT', 'java%73cript:alert(1)'),
          link('PROTOCOL_RELATIVE', '//evil.example/path'),
        ]),
      },
      {
        id: 'child',
        slugId: 'childslug',
        workspaceId: 'workspace',
        spaceId: 'space',
        parentPageId: 'root',
        title: 'Portable export child 日本 %',
        content: document([{ type: 'text', text: 'Child body' }]),
      },
    ] as any[];

  it('reproduces the sanitizer decoding percent-encoded archive paths in the actual renderer', () => {
    const rendered = jsonToHtml(
      document([
        link(
          'CAPTURED',
          'Portable%20export%20parent%20%25%20%23/Portable%20export%20child%20%E6%97%A5%E6%9C%AC%20%25.html',
        ),
      ]),
    );
    expect(cheerio.load(rendered)('a').attr('href')).toBe(
      'Portable export parent % #/Portable export child 日本 %.html',
    );
  });

  it.each([ExportFormat.HTML, ExportFormat.Markdown])(
    'restores only authorized archive targets before the final %s conversion',
    async (format) => {
      const { service } = make();
      const zip = new JSZip();
      await service.zipPages(
        buildTree(pages()),
        format,
        zip,
        false,
        'en-US',
        false,
        false,
      );
      const extension = format === ExportFormat.HTML ? 'html' : 'md';
      const result = await zip
        .file(`Portable export parent % #.${extension}`)!
        .async('string');
      const expected = `Portable%20export%20parent%20%25%20%23/Portable%20export%20child%20%E6%97%A5%E6%9C%AC%20%25.${extension}`;
      if (format === ExportFormat.HTML) {
        const $ = cheerio.load(result);
        const href = (text: string) =>
          $('a')
            .filter((_, element) => $(element).text() === text)
            .attr('href');
        expect(href('APPROVED_CHILD')).toBe(expected);
        expect(href('UNKNOWN_RELATIVE')).toBe('Unknown directory/other %.html');
        expect(href('EXTERNAL')).toBe(
          'https://example.test/reference?source=export',
        );
        expect(href('UNAPPROVED_PAGE')).toBe(
          'https://docs.example.test/s/space/p/missing',
        );
        expect(href('ENCODED_SCRIPT')).toBe('');
        expect(href('PROTOCOL_RELATIVE')).toBe('');
      } else {
        expect(result).toContain(`[APPROVED_CHILD](${expected})`);
        expect(result).toContain(
          '[EXTERNAL](https://example.test/reference?source=export)',
        );
        expect(result).not.toContain('javascript:');
        expect(result).not.toContain('//evil.example');
      }
      const resolved = decodeURIComponent(
        new URL(expected, 'https://portable.invalid/root.html').pathname.slice(
          1,
        ),
      );
      expect(zip.file(resolved)).not.toBeNull();
    },
  );

  it('rejects different authorized paths that the sanitizer collapses to one href', async () => {
    const { service } = make();
    const sourcePages = pages();
    sourcePages[0].title = 'Parent';
    sourcePages[1].title = 'A%20B';
    sourcePages.push({
      ...sourcePages[1],
      id: 'second-child',
      slugId: 'secondslug',
      title: 'A B',
    });
    await expect(
      service.zipPages(
        buildTree(sourcePages),
        ExportFormat.HTML,
        new JSZip(),
        false,
        'en-US',
        false,
        false,
      ),
    ).rejects.toThrow('Archive page links are ambiguous after sanitization');
  });

  it('permits unreferenced colliding filenames without changing unrelated external links', async () => {
    const { service } = make();
    const sourcePages = pages();
    sourcePages[0].title = 'Parent';
    sourcePages[0].content = document([
      link('EXTERNAL', 'https://example.test/reference'),
    ]);
    sourcePages[1].title = 'A%20B';
    sourcePages.push({
      ...sourcePages[1],
      id: 'second-child',
      slugId: 'secondslug',
      title: 'A B',
    });
    const zip = new JSZip();
    await service.zipPages(
      buildTree(sourcePages),
      ExportFormat.HTML,
      zip,
      false,
      'en-US',
      false,
      false,
    );
    expect(zip.file('Parent/A%20B.html')).not.toBeNull();
    expect(zip.file('Parent/A B.html')).not.toBeNull();
    const $ = cheerio.load(await zip.file('Parent.html')!.async('string'));
    expect($('a').attr('href')).toBe('https://example.test/reference');
  });

  it.each([ExportFormat.PDF, ExportFormat.DOCX])(
    'keeps canonical links out of the archive restoration path for %s',
    async (format) => {
      const { service } = make();
      const captured: string[] = [];
      jest
        .spyOn(service, 'buildPagePdfBody')
        .mockImplementation(async ({ pageHtml }) => {
          captured.push(pageHtml!);
          throw new Error('stop after real HTML rendering');
        });
      await expect(
        service.zipPages(
          buildTree(pages()),
          format,
          new JSZip(),
          false,
          'en-US',
          false,
          false,
          undefined,
          { id: 'actor' } as any,
        ),
      ).rejects.toThrow('stop after real HTML rendering');
      const $ = cheerio.load(captured[0]);
      expect(
        $('a')
          .filter((_, element) => $(element).text() === 'APPROVED_CHILD')
          .attr('href'),
      ).toBe(source);
    },
  );
});
