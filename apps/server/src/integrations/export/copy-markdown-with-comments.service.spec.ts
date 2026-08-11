jest.mock('../../collaboration/collaboration.util', () => ({
  jsonToMarkdown: (content: any) => {
    if (content?.throwConversionError) {
      throw new Error('conversion failed');
    }

    if (typeof content?.text === 'string') {
      return content.text;
    }

    const inlineText = (node: any): string => {
      if (node?.type === 'text') return node.text ?? '';
      return (node?.content ?? []).map(inlineText).join('');
    };
    const renderBlock = (node: any): string => {
      if (node?.type === 'doc') {
        return (node.content ?? []).map(renderBlock).join('\n\n');
      }
      if (node?.type === 'heading') {
        return `${'#'.repeat(node.attrs?.level ?? 1)} ${inlineText(node)}`;
      }
      if (node?.type === 'bulletList') {
        return (node.content ?? [])
          .map((item: any) => `- ${inlineText(item)}`)
          .join('\n');
      }
      if (node?.type === 'table') {
        const rows = (node.content ?? []).map((row: any) =>
          (row.content ?? []).map(inlineText),
        );
        if (rows.length === 0) return '';
        return [
          `| ${rows[0].join(' | ')} |`,
          `| ${rows[0].map(() => '---').join(' | ')} |`,
          ...rows.slice(1).map((row: string[]) => `| ${row.join(' | ')} |`),
        ].join('\n');
      }
      return inlineText(node);
    };

    return renderBlock(content);
  },
}));

import { CopyMarkdownWithCommentsService } from './copy-markdown-with-comments.service';
import { ExportFormat } from './dto/export-dto';

