import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseExportFormat } from '@/features/database/types/database.types';
import { exportDatabase } from './database-service';

const { postMock, saveAsMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  saveAsMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  default: {
    post: postMock,
  },
}));

vi.mock('file-saver', () => ({
  saveAs: saveAsMock,
}));

describe('database-service exportDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends include switches in payload for PDF export', async () => {
    const fileBlob = new Blob(['zip-content']);
    postMock.mockResolvedValue({
      data: fileBlob,
      headers: {
        'content-disposition': 'attachment; filename="database-export.zip"',
      },
    });

    await exportDatabase('db-1', {
      format: DatabaseExportFormat.PDF,
      includeChildren: true,
      includeAttachments: true,
    });

    expect(postMock).toHaveBeenCalledWith(
      '/databases/db-1/export',
      {
        format: DatabaseExportFormat.PDF,
        includeChildren: true,
        includeAttachments: true,
      },
      { responseType: 'blob' },
    );
    expect(saveAsMock).toHaveBeenCalledWith(fileBlob, 'database-export.zip');
  });

  it('sends markdown payload with include switches', async () => {
    const fileBlob = new Blob(['zip-content']);
    postMock.mockResolvedValue({
      data: fileBlob,
      headers: {
        'content-disposition': 'attachment; filename="database-export.zip"',
      },
    });

    await exportDatabase('db-1', {
      format: DatabaseExportFormat.Markdown,
      includeChildren: true,
      includeAttachments: false,
    });

    expect(postMock).toHaveBeenCalledWith(
      '/databases/db-1/export',
      {
        format: DatabaseExportFormat.Markdown,
        includeChildren: true,
        includeAttachments: false,
      },
      { responseType: 'blob' },
    );
    expect(saveAsMock).toHaveBeenCalledWith(fileBlob, 'database-export.zip');
  });

  it('supports html export payload', async () => {
    const fileBlob = new Blob(['zip-content']);
    postMock.mockResolvedValue({
      data: fileBlob,
      headers: {
        'content-disposition': 'attachment; filename="database-export.zip"',
      },
    });

    await exportDatabase('db-1', {
      format: DatabaseExportFormat.HTML,
      includeChildren: false,
      includeAttachments: true,
    });

    expect(postMock).toHaveBeenCalledWith(
      '/databases/db-1/export',
      {
        format: DatabaseExportFormat.HTML,
        includeChildren: false,
        includeAttachments: true,
      },
      { responseType: 'blob' },
    );
    expect(saveAsMock).toHaveBeenCalledWith(fileBlob, 'database-export.zip');
  });
});
