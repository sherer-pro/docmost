import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyPageMarkdownWithComments, uploadFile } from './page-service';

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  default: {
    post: postMock,
  },
  unwrapApiResponse: (value: unknown) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      'data' in value &&
      'success' in value &&
      'status' in value
    ) {
      return (value as { data: unknown }).data;
    }

    return value;
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

describe('page-service uploadFile', () => {
  const attachment = {
    id: 'attachment-id',
    fileName: 'diagram.drawio.svg',
    filePath: 'workspace-id/files/attachment-id/diagram.drawio.svg',
    fileSize: 1135,
    fileExt: '.svg',
    mimeType: 'image/svg+xml',
    type: 'file',
    creatorId: 'user-id',
    pageId: 'page-id',
    spaceId: 'space-id',
    workspaceId: 'workspace-id',
    createdAt: '2026-06-18T12:53:32.992Z',
    updatedAt: '2026-06-18T12:53:32.992Z',
    deletedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw attachment responses from multipart upload endpoints', async () => {
    postMock.mockResolvedValue(attachment);

    const file = new File(['<svg></svg>'], 'diagram.drawio.svg', {
      type: 'image/svg+xml',
    });

    await expect(uploadFile(file, 'page-id')).resolves.toBe(attachment);

    expect(postMock).toHaveBeenCalledWith(
      '/attachments/actions/upload-file',
      expect.any(FormData),
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
    );
    const formData = postMock.mock.calls[0][1] as FormData;
    expect(formData.get('pageId')).toBe('page-id');
    expect(formData.get('file')).toBe(file);
  });

  it('still supports wrapped attachment responses', async () => {
    postMock.mockResolvedValue({
      data: attachment,
      success: true,
      status: 200,
    });

    const file = new File(['<svg></svg>'], 'diagram.drawio.svg', {
      type: 'image/svg+xml',
    });

    await expect(uploadFile(file, 'page-id', 'attachment-id')).resolves.toBe(
      attachment,
    );

    const formData = postMock.mock.calls[0][1] as FormData;
    expect(formData.get('attachmentId')).toBe('attachment-id');
  });
});
