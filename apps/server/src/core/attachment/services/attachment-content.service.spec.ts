import {
  ATTACHMENT_CONTENT_INDEX_VERSION,
  AttachmentContentService,
} from './attachment-content.service';

describe('AttachmentContentService', () => {
  const createDb = (
    attachment: Record<string, unknown>,
    opts: { claim?: boolean } = {},
  ) => {
    const selectQuery: any = {
      select: jest.fn(() => selectQuery),
      where: jest.fn(() => selectQuery),
      executeTakeFirst: jest.fn().mockResolvedValue(attachment),
    };
    const updates: Array<Record<string, unknown>> = [];
    const updateQuery: any = {
      set: jest.fn((value: Record<string, unknown>) => {
        updates.push(value);
        return updateQuery;
      }),
      where: jest.fn(() => updateQuery),
      returning: jest.fn(() => updateQuery),
      execute: jest.fn().mockResolvedValue([]),
      executeTakeFirst: jest
        .fn()
        .mockResolvedValue(
          opts.claim === false ? undefined : { id: attachment.id },
        ),
    };

    return {
      db: {
        selectFrom: jest.fn(() => selectQuery),
        updateTable: jest.fn(() => updateQuery),
      },
      updates,
    };
  };

  const createService = (
    attachment: Record<string, unknown>,
    storage = { read: jest.fn() },
    opts: { claim?: boolean } = {},
  ) => {
    const { db, updates } = createDb(attachment, opts);
    const storageWithExists = {
      exists: jest.fn().mockResolvedValue(true),
      ...storage,
    };
    const service = new AttachmentContentService(
      storageWithExists as any,
      db as any,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
    );
    return { service, updates };
  };

  it('normalizes extracted text and enforces the character cap', () => {
    const { service } = createService({});
    const nul = String.fromCharCode(0);
    const input = `  first${nul}   line\r\n\r\n\r\nsecond ${'x'.repeat(
      1_000_100,
    )}`;

    const result = (service as any).normalizeText(input);

    expect(result).toHaveLength(1_000_000);
    expect(result.startsWith('first line\n\nsecond ')).toBe(true);
    expect(result).not.toContain(nul);
  });

  it('skips unsupported attachment formats without reading them', async () => {
    const storage = { read: jest.fn() };
    const { service, updates } = createService(
      {
        id: 'attachment-1',
        filePath: 'files/data.txt',
        fileName: 'data.txt',
        fileExt: '.txt',
        fileSize: 100,
        updatedAt: new Date(),
      },
      storage,
    );

    await service.indexAttachment('attachment-1');

    expect(storage.read).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({
        contentIndexStatus: 'skipped',
        contentIndexError: 'unsupported_type',
      }),
    );
  });

  it('marks oversized supported files as skipped without reading them', async () => {
    const storage = { read: jest.fn() };
    const { service, updates } = createService(
      {
        id: 'attachment-1',
        filePath: 'files/large.pdf',
        fileName: 'large.pdf',
        fileExt: '.pdf',
        fileSize: 50 * 1024 * 1024 + 1,
        contentIndexStatus: 'pending',
        updatedAt: new Date(),
      },
      storage,
    );

    await service.indexAttachment('attachment-1');

    expect(storage.read).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({
        contentIndexStatus: 'skipped',
        contentIndexError: 'file_too_large',
      }),
    );
  });

  it('never retries an attachment that already failed permanently', async () => {
    const storage = { read: jest.fn() };
    const { service, updates } = createService(
      {
        id: 'attachment-1',
        filePath: 'files/broken.pdf',
        fileName: 'broken.pdf',
        fileExt: '.pdf',
        fileSize: 100,
        contentIndexStatus: 'failed',
        updatedAt: new Date(),
      },
      storage,
    );

    await service.indexAttachment('attachment-1');

    expect(storage.read).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('re-runs a failed attachment when a retry is requested', async () => {
    const storage = {
      read: jest.fn().mockRejectedValue(new Error('bucket unreachable')),
    };
    const { service, updates } = createService(
      {
        id: 'attachment-1',
        filePath: 'files/broken.pdf',
        fileName: 'broken.pdf',
        fileExt: '.pdf',
        fileSize: 100,
        contentIndexStatus: 'failed',
        updatedAt: new Date(),
      },
      storage,
    );

    await expect(
      service.indexAttachment('attachment-1', { retryFailed: true }),
    ).rejects.toThrow('bucket unreachable');

    expect(storage.read).toHaveBeenCalled();
    // A storage outage must not become a terminal state.
    expect(updates).toContainEqual(
      expect.objectContaining({
        contentIndexStatus: 'pending',
        contentIndexError: 'storage_unavailable',
      }),
    );
  });

  it('releases the claim when storage disappears between exists and read', async () => {
    const storage = {
      exists: jest.fn().mockResolvedValue(true),
      read: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('file disappeared'), { code: 'ENOENT' }),
        ),
    };
    const { service, updates } = createService(
      {
        id: 'attachment-1',
        filePath: 'files/disappearing.pdf',
        fileName: 'disappearing.pdf',
        fileExt: '.pdf',
        fileSize: 100,
        contentIndexStatus: 'pending',
      },
      storage,
    );

    await expect(service.indexAttachment('attachment-1')).rejects.toThrow(
      'file disappeared',
    );

    expect(storage.exists).toHaveBeenCalledWith('files/disappearing.pdf');
    expect(storage.read).toHaveBeenCalledWith('files/disappearing.pdf');
    expect(updates).toContainEqual(
      expect.objectContaining({
        contentIndexStatus: 'pending',
        contentIndexError: 'storage_unavailable',
      }),
    );
  });

  it('does not re-extract content that is already at the current version', async () => {
    const storage = { read: jest.fn() };
    const { service, updates } = createService(
      {
        id: 'attachment-1',
        filePath: 'files/document.pdf',
        fileName: 'document.pdf',
        fileExt: '.pdf',
        fileSize: 100,
        contentIndexStatus: 'ready',
        contentIndexVersion: ATTACHMENT_CONTENT_INDEX_VERSION,
        updatedAt: new Date(),
      },
      storage,
    );

    await service.indexAttachment('attachment-1');

    expect(storage.read).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('aborts extraction work that outlives the deadline', async () => {
    const { service } = createService({});
    const neverSettles = new Promise(() => undefined);

    await expect(
      (service as any).withDeadline(neverSettles, Date.now() + 20),
    ).rejects.toThrow('Attachment text extraction timed out');
  });

  it('stores derived text without changing the attachment business timestamp', async () => {
    const set = jest.fn();
    const updateQuery: any = {
      set: jest.fn((value) => {
        set(value);
        return updateQuery;
      }),
      where: jest.fn(() => updateQuery),
      returning: jest.fn(() => updateQuery),
      executeTakeFirst: jest.fn().mockResolvedValue({ id: 'attachment-1' }),
    };
    const searchQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (trx: unknown) => unknown) =>
          callback({ updateTable: jest.fn(() => updateQuery) }),
      })),
    };
    const service = new AttachmentContentService(
      {} as any,
      db as any,
      {} as any,
      searchQueue as any,
    );

    await (service as any).saveExtractedText(
      {
        id: 'attachment-1',
        filePath: 'files/document.pdf',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      'indexed content',
      new Date('2026-01-01T00:00:01Z'),
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        textContent: 'indexed content',
        contentIndexStatus: 'ready',
        contentIndexVersion: ATTACHMENT_CONTENT_INDEX_VERSION,
      }),
    );
    expect(set.mock.calls[0][0]).not.toHaveProperty('updatedAt');
    expect(searchQueue.add).toHaveBeenCalledWith(
      'search-index-attachment',
      { attachmentIds: ['attachment-1'] },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('does not publish extracted text after the attachment is deleted', async () => {
    const updateQuery: any = {
      set: jest.fn(() => updateQuery),
      where: jest.fn(() => updateQuery),
      returning: jest.fn(() => updateQuery),
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
    };
    const searchQueue = { add: jest.fn() };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (trx: unknown) => unknown) =>
          callback({ updateTable: jest.fn(() => updateQuery) }),
      })),
    };
    const service = new AttachmentContentService(
      {} as any,
      db as any,
      {} as any,
      searchQueue as any,
    );

    await (service as any).saveExtractedText(
      {
        id: 'attachment-1',
        filePath: 'files/deleted.pdf',
      },
      'must not be published',
      new Date('2026-01-01T00:00:01Z'),
    );

    expect(searchQueue.add).not.toHaveBeenCalled();
    expect(updateQuery.where).toHaveBeenCalledWith('deletedAt', 'is', null);
    expect(updateQuery.where).toHaveBeenCalledWith(
      'contentIndexStatus',
      '=',
      'processing',
    );
  });
});
