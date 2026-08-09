import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { StorageService } from '../../../integrations/storage/storage.service';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import {
  createZipReadBudget,
  readZipEntryWithBudget,
  ZipBudgetExceededError,
} from '../../../common/security/untrusted-document.util';
import * as yauzl from 'yauzl';
import { executeTx } from '@docmost/db/utils';
import { CONTENT_INDEXABLE_EXTENSIONS } from '../attachment.constants';

const SUPPORTED_ATTACHMENT_EXTENSIONS = CONTENT_INDEXABLE_EXTENSIONS;
const MAX_ATTACHMENT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 1_000_000;
const MAX_PDF_PAGES = 500;
const MAX_DOCX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 10_000;
const EXTRACTION_TIMEOUT_MS = 60_000;
const BACKFILL_CONCURRENCY = 2;
const BACKFILL_BATCH_SIZE = 100;
const RECOVERY_INTERVAL_MS = 60_000;
export const ATTACHMENT_CONTENT_INDEX_VERSION = 1;

export type AttachmentContentIndexStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'skipped'
  | 'failed';

/** Raised for content that can never be extracted, so it is not retried. */
class UnextractableAttachmentError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Raised for infrastructure failures that should be retried later. */
class TransientExtractionError extends Error {
  constructor(
    readonly code: string,
    readonly cause: unknown,
  ) {
    super(code);
  }
}

