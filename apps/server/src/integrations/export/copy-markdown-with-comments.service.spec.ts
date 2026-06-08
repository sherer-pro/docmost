jest.mock('../../collaboration/collaboration.util', () => ({
  jsonToMarkdown: (content: any) => {
    if (content?.throwConversionError) {
      throw new Error('conversion failed');
    }

    if (typeof content?.text === 'string') {
      return content.text;
    }

    return '';
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

  beforeEach(() => {
    jest.clearAllMocks();
    exportService.exportPage.mockResolvedValue('# Page title\n\nDocument body');
  });

  it('returns page markdown without comments section when page has no comments', async () => {
    commentRepo.findAllPageCommentsWithActors.mockResolvedValue([]);

    await expect(service.build(page as any, 'en-US')).resolves.toBe(
      '# Page title\n\nDocument body',
    );
    expect(exportService.exportPage).toHaveBeenCalledWith(
      ExportFormat.Markdown,
      page,
      true,
      'en-US',
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

    const markdown = await service.build(page as any);

    expect(markdown).toContain('# Page title');
    expect(markdown).toContain('## Comments');
    expect(markdown).toContain('### Thread 1: Inline (Open)');
    expect(markdown).toContain('- Type: Inline');
    expect(markdown).toContain('- Author: Alice');
    expect(markdown).toContain('Selection:\n\n> Selected paragraph');
    expect(markdown).toContain('Inline root body');
    expect(markdown).toContain('#### Reply 1.1');
    expect(markdown).toContain('Reply body');
    expect(markdown).toContain('### Thread 2: Page (Resolved)');
    expect(markdown).toContain('- Resolved by: Eve');
    expect(markdown).toContain('Page-level body');
  });

  it('keeps malformed comment content from breaking markdown generation', async () => {
    commentRepo.findAllPageCommentsWithActors.mockResolvedValue([
      createComment({
        id: 'broken-comment',
        content: { throwConversionError: true },
      }),
    ]);

    const markdown = await service.build(page as any);

    expect(markdown).toContain('### Thread 1: Inline (Open)');
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
