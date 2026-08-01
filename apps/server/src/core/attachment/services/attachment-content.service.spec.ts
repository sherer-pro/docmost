import { AttachmentContentService } from './attachment-content.service';

describe('AttachmentContentService', () => {
  const createDb = (attachment: Record<string, unknown>) => {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(attachment),
    };
    return {
      selectFrom: jest.fn(() => query),
    };
  };

  const createService = (
    attachment: Record<string, unknown>,
    storage = { read: jest.fn() },
  ) =>
    new AttachmentContentService(
      storage as any,
      createDb(attachment) as any,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
    );

  it('normalizes extracted text and enforces the character cap', () => {
    const service = createService({});
    const input = `  first\u0000   line\r\n\r\n\r\nsecond ${'x'.repeat(
      1_000_100,
    )}`;

    const result = (service as any).normalizeText(input);

    expect(result).toHaveLength(1_000_000);
    expect(result.startsWith('first line\n\nsecond ')).toBe(true);
    expect(result).not.toContain('\u0000');
  });

  it('does not read unsupported attachment formats', async () => {
    const storage = { read: jest.fn() };
    const service = createService(
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
  });

  it('marks oversized supported files as processed without reading them', async () => {
    const storage = { read: jest.fn() };
    const service = createService(
      {
        id: 'attachment-1',
        filePath: 'files/large.pdf',
        fileName: 'large.pdf',
        fileExt: '.pdf',
        fileSize: 50 * 1024 * 1024 + 1,
        updatedAt: new Date(),
      },
      storage,
    );
    const saveExtractedText = jest
      .spyOn(service as any, 'saveExtractedText')
      .mockResolvedValue(undefined);

    await service.indexAttachment('attachment-1');

    expect(storage.read).not.toHaveBeenCalled();
    expect(saveExtractedText).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'attachment-1' }),
      '',
    );
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
    );

    expect(set).toHaveBeenCalledWith({ textContent: 'indexed content' });
    expect(searchQueue.add).toHaveBeenCalledWith(
      'search-index-attachment',
      { attachmentIds: ['attachment-1'] },
      expect.objectContaining({ attempts: 3 }),
    );
  });
});
