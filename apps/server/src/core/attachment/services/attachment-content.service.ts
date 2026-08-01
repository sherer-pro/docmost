import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { StorageService } from '../../../integrations/storage/storage.service';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import {
  createZipReadBudget,
  readZipEntryWithBudget,
} from '../../../integrations/import/utils/file.utils';
import { sql } from 'kysely';
import * as yauzl from 'yauzl';
import { executeTx } from '@docmost/db/utils';

const SUPPORTED_ATTACHMENT_EXTENSIONS = ['.pdf', '.docx'] as const;
const MAX_ATTACHMENT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 1_000_000;
const MAX_PDF_PAGES = 500;
const MAX_DOCX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 10_000;
const BACKFILL_CONCURRENCY = 2;
const BACKFILL_BATCH_SIZE = 100;

@Injectable()
export class AttachmentContentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AttachmentContentService.name);

  constructor(
    private readonly storageService: StorageService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE)
    private readonly attachmentQueue: Queue,
    @InjectQueue(QueueName.SEARCH_QUEUE)
    private readonly searchQueue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const workspaces = await this.db
        .selectFrom('attachments')
        .select('workspaceId')
        .distinct()
        .where('deletedAt', 'is', null)
        .where('textContent', 'is', null)
        .where(sql`LOWER(file_ext)`, 'in', [
          ...SUPPORTED_ATTACHMENT_EXTENSIONS,
        ])
        .execute();

      await Promise.all(
        workspaces.map(({ workspaceId }) =>
          this.attachmentQueue.add(
            QueueJob.ATTACHMENT_INDEXING,
            { workspaceId },
            {
              jobId: `attachment-content-backfill-${workspaceId}`,
              delay: 30_000,
              attempts: 3,
              backoff: { type: 'exponential', delay: 20_000 },
              removeOnComplete: true,
              removeOnFail: true,
            },
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to schedule attachment content backfill: ${this.errorMessage(error)}`,
      );
    }
  }

  async indexAttachment(attachmentId: string): Promise<void> {
    const attachment = await this.db
      .selectFrom('attachments')
      .select([
        'id',
        'filePath',
        'fileName',
        'fileExt',
        'fileSize',
        'updatedAt',
      ])
      .where('id', '=', attachmentId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!attachment) {
      return;
    }

    const extension = attachment.fileExt?.toLowerCase();
    if (!this.isSupportedExtension(extension)) {
      return;
    }

    const fileSize = Number(attachment.fileSize ?? 0);
    if (fileSize > MAX_ATTACHMENT_FILE_BYTES) {
      this.logger.warn(
        `Attachment ${attachment.id} exceeds the content indexing size limit`,
      );
      await this.saveExtractedText(attachment, '');
      return;
    }

    const buffer = await this.storageService.read(attachment.filePath);
    if (buffer.byteLength > MAX_ATTACHMENT_FILE_BYTES) {
      this.logger.warn(
        `Attachment ${attachment.id} exceeds the content indexing size limit`,
      );
      await this.saveExtractedText(attachment, '');
      return;
    }

    const extracted =
      extension === '.pdf'
        ? await this.extractPdfText(buffer)
        : await this.extractDocxText(buffer);
    const text = this.normalizeText(extracted);

    await this.saveExtractedText(attachment, text);
  }

  async indexWorkspace(workspaceId: string): Promise<void> {
    let cursor: string | null = null;
    let failureCount = 0;

    while (true) {
      let query = this.db
        .selectFrom('attachments')
        .select('id')
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .where('textContent', 'is', null)
        .where(sql`LOWER(file_ext)`, 'in', [
          ...SUPPORTED_ATTACHMENT_EXTENSIONS,
        ])
        .orderBy('id', 'asc')
        .limit(BACKFILL_BATCH_SIZE);
      if (cursor) {
        query = query.where('id', '>', cursor);
      }

      const attachments = await query.execute();
      if (attachments.length === 0) {
        break;
      }

      const pendingIds = attachments.map(({ id }) => id);
      const workerCount = Math.min(BACKFILL_CONCURRENCY, pendingIds.length);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (pendingIds.length > 0) {
            const id = pendingIds.shift();
            if (!id) return;

            try {
              await this.indexAttachment(id);
            } catch (error) {
              failureCount += 1;
              this.logger.warn(
                `Attachment content indexing failed for ${id}: ${this.errorMessage(error)}`,
              );
            }
          }
        }),
      );
      cursor = attachments.at(-1).id;
    }

    if (failureCount > 0) {
      throw new Error(
        `Attachment content backfill failed for ${failureCount} attachments`,
      );
    }
  }

  private async saveExtractedText(
    attachment: {
      id: string;
      filePath: string;
      updatedAt: Date;
    },
    textContent: string,
  ): Promise<void> {
    await executeTx(this.db, async (trx) => {
      const updated = await trx
        .updateTable('attachments')
        .set({ textContent })
        .where('id', '=', attachment.id)
        .where('filePath', '=', attachment.filePath)
        .where('updatedAt', '=', attachment.updatedAt)
        .where('deletedAt', 'is', null)
        .where(sql<boolean>`text_content IS DISTINCT FROM ${textContent}`)
        .returning('id')
        .executeTakeFirst();

      if (!updated) {
        return;
      }

      await this.searchQueue.add(
        QueueJob.SEARCH_INDEX_ATTACHMENT,
        { attachmentIds: [attachment.id] },
        {
          delay: 1_000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    });
  }

  private async extractDocxText(buffer: Buffer): Promise<string> {
    await this.assertDocxEntryCount(buffer);
    const JSZip = (await import('jszip')).default;
    const archive = await JSZip.loadAsync(buffer, {
      // CRC validation in loadAsync eagerly inflates every entry before the
      // byte budget below can stop a decompression bomb.
      checkCRC32: false,
      createFolders: false,
    });
    const budget = createZipReadBudget({
      maxEntryUncompressedBytes: MAX_DOCX_ENTRY_BYTES,
      maxTotalUncompressedBytes: MAX_DOCX_UNCOMPRESSED_BYTES,
    });

    const entries = Object.values(archive.files);
    if (entries.length > MAX_DOCX_ENTRIES) {
      throw new Error('DOCX archive contains too many entries');
    }

    for (const entry of entries) {
      if (!entry.dir) {
        await readZipEntryWithBudget(entry, budget);
      }
    }

    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ buffer })).value;
  }

  private async assertDocxEntryCount(buffer: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      yauzl.fromBuffer(
        buffer,
        { lazyEntries: true, decodeStrings: false },
        (error, zipfile) => {
          if (error) {
            reject(error);
            return;
          }
          if (zipfile.entryCount > MAX_DOCX_ENTRIES) {
            zipfile.close();
            reject(new Error('DOCX archive contains too many entries'));
            return;
          }
          zipfile.close();
          resolve();
        },
      );
    });
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;
    const parts: string[] = [];
    let extractedCharacters = 0;

    try {
      const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
          .join(' ');
        parts.push(pageText);
        extractedCharacters += pageText.length;

        if (extractedCharacters >= MAX_EXTRACTED_TEXT_CHARS) {
          break;
        }
      }
    } finally {
      await document.destroy();
    }

    return parts.join('\n\n');
  }

  private normalizeText(value: string): string {
    return value
      .replaceAll('\u0000', '')
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_EXTRACTED_TEXT_CHARS);
  }

  private isSupportedExtension(
    extension: string | null | undefined,
  ): extension is (typeof SUPPORTED_ATTACHMENT_EXTENSIONS)[number] {
    return SUPPORTED_ATTACHMENT_EXTENSIONS.includes(extension as any);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
