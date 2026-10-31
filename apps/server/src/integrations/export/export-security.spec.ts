jest.mock('../../collaboration/collaboration.util', () => {
  const { Schema } = jest.requireActual('@tiptap/pm/model');
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      text: { group: 'inline' },
      heading: {
        group: 'block',
        content: 'inline*',
        attrs: { level: { default: 1 } },
      },
      mention: {
        inline: true,
        group: 'inline',
        atom: true,
        attrs: {
          entityType: { default: 'page' },
          entityId: { default: null },
          label: { default: '' },
          slugId: { default: null },
        },
      },
    },
    marks: { link: { attrs: { href: {}, target: { default: null } } } },
  });
  return {
    jsonToNode: (input) => schema.nodeFromJSON(input),
    jsonToHtml: (input) =>
      `<p>${schema.nodeFromJSON(input).textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
  };
});

import * as JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { ExportService } from './export.service';
import {
  buildTree,
  createExportPathPlan,
  assertSafeExportPath,
  replaceInternalLinks,
} from './utils';
import { ExportFormat } from './dto/export-dto';

describe('DOCX export source revalidation', () => {
  const root = {
    id: 'root',
    workspaceId: 'workspace',
    spaceId: 'space',
  } as any;
  const actor = { id: 'actor', workspaceId: 'workspace' } as any;
  const create = () => {
    const sourceIds = [
      'root',
      'synced-source',
      'database-source',
      'row-source',
    ];
    const currentPages = sourceIds.map((id) => ({ ...root, id }));
    const query: any = { execute: jest.fn(async () => currentPages) };
    query.select = jest.fn(() => query);
    query.where = jest.fn(() => query);
    const acl = {
      getEffectiveAccessForPages: jest.fn(
        async (_pages: any[], _actor: any) =>
          new Map(
            currentPages.map((page) => [
              page.id,
              { capabilities: { canRead: true } },
            ]),
          ),
      ),
    };
    const service = new ExportService(
      {} as any,
      { selectFrom: () => query } as any,
      {} as any,
      { getAppUrl: () => 'https://docmost.example.test' } as any,
      {} as any,
      {} as any,
      acl as any,
      {} as any,
    );
    const html = jest
      .spyOn(service as any, 'buildPageExportHtml')
      .mockResolvedValue({
        title: 'Document',
        pageHtml: '<h1>Document</h1><p>Permitted snapshot</p>',
        attachmentPageIds: sourceIds,
        attachmentIds: [],
      });
    jest.spyOn(service, 'buildPagePdfBody').mockResolvedValue({
      title: 'Document',
      bodyHtml: '<h1>Document</h1><p>Permitted snapshot</p>',
      attachmentTokens: {},
    });
    return { service, query, acl, html };
  };
  it('rechecks the container and materialized source before returning the DOCX bytes', async () => {
    const { service, acl } = create();
    const result = await service.exportPage(
      ExportFormat.DOCX,
      root,
      true,
      undefined,
      undefined,
      undefined,
      actor,
    );
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(
      acl.getEffectiveAccessForPages.mock.calls[0][0].map((page) => page.id),
    ).toEqual(['root', 'synced-source', 'database-source', 'row-source']);
  });
  it('returns no document after a source permission is revoked or the source is deleted', async () => {
    const revoked = create();
    revoked.acl.getEffectiveAccessForPages.mockResolvedValueOnce(new Map());
    await expect(
      revoked.service.exportPage(
        ExportFormat.DOCX,
        root,
        true,
        undefined,
        undefined,
        undefined,
        actor,
      ),
    ).rejects.toThrow('access changed');
    const deleted = create();
    deleted.query.execute.mockResolvedValueOnce([root]);
    await expect(
      deleted.service.exportPage(
        ExportFormat.DOCX,
        root,
        true,
        undefined,
        undefined,
        undefined,
        actor,
      ),
    ).rejects.toThrow('unavailable');
  });
  it('requires the authenticated actor before preparing any source', async () => {
    const { service, html } = create();
    await expect(service.exportPage(ExportFormat.DOCX, root)).rejects.toThrow(
      'Authorized user',
    );
    expect(html).not.toHaveBeenCalled();
  });
});

describe('Export security boundaries', () => {
  const user = { id: 'reader', workspaceId: 'workspace' } as any;
  const target = {
    id: 'target',
    title: 'PRIVATE_NEW_TITLE',
    slugId: 'newslug',
    spaceId: 'private-space',
    workspaceId: 'workspace',
    space: { slug: 'privatespace' },
  };
  const doc = (content: any[]) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content }],
  });
  const mention = {
    type: 'mention',
    attrs: {
      entityType: 'page',
      entityId: 'target',
      label: 'Stored label',
      slugId: 'oldslug',
    },
  };
  const query: any = {};
  const db = { selectFrom: jest.fn(() => query) };
  const acl = { getEffectiveAccessForPages: jest.fn() };
  let service: ExportService;
  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of ['select', 'where'])
      query[method] = jest.fn(() => query);
    query.execute = jest.fn(async () => [target]);
    acl.getEffectiveAccessForPages.mockResolvedValue(new Map());
    service = new ExportService(
      { withSpace: () => null } as any,
      db as any,
      {} as any,
      { getAppUrl: () => 'https://audit.invalid' } as any,
      {} as any,
      {} as any,
      acl as any,
      {} as any,
    );
  });
  it('keeps only stored text when current read access has been revoked', async () => {
    const output = await service.turnPageMentionsToLinks(
      doc([mention]),
      'workspace',
      user,
    );
    expect(JSON.stringify(output)).not.toMatch(
      /PRIVATE_NEW_TITLE|newslug|privatespace|href/,
    );
    expect(output.content[0].content).toEqual([
      { type: 'text', text: 'Stored label' },
    ]);
    expect(acl.getEffectiveAccessForPages).toHaveBeenCalledWith([target], user);
    expect(query.where).toHaveBeenCalledWith('deletedAt', 'is', null);
    expect(query.where).toHaveBeenCalledWith('workspaceId', '=', 'workspace');
  });
  it('does not query metadata without a matching authenticated workspace', async () => {
    for (const caller of [undefined, { ...user, workspaceId: 'another' }]) {
      await service.turnPageMentionsToLinks(
        doc([mention]),
        'workspace',
        caller,
      );
    }
    expect(db.selectFrom).not.toHaveBeenCalled();
  });
  it('preserves allowed links and offsets across multiple mentions', async () => {
    acl.getEffectiveAccessForPages.mockResolvedValue(
      new Map([['target', { capabilities: { canRead: true } }]]),
    );
    const output = await service.turnPageMentionsToLinks(
      doc([mention, { type: 'text', text: ' / ' }, mention]),
      'workspace',
      user,
    );
    expect(
      output.content[0].content
        .filter((node) => node.marks)
        .map((node) => node.text),
    ).toEqual([target.title, target.title]);
    expect(JSON.stringify(output)).toContain('/s/privatespace/p/');
  });
  it('does not restore live metadata for missing or deleted targets', async () => {
    query.execute.mockResolvedValue([]);
    const output = await service.turnPageMentionsToLinks(
      doc([mention]),
      'workspace',
      user,
    );
    expect(output.content[0].content).toEqual([
      { type: 'text', text: 'Stored label' },
    ]);
  });
  it('escapes the HTML document title', async () => {
    const title = '</title><script>globalThis.auditCanary=true</script><title>';
    const html = await service.exportPage(
      'html',
      {
        id: 'page',
        title,
        workspaceId: 'workspace',
        content: doc([{ type: 'text', text: 'Safe body' }]),
      } as any,
      false,
      'en-US',
      false,
      false,
      user,
      new Set(['page']),
    );
    const parsed = cheerio.load(html as string);
    expect(parsed('script')).toHaveLength(0);
    expect(parsed('title').text()).toBe(title);
  });
  it('shares safe paths across ZIP members, metadata and encoded relative links', async () => {
    const titles = [
      'Normal title',
      '../outside',
      'A/B',
      'A\\B',
      'CON.txt',
      'NUL',
      '.',
      '..',
      'Trailing. ',
      'normal TITLE',
      'files',
      'a%20b',
      'Unicode \u65e5\u672c',
      'C:\\escape',
      '__proto__',
    ];
    const pages = titles.map(
      (title, i) =>
        ({
          id: `page-${i}`,
          title,
          slugId: `slug${i}`,
          parentPageId: null,
          workspaceId: 'workspace',
          content: doc([{ type: 'text', text: 'Body' }]),
        }) as any,
    );
    const tree = buildTree(pages);
    const plan = createExportPathPlan(tree, 'html');
    expect(plan.get('page-0')!.zipPath).toBe('Normal title.html');
    expect(
      new Set([...plan.values()].map((p) => p.zipPath.toLowerCase())).size,
    ).toBe(titles.length);
    for (const { zipPath } of plan.values())
      expect(() => assertSafeExportPath(zipPath)).not.toThrow();
    expect(pages.map((p) => p.title)).toEqual(titles);
    const zip = new JSZip();
    await service.zipPages(
      tree,
      'html',
      zip,
      false,
      'en-US',
      false,
      false,
      undefined,
      user,
    );
    const metadata = JSON.parse(
      await zip.file('docmost-metadata.json')!.async('string'),
    );
    for (const path of Object.keys(metadata.pages))
      expect(zip.file(decodeURIComponent(path))).not.toBeNull();
    expect(metadata.pages['a%2520b.html']).toBeDefined();
    const linked = replaceInternalLinks(
      doc([
        {
          type: 'text',
          text: 'link',
          marks: [
            {
              type: 'link',
              attrs: { href: 'https://audit.invalid/s/space/p/title-slug11' },
            },
          ],
        },
      ]),
      { slug11: plan.get('page-11')!.zipPath },
      plan.get('page-0')!.zipPath,
    );
    expect(linked.content[0].content[0].marks[0].attrs.href).toBe(
      'a%2520b.html',
    );
  });
  it.each(['../x', '/x', 'C:/x', 'a\\b', 'a/../b', 'a/NUL.txt', 'a/last.'])(
    'rejects unsafe final archive entry %s',
    (name) => {
      expect(() => assertSafeExportPath(name)).toThrow(
        'Unsafe export archive path',
      );
    },
  );
});
