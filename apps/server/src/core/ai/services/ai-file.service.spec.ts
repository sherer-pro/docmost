import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import * as JSZip from 'jszip';
import { AiFileService } from './ai-file.service';

jest.mock('./ai-conversation.service', () => ({
  AiConversationService: class {},
}));

jest.mock('kysely', () => {
  const actual = jest.requireActual('kysely');
  const sql = Object.assign(
    jest.fn(() => ({
      execute: jest.fn(async () => ({ rows: [] })),
    })),
    actual.sql,
  );
  return { ...actual, sql };
});

describe('AiFileService upload recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resumes an idempotent upload left processing after the reservation commit', async () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    const content = Buffer.from('recovery payload');
    const batch = {
      id: '019f0000-0000-7000-8000-000000000001',
      conversationId: '019f0000-0000-7000-8000-000000000002',
      userId: '019f0000-0000-7000-8000-000000000003',
      workspaceId: '019f0000-0000-7000-8000-000000000004',
      idempotencyKey: 'upload-recovery',
      requestFingerprint: createHash('sha256')
        .update(
          JSON.stringify([
            {
              name: 'recovery.txt',
              mimeType: 'text/plain',
              size: content.length,
              sha256: createHash('sha256').update(content).digest('hex'),
            },
          ]),
        )
        .digest('hex'),
      status: 'processing',
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    const file = {
      id: '019f0000-0000-7000-8000-000000000005',
      conversationId: batch.conversationId,
      userId: batch.userId,
      workspaceId: batch.workspaceId,
      spaceId: '019f0000-0000-7000-8000-000000000006',
      uploadBatchId: batch.id,
      uploadOrdinal: 0,
      contentSha256: createHash('sha256').update(content).digest('hex'),
      name: 'recovery.txt',
      mimeType: 'text/plain',
      size: content.length,
      storageKey: `${batch.workspaceId}/ai-chat/${batch.conversationId}/file/recovery.txt`,
      status: 'pending',
      extractedText: null,
      error: null,
      uploadedAt: null,
      storageDeletedAt: null,
      extractionStartedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const batchSelect = createBuilder({ takeFirst: batch });
    const fileSelect = createBuilder({ rows: [file] });
    const update = createBuilder({ rows: [] });
    const transaction = {
      selectFrom: jest.fn((table: string) =>
        table === 'aiFileUploadBatches' ? batchSelect : fileSelect,
      ),
      updateTable: jest.fn(() => update),
    };
    const connection = {
      transaction: jest.fn(() => ({
        execute: (callback: (trx: any) => unknown) => callback(transaction),
      })),
    };
    const db = {
      transaction: connection.transaction,
      connection: jest.fn(() => ({
        execute: (callback: (db: any) => unknown) => callback(connection),
      })),
    };
    const storage = {
      upload: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    };
    const queue = { add: jest.fn(async () => undefined) };
    const metrics = { observeFileLifecycle: jest.fn() };
    const service = new AiFileService(
      db as any,
      queue as any,
      storage as any,
      {
        getOwnedEntity: jest.fn(async () => ({
          id: batch.conversationId,
          spaceId: file.spaceId,
        })),
      } as any,
      {} as any,
      metrics as any,
    );

    const result = await service.upload(
      batch.conversationId,
      multipart(content),
      batch.idempotencyKey,
      { id: batch.userId } as any,
      { id: batch.workspaceId } as any,
    );

    expect(storage.upload).toHaveBeenCalledWith(file.storageKey, content);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(sql).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('completed');
    expect(result.files).toHaveLength(1);
  });

  it('extracts text from a valid bounded DOCX archive', async () => {
    const archive = new JSZip();
    archive.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    archive.file(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    archive.file(
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX audit text</w:t></w:r></w:p></w:body></w:document>',
    );
    const buffer = await archive.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    const service = Object.create(AiFileService.prototype) as AiFileService;

    const text = await (service as any).extractDocxText(
      buffer,
      Date.now() + 10_000,
    );

    expect(text).toContain('DOCX audit text');
  });
});

function createBuilder(params: { rows?: any[]; takeFirst?: any }) {
  const builder: any = {
    selectAll: jest.fn(() => builder),
    where: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    set: jest.fn(() => builder),
    returning: jest.fn(() => builder),
    returningAll: jest.fn(() => builder),
    execute: jest.fn(async () => params.rows ?? []),
    executeTakeFirst: jest.fn(async () => params.takeFirst),
    executeTakeFirstOrThrow: jest.fn(async () => params.takeFirst),
  };
  return builder;
}

async function* multipart(content: Buffer): AsyncIterableIterator<any> {
  yield {
    type: 'file',
    filename: 'recovery.txt',
    mimetype: 'text/plain',
    toBuffer: async () => content,
  };
}