describe('CopyMarkdownWithCommentsService', () => {
  const exportService = {
    exportPage: jest.fn(async () => '# Page title\n\nDocument body'),
  };
  const commentRepo = {
    findAllPageCommentsWithActors: jest.fn(),
  };
  const service = new CopyMarkdownWithCommentsService(
    exportService as any,
    commentRepo as any,
  );
  const page = {
    id: 'page-1',
    title: 'Page title',
    content: { type: 'doc', content: [] },
    workspaceId: 'workspace-1',
  };
  const user = { id: 'user-1', workspaceId: 'workspace-1' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    exportService.exportPage.mockResolvedValue('# Page title\n\nDocument body');
  });

  it('returns page markdown without comments section when page has no comments', async () => {
    commentRepo.findAllPageCommentsWithActors.mockResolvedValue([]);

    await expect(service.build(page as any, user, 'en-US')).resolves.toBe(
      '# Page title\n\nDocument body',
    );
    expect(exportService.exportPage).toHaveBeenCalledWith(
      ExportFormat.Markdown,
      page,
      true,
      'en-US',
      undefined,
      undefined,
      user,
    );
  });

  it('appends inline, page-level, resolved, and reply comments', async () => {
    commentRepo.findAllPageCommentsWithActors.mockResolvedValue([
      createComment({
        id: 'root-inline',
        type: 'inline',
        selection: 'Selected paragraph',
        content: { text: 'Inline root body' },
        creator: { name: 'Alice' },
      }),
      createComment({
        id: 'reply-inline',
        parentCommentId: 'root-inline',
        content: { text: 'Reply body' },
        creator: { name: 'Bob' },
      }),
      createComment({
        id: 'root-page',
        type: 'page',
        resolvedAt: new Date('2026-02-02T02:02:02.000Z'),
        resolvedBy: { name: 'Eve' },
        content: { text: 'Page-level body' },
        creator: { name: 'Carol' },
      }),
    ]);

    const markdown = await service.build(page as any, user);

    expect(markdown).toContain('# Page title');
    expect(markdown).toContain('## Comments');
    expect(markdown).toContain('### Thread 1: Inline (Open)');
    expect(markdown).toContain('- Type: Inline');
    expect(markdown).toContain('- Location: Inline anchor not found');
    expect(markdown).toContain('- Author: Alice');
    expect(markdown).toContain('Selection:\n\n> Selected paragraph');
    expect(markdown).toContain('Inline root body');
    expect(markdown).toContain('#### Reply 1.1');
    expect(markdown).toContain('Reply body');
    expect(markdown).toContain('### Thread 2: Page (Resolved)');
    expect(markdown).toContain('- Location: Page-level');
    expect(markdown).toContain('- Resolved by: Eve');
    expect(markdown).toContain('Page-level body');
  });

  it('adds section, markdown line, and surrounding context for inline roots', async () => {
    exportService.exportPage.mockResolvedValue(
      [
        '# Page title',
        '',
        '## Alpha',
        '',
        'Repeated target in alpha.',
        '',
        '## Beta',
        '',
        '### Nested',
        '',
        'Repeated target in beta.',
      ].join('\n'),
    );
    commentRepo.findAllPageCommentsWithActors.mockResolvedValue([
      createComment({
        id: 'alpha-comment',
        selection: 'target',
        content: { text: 'Alpha body' },
      }),
      createComment({
        id: 'beta-comment',
        selection: 'target',
        content: { text: 'Beta body' },
      }),
      createComment({
        id: 'beta-reply',
        parentCommentId: 'beta-comment',
        content: { text: 'Beta reply' },
      }),
    ]);

    const markdown = await service.build(
      {
        ...page,
        content: {
          type: 'doc',
          content: [
            headingNode(2, 'Alpha'),
            paragraphNode([
              textNode('Repeated '),
              textNode('target', 'alpha-comment'),
              textNode(' in alpha.'),
            ]),
            headingNode(2, 'Beta'),
            headingNode(3, 'Nested'),
            paragraphNode([
              textNode('Repeated '),
              textNode('target', 'beta-comment'),
              textNode(' in beta.'),
            ]),
          ],
        },
      } as any,
      user,
    );

    expect(markdown).toContain('### Thread 1: Inline (Open)');
    expect(markdown).toContain('- Section: Alpha');
    expect(markdown).toContain('- Markdown line: 5');
    expect(markdown).toContain('- Context: Repeated target in alpha.');
    expect(markdown).toContain('### Thread 2: Inline (Open)');
    expect(markdown).toContain('- Section: Beta > Nested');
    expect(markdown).toContain('- Markdown line: 11');
    expect(markdown).toContain('- Context: Repeated target in beta.');
    expect(markdown).toContain('#### Reply 2.1');
    expect(markdown).not.toContain(
      '#### Reply 2.1\n\n- Type: Inline\n- Status: Open\n- Section:',
    );
  });

  it('uses the rendered Markdown line for comments inside lists', async () => {
    exportService.exportPage.mockResolvedValue(
      [
        '# Page title',
        '',
        '## G17 section',
        '',
        '- First item',
        '- Second item Unicode Привет 東京',
        '',
        '| Header A | Header B |',
        '| --- | --- |',
        '| Cell A | Cell B |',
        '',
        'After table',
      ].join('\n'),
    );
    commentRepo.findAllPageCommentsWithActors.mockResolvedValue([
      createComment({
        id: 'list-comment',
        selection: 'Second item Unicode Привет 東京',
        content: { text: 'List body' },
      }),
    ]);

    const renderedPage = {
      ...page,
      content: {
        type: 'doc',
        content: [
          headingNode(2, 'G17 section'),
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [paragraphNode([textNode('First item')])],
              },
              {
                type: 'listItem',
                content: [
                  paragraphNode([
                    textNode('Second item Unicode Привет 東京', 'list-comment'),
                  ]),
                ],
              },
            ],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  tableCellNode('tableHeader', 'Header A'),
                  tableCellNode('tableHeader', 'Header B'),
                ],
              },
              {
                type: 'tableRow',
                content: [
                  tableCellNode('tableCell', 'Cell A'),
                  tableCellNode('tableCell', 'Cell B'),
                ],
              },
            ],
          },
          paragraphNode([textNode('After table')]),
        ],
      },
    } as any;
    const markdown = await service.build(renderedPage, user);

    expect(markdown).toContain('- Markdown line: 6');
  });

  it('keeps malformed page and comment content from breaking markdown generation', async () => {
    commentRepo.findAllPageCommentsWithActors.mockResolvedValue([
      createComment({
        id: 'broken-comment',
        content: { throwConversionError: true },
      }),
    ]);

    const markdown = await service.build(
      { ...page, content: 'broken' } as any,
      user,
    );

    expect(markdown).toContain('### Thread 1: Inline (Open)');
    expect(markdown).toContain('- Location: Inline anchor not found');
    expect(markdown).toContain('_No content_');
  });
});

function createComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comment-1',
    pageId: 'page-1',
    parentCommentId: null,
    type: 'inline',
    selection: null,
    content: { text: 'Comment body' },
    creatorId: 'user-1',
    creator: { id: 'user-1', name: 'User One', avatarUrl: null },
    resolvedBy: null,
    resolvedAt: null,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    editedAt: null,
    lastEditedById: null,
    resolvedById: null,
    ...overrides,
  };
}

function headingNode(level: number, text: string) {
  return {
    type: 'heading',
    attrs: { level },
    content: [textNode(text)],
  };
}

function paragraphNode(content: unknown[]) {
  return {
    type: 'paragraph',
    content,
  };
}

function textNode(text: string, commentId?: string) {
  return {
    type: 'text',
    text,
    ...(commentId
      ? {
          marks: [
            {
              type: 'comment',
              attrs: { commentId },
            },
          ],
        }
      : {}),
  };
}

function tableCellNode(type: 'tableHeader' | 'tableCell', text: string) {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [paragraphNode([textNode(text)])],
  };
}
