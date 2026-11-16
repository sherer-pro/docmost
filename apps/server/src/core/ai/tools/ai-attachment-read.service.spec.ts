import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AiAttachmentReadService } from './ai-attachment-read.service';
import { StorageObjectChangedError } from '../../../integrations/storage/interfaces/storage-driver.interface';

const context = {
  user: { id: 'reader' },
  workspaceId: 'workspace',
  spaceId: 'space',
  source: 'mcp',
} as any;

function fixture(extension = '.txt') {
  const source = Buffer.from('Synthetic original '.repeat(3000));
  const attachment = {
    id: 'attachment',
    pageId: 'page',
    workspaceId: 'workspace',
    spaceId: 'space',
    fileName: `original${extension}`,
    fileExt: extension,
    mimeType: 'application/octet-stream',
    fileSize: String(source.length),
    filePath: 'PRIVATE_STORAGE_PATH',
    updatedAt: new Date(0),
    contentIndexStatus: 'ready',
    contentIndexVersion: 1,
    contentIndexedAt: new Date(0),
    textContent: '\u0416\ud83d\ude42'.repeat(16000),
  };
  const db = {
    selectFrom: jest.fn(() => {
      const query: any = {
        selectAll: () => query,
        where: () => query,
        executeTakeFirst: async () => ({ ...attachment }),
      };
      return query;
    }),
  };
  const storage = {
    readVersionedRange: jest.fn(
      async (_path: string, offset: number, limit: number) => ({
        data: source.subarray(offset, offset + limit),
        size: source.length,
        version: 'storage-v1',
      }),
    ),
  };
  const pages = {
    findById: jest.fn(async () => ({
      id: 'page',
      workspaceId: 'workspace',
      spaceId: 'space',
    })),
  };
  const access = { assertCanReadPage: jest.fn(async () => undefined) };
  const policy = { isPageExcluded: jest.fn(async () => false) };
  const service = new AiAttachmentReadService(
    db as any,
    storage as any,
    pages as any,
    access as any,
    policy as any,
  );
  return { service, source, attachment, storage, pages, access, policy };
}

describe('scoped MCP attachment reads', () => {
  it('reads a stable legacy file with stale declared size without changing metadata', async () => {
    const { service, source, attachment } = fixture('.svg');
    attachment.fileSize = '3506';
    const chunks: Buffer[] = [];
    let cursor: string | undefined;
    do {
      const content = (await service.file('attachment', cursor, context))
        .content as any;
      expect(content).toMatchObject({
        fileSize: String(source.length),
        declaredFileSize: '3506',
        metadataSizeMismatch: true,
        totalBytes: source.length,
      });
      chunks.push(Buffer.from(content.data, 'base64'));
      cursor = content.nextCursor ?? undefined;
    } while (cursor);
    expect(Buffer.concat(chunks)).toEqual(source);
    expect(attachment.fileSize).toBe('3506');
  });

  it('invalidates a legacy-file cursor if declared metadata changes between chunks', async () => {
    const { service, source, attachment } = fixture('.svg');
    attachment.fileSize = '3506';
    const first = (await service.file('attachment', undefined, context))
      .content as any;
    attachment.fileSize = String(source.length);
    await expect(
      service.file('attachment', first.nextCursor, context),
    ).rejects.toThrow(ConflictException);
  });

  it('reassembles exact original bytes without exposing a storage path', async () => {
    const { service, source, storage } = fixture('.xlsx');
    const chunks: Buffer[] = [];
    let cursor: string | undefined;
    do {
      const content = (await service.file('attachment', cursor, context))
        .content as any;
      expect(Buffer.byteLength(JSON.stringify(content))).toBeLessThanOrEqual(
        32768,
      );
      expect(JSON.stringify(content)).not.toContain('PRIVATE_STORAGE_PATH');
      expect(content).toMatchObject({
        fileSize: String(source.length),
        declaredFileSize: String(source.length),
        metadataSizeMismatch: false,
      });
      const bytes = Buffer.from(content.data, 'base64');
      expect(bytes.length).toBeLessThanOrEqual(16384);
      chunks.push(bytes);
      cursor = content.nextCursor ?? undefined;
    } while (cursor);
    expect(Buffer.concat(chunks)).toEqual(source);
    expect(
      storage.readVersionedRange.mock.calls.every((args) => args[2] <= 16384),
    ).toBe(true);
  });

  it('reassembles extracted text and explicitly reports unsupported formats', async () => {
    const { service, attachment, storage } = fixture();
    let cursor: string | undefined;
    let text = '';
    do {
      const content = (await service.text('attachment', cursor, context))
        .content as any;
      text += content.text;
      cursor = content.nextCursor ?? undefined;
    } while (cursor);
    expect(text).toBe(attachment.textContent);
    expect(storage.readVersionedRange).not.toHaveBeenCalled();
    const unsupported = fixture('.svg');
    expect(
      (await unsupported.service.text('attachment', undefined, context))
        .content,
    ).toMatchObject({ status: 'unsupported', text: '', nextCursor: null });
  });

  it.each(['pending', 'processing', 'failed', 'skipped'])(
    'reports %s without launching extraction',
    async (status) => {
      const { service, attachment, storage } = fixture();
      attachment.contentIndexStatus = status;
      expect(
        (await service.text('attachment', undefined, context)).content,
      ).toMatchObject({ status, text: '' });
      expect(storage.readVersionedRange).not.toHaveBeenCalled();
    },
  );

  it('discards bytes if page access is revoked during the read', async () => {
    const { service, access } = fixture();
    access.assertCanReadPage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.file('attachment', undefined, context),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an excluded or moved owner page', async () => {
    const excluded = fixture();
    excluded.policy.isPageExcluded.mockResolvedValue(true);
    await expect(
      excluded.service.file('attachment', undefined, context),
    ).rejects.toThrow(ForbiddenException);
    const moved = fixture();
    moved.pages.findById.mockResolvedValue({
      id: 'page',
      workspaceId: 'workspace',
      spaceId: 'other-space',
    });
    await expect(
      moved.service.file('attachment', undefined, context),
    ).rejects.toThrow(NotFoundException);
  });

  it('invalidates a cursor after an attachment metadata change', async () => {
    const { service, attachment } = fixture();
    const first = (await service.file('attachment', undefined, context))
      .content as any;
    attachment.updatedAt = new Date(1000);
    await expect(
      service.file('attachment', first.nextCursor, context),
    ).rejects.toThrow(ConflictException);
  });

  it('maps storage identity changes to a safe conflict', async () => {
    const { service, storage } = fixture();
    storage.readVersionedRange.mockRejectedValue(
      new StorageObjectChangedError(),
    );
    await expect(
      service.file('attachment', undefined, context),
    ).rejects.toThrow(ConflictException);
  });
});