@Injectable()
export class AttachmentContentService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AttachmentContentService.name);
  private recoveryTimer?: NodeJS.Timeout;
  private recoveryPromise?: Promise<void>;
  private destroyed = false;

  constructor(
    private readonly storageService: StorageService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE)
    private readonly attachmentQueue: Queue,
    @InjectQueue(QueueName.SEARCH_QUEUE)
    private readonly searchQueue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.runRecoverySafely();
    this.recoveryTimer = setInterval(() => {
      void this.runRecoverySafely();
    }, RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
    }
    await this.recoveryPromise;
  }

  private async runRecoverySafely(): Promise<void> {
    if (this.destroyed || this.recoveryPromise) {
      return;
    }

    const recovery = this.schedulePendingWorkspaces().catch(() => {
      this.logger.warn({ event: 'attachment_content_recovery_failed' });
    });
    this.recoveryPromise = recovery;
    try {
      await recovery;
    } finally {
      if (this.recoveryPromise === recovery) {
        this.recoveryPromise = undefined;
      }
    }
  }

  private async schedulePendingWorkspaces(): Promise<void> {
    await this.recoverStuckExtractions();

    const workspaces = await this.db
      .selectFrom('attachments')
      .select('workspaceId')
      .distinct()
      .where('deletedAt', 'is', null)
      .where('contentIndexStatus', '=', 'pending')
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
  }

  /**
   * Returns extractions abandoned by a crashed worker to the pending state.
   */
  private async recoverStuckExtractions(): Promise<void> {
    const staleBefore = new Date(Date.now() - EXTRACTION_TIMEOUT_MS * 2);
    const recovered = await this.db
      .updateTable('attachments')
      .set({ contentIndexStatus: 'pending', contentIndexStartedAt: null })
      .where('contentIndexStatus', '=', 'processing')
      .where((eb) =>
        eb.or([
          eb('contentIndexStartedAt', 'is', null),
          eb('contentIndexStartedAt', '<', staleBefore),
        ]),
      )
      .returning('id')
      .execute();

    if (recovered.length > 0) {
      this.logger.log(
        `Reset ${recovered.length} stuck attachment content extraction(s) to pending`,
      );
    }
  }

  async indexAttachment(
    attachmentId: string,
    opts: { retryFailed?: boolean } = {},
  ): Promise<void> {
    const attachment = await this.db
      .selectFrom('attachments')
      .select([
        'id',
        'filePath',
        'fileName',
        'fileExt',
        'fileSize',
        'contentIndexStatus',
        'contentIndexVersion',
      ])
      .where('id', '=', attachmentId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!attachment) {
      return;
    }

    const extension = attachment.fileExt?.toLowerCase();
    if (!this.isSupportedExtension(extension)) {
      await this.markUnsupportedAttachment(attachment);
      return;
    }

    if (
      attachment.contentIndexStatus === 'ready' &&
      attachment.contentIndexVersion === ATTACHMENT_CONTENT_INDEX_VERSION
    ) {
      return;
    }
    if (attachment.contentIndexStatus === 'skipped') {
      return;
    }
    if (attachment.contentIndexStatus === 'failed' && !opts.retryFailed) {
      return;
    }

    const claimStartedAt = await this.claimForProcessing(
      attachment,
      opts.retryFailed,
    );
    if (!claimStartedAt) {
      return;
    }

    try {
      const fileSize = Number(attachment.fileSize ?? 0);
      if (fileSize > MAX_ATTACHMENT_FILE_BYTES) {
        throw new UnextractableAttachmentError('file_too_large');
      }

      let buffer: Buffer;
      try {
        if (!(await this.storageService.exists(attachment.filePath))) {
          throw new UnextractableAttachmentError('storage_missing');
        }
        buffer = await this.storageService.read(attachment.filePath);
      } catch (error) {
        if (error instanceof UnextractableAttachmentError) {
          throw error;
        }
        throw new TransientExtractionError('storage_unavailable', error);
      }
      if (buffer.byteLength > MAX_ATTACHMENT_FILE_BYTES) {
        throw new UnextractableAttachmentError('file_too_large');
      }

      const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
      const extracted =
        extension === '.pdf'
          ? await this.extractPdfText(buffer, deadline)
          : await this.extractDocxText(buffer, deadline);

      await this.saveExtractedText(
        attachment,
        this.normalizeText(extracted),
        claimStartedAt,
      );
    } catch (error) {
      await this.handleExtractionError(attachment, error, claimStartedAt);
    }
  }

  async indexWorkspace(
    workspaceId: string,
    opts: { retryFailed?: boolean } = {},
  ): Promise<void> {
    const statuses: AttachmentContentIndexStatus[] = opts.retryFailed
      ? ['pending', 'failed']
      : ['pending'];
    let cursor: string | null = null;
    let transientFailureCount = 0;
    let processedCount = 0;

    while (true) {
      let query = this.db
        .selectFrom('attachments')
        .select('id')
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .where('contentIndexStatus', 'in', statuses)
        .orderBy('id', 'asc')
        .limit(BACKFILL_BATCH_SIZE);
      if (cursor) {
        query = query.where('id', '>', cursor);
      }

      const attachments = await query.execute();
      if (attachments.length === 0) {
        break;
      }

      cursor = attachments.at(-1).id;
      const pendingIds = attachments.map(({ id }) => id);
      const workerCount = Math.min(BACKFILL_CONCURRENCY, pendingIds.length);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (pendingIds.length > 0) {
            const id = pendingIds.shift();
            if (!id) return;

            processedCount += 1;
            try {
              await this.indexAttachment(id, opts);
            } catch {
              transientFailureCount += 1;
              this.logger.warn({
                event: 'attachment_content_indexing_failed',
              });
            }
          }
        }),
      );
    }

    this.logger.log({
      event: 'attachment_content_backfill_completed',
      processedCount,
      transientFailureCount,
    });

    // Only infrastructure failures are worth another queue attempt; content
    // that can never be parsed is already recorded as a terminal state.
    if (transientFailureCount > 0) {
      throw new Error(
        `Attachment content backfill hit ${transientFailureCount} transient failure(s)`,
      );
    }
  }

  /**
   * Moves an attachment into `processing` only if no other worker owns it.
   */
  private async claimForProcessing(
    attachment: { id: string; filePath: string },
    retryFailed?: boolean,
  ): Promise<Date | null> {
    const claimable: AttachmentContentIndexStatus[] = retryFailed
      ? ['pending', 'failed']
      : ['pending'];
    const claimStartedAt = new Date();
    const claimed = await this.db
      .updateTable('attachments')
      .set({
        contentIndexStatus: 'processing',
        contentIndexStartedAt: claimStartedAt,
        contentIndexError: null,
      })
      .where('id', '=', attachment.id)
      .where('filePath', '=', attachment.filePath)
      .where('deletedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('contentIndexStatus', 'is', null),
          eb('contentIndexStatus', 'in', claimable),
        ]),
      )
      .returning('id')
      .executeTakeFirst();

    return claimed ? claimStartedAt : null;
  }

  private async handleExtractionError(
    attachment: { id: string; filePath: string },
    error: unknown,
    claimStartedAt: Date,
  ): Promise<void> {
    if (error instanceof TransientExtractionError) {
      // Release the claim so a later attempt can pick the attachment up again.
      await this.finishClaim(attachment, claimStartedAt, 'pending', error.code);
      throw error.cause;
    }

    const code =
      error instanceof UnextractableAttachmentError
        ? error.code
        : this.classifyExtractionError(error);
    const status: AttachmentContentIndexStatus =
      error instanceof UnextractableAttachmentError ||
      code === 'encrypted_document'
        ? 'skipped'
        : 'failed';

    this.logger.warn({
      event: 'attachment_content_extraction_terminal',
      status,
      errorCode: code,
    });
    await this.finishClaim(attachment, claimStartedAt, status, code);
  }

  private classifyExtractionError(error: unknown): string {
    const name = (error as { name?: string })?.name ?? '';
    const message = this.errorMessage(error).toLowerCase();

    if (name === 'PasswordException' || message.includes('password')) {
      return 'encrypted_document';
    }
    if (message.includes('timed out')) {
      return 'extraction_timeout';
    }
    if (
      error instanceof ZipBudgetExceededError ||
      message.includes('too many entries') ||
      message.includes('budget')
    ) {
      return 'archive_limits_exceeded';
    }
    return 'unreadable_document';
  }

  private async finishClaim(
    attachment: { id: string; filePath: string },
    claimStartedAt: Date,
    status: AttachmentContentIndexStatus,
    errorCode: string | null,
  ): Promise<void> {
    await this.db
      .updateTable('attachments')
      .set({
        contentIndexStatus: status,
        contentIndexError: errorCode,
        contentIndexStartedAt: null,
        contentIndexedAt: status === 'ready' ? new Date() : null,
      })
      .where('id', '=', attachment.id)
      .where('filePath', '=', attachment.filePath)
      .where('deletedAt', 'is', null)
      .where('contentIndexStatus', '=', 'processing')
      .where('contentIndexStartedAt', '=', claimStartedAt)
      .execute();
  }

  private async markUnsupportedAttachment(attachment: {
    id: string;
    filePath: string;
  }): Promise<void> {
    await this.db
      .updateTable('attachments')
      .set({
        contentIndexStatus: 'skipped',
        contentIndexError: 'unsupported_type',
        contentIndexStartedAt: null,
        contentIndexedAt: null,
      })
      .where('id', '=', attachment.id)
      .where('filePath', '=', attachment.filePath)
      .where('deletedAt', 'is', null)
      .where('contentIndexStatus', 'is', null)
      .execute();
  }

  private async saveExtractedText(
    attachment: {
      id: string;
      filePath: string;
    },
    textContent: string,
    claimStartedAt: Date,
  ): Promise<void> {
    await executeTx(this.db, async (trx) => {
      const updated = await trx
        .updateTable('attachments')
        .set({
          textContent,
          contentIndexStatus: 'ready',
          contentIndexError: null,
          contentIndexStartedAt: null,
          contentIndexedAt: new Date(),
          contentIndexVersion: ATTACHMENT_CONTENT_INDEX_VERSION,
        })
        .where('id', '=', attachment.id)
        .where('filePath', '=', attachment.filePath)
        .where('deletedAt', 'is', null)
        .where('contentIndexStatus', '=', 'processing')
        .where('contentIndexStartedAt', '=', claimStartedAt)
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

  private async extractDocxText(
    buffer: Buffer,
    deadline: number,
  ): Promise<string> {
    await this.withDeadline(this.assertDocxEntryCount(buffer), deadline);
    const jsZipModule = await this.withDeadline(import('jszip'), deadline);
    const JSZip = (jsZipModule.default ??
      jsZipModule) as typeof import('jszip');
    const archive = await this.withDeadline(
      JSZip.loadAsync(buffer, {
        // CRC validation in loadAsync eagerly inflates every entry before the
        // byte budget below can stop a decompression bomb.
        checkCRC32: false,
        createFolders: false,
      }),
      deadline,
    );
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
        await this.withDeadline(
          readZipEntryWithBudget(entry, budget),
          deadline,
        );
      }
    }

    const mammoth = await this.withDeadline(import('mammoth'), deadline);
    return (
      await this.withDeadline(mammoth.extractRawText({ buffer }), deadline)
    ).value;
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

  private async extractPdfText(
    buffer: Buffer,
    deadline: number,
  ): Promise<string> {
    const pdfjs: any = await this.withDeadline(
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      deadline,
    );
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useWorkerFetch: false,
    });
    let document: any;
    try {
      document = await this.withDeadline(loadingTask.promise, deadline);
    } catch (error) {
      await loadingTask.destroy().catch(() => undefined);
      throw error;
    }
    const parts: string[] = [];
    let extractedCharacters = 0;

    try {
      const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        // A slow document is truncated like the page and character limits
        // instead of blocking the worker indefinitely.
        if (Date.now() > deadline) {
          this.logger.warn(
            `PDF text extraction stopped at page ${pageNumber} after reaching the time limit`,
          );
          break;
        }

        const page: any = await this.withDeadline(
          document.getPage(pageNumber),
          deadline,
        );
        const content: any = await this.withDeadline(
          page.getTextContent(),
          deadline,
        );
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

  private async withDeadline<T>(
    operation: Promise<T>,
    deadline: number,
  ): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('Attachment text extraction timed out');
    }

    let timer: NodeJS.Timeout;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Attachment text extraction timed out')),
            remaining,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
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
