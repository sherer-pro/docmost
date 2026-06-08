import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyPageMarkdownWithComments } from './page-service';

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  default: {
    post: postMock,
  },
}));

describe('page-service copyPageMarkdownWithComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests markdown with comments for a page', async () => {
    postMock.mockResolvedValue({
      data: {
        markdown: '# Page\n\nBody\n\n---\n\n## Comments',
      },
    });

    await expect(copyPageMarkdownWithComments('page-1')).resolves.toBe(
      '# Page\n\nBody\n\n---\n\n## Comments',
    );
    expect(postMock).toHaveBeenCalledWith(
      '/pages/actions/copy-markdown-with-comments',
      { pageId: 'page-1' },
    );
  });
});
