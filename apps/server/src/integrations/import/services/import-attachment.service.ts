import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { cleanUrlString } from '../utils/file.utils';
import { StorageService } from '../../storage/storage.service';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'fs';
import { getMimeType, sanitizeFileName } from '../../../common/helpers';
import { v7 } from 'uuid';
import { FileTask } from '@docmost/db/types/entity.types';
import { getAttachmentFolderPath } from '../../../core/attachment/attachment.utils';
import {
  AttachmentType,
  CONTENT_INDEXABLE_EXTENSIONS,
} from '../../../core/attachment/attachment.constants';
import { unwrapFromParagraph } from '../utils/import-formatter';
import { resolveRelativeAttachmentPath } from '../utils/import.utils';
import { load } from 'cheerio';
import pLimit from 'p-limit';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../queue/constants';
import {
  SAFE_FILE_VALIDATION_ERROR_MESSAGE,
  resolveTrustedMimeType,
  validateFileExtensionAndSignature,
} from '../../../common/helpers/file-validation';

interface AttachmentInfo {
  href: string;
  fileName: string;
  mimeType: string;
}

@Injectable()
export class ImportAttachmentService {
  private readonly logger = new Logger(ImportAttachmentService.name);
  private readonly CONCURRENT_UPLOADS = 3;
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY = 2000;

  constructor(
    private readonly storageService: StorageService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
  ) {}

  async processAttachments(opts: {
    html: string;
    pageRelativePath: string;
    extractDir: string;
    pageId: string;
    fileTask: FileTask;
    attachmentCandidates: Map<string, string>;
    pageAttachments?: AttachmentInfo[];
  }): Promise<string> {
    const {
      html,
      pageRelativePath,
      pageId,
      fileTask,
      attachmentCandidates,
      pageAttachments = [],
    } = opts;

    const attachmentTasks: (() => Promise<void>)[] = [];
    const limit = pLimit(this.CONCURRENT_UPLOADS);
    const uploadStats = {
      total: 0,
      completed: 0,
      failed: 0,
      failedFiles: [] as string[],
    };

    /**
     * Cache keyed by the *relative* path that appears in the HTML.
     * Ensures we upload (and DB-insert) each attachment at most once,
     * even if it's referenced multiple times on the page.
     */
    const processed = new Map<
      string,
      {
        attachmentId: string;
        storageFilePath: string;
        apiFilePath: string;
        fileNameWithExt: string;
        abs: string;
      }
    >();

    const uploadOnce = (relPath: string) => {
      const abs = attachmentCandidates.get(relPath)!;
      const attachmentId = v7();
      const ext = path.extname(abs);

      const fileNameWithExt =
        sanitizeFileName(path.basename(abs, ext)) + ext.toLowerCase();

      const storageFilePath = `${getAttachmentFolderPath(
        AttachmentType.File,
        fileTask.workspaceId,
      )}/${attachmentId}/${fileNameWithExt}`;

      const apiFilePath = `/api/files/${attachmentId}/${fileNameWithExt}`;

      attachmentTasks.push(() =>
        this.uploadWithRetry({
          abs,
          storageFilePath,
          attachmentId,
          fileNameWithExt,
          ext,
          pageId,
          fileTask,
          uploadStats,
        }),
      );

      return {
        attachmentId,
        storageFilePath,
        apiFilePath,
        fileNameWithExt,
        abs,
      };
    };

    /**
     * – Returns cached data if we’ve already processed this path.
     * – Otherwise calls `uploadOnce`, stores the result, and returns it.
     */
    const processFile = (relPath: string) => {
      const cached = processed.get(relPath);
      if (cached) return cached;

      const fresh = uploadOnce(relPath);
      processed.set(relPath, fresh);
      return fresh;
    };

    const pageDir = path.dirname(pageRelativePath);
    const $ = load(html);

    // image
    for (const imgEl of $('img').toArray()) {
      const $img = $(imgEl);
      const src = cleanUrlString($img.attr('src') ?? '')!;
      if (!src || src.startsWith('http')) continue;

      const relPath = resolveRelativeAttachmentPath(
        src,
        pageDir,
        attachmentCandidates,
      );
      if (!relPath) continue;

      const { attachmentId, apiFilePath } = processFile(relPath);

      const width = $img.attr('width') ?? '100%';
      const align = $img.attr('data-align') ?? 'center';

      $img
        .attr('src', apiFilePath)
        .attr('data-attachment-id', attachmentId)
        .attr('width', width)
        .attr('data-align', align);

      unwrapFromParagraph($, $img);
    }

    // video
    for (const vidEl of $('video').toArray()) {
      const $vid = $(vidEl);
      const src = cleanUrlString($vid.attr('src') ?? '')!;
      if (!src || src.startsWith('http')) continue;

      const relPath = resolveRelativeAttachmentPath(
        src,
        pageDir,
        attachmentCandidates,
      );
      if (!relPath) continue;

      const { attachmentId, apiFilePath } = processFile(relPath);

      const width = $vid.attr('width') ?? '100%';
      const align = $vid.attr('data-align') ?? 'center';

      $vid
        .attr('src', apiFilePath)
        .attr('data-attachment-id', attachmentId)
        .attr('width', width)
        .attr('data-align', align);

      unwrapFromParagraph($, $vid);
    }

    // <div data-type="attachment">
    for (const el of $('div[data-type="attachment"]').toArray()) {
      const $oldDiv = $(el);
      const rawUrl = cleanUrlString($oldDiv.attr('data-attachment-url') ?? '')!;
      if (!rawUrl || rawUrl.startsWith('http')) continue;

      const relPath = resolveRelativeAttachmentPath(
        rawUrl,
        pageDir,
        attachmentCandidates,
      );
      if (!relPath) continue;

      const { attachmentId, apiFilePath, abs } = processFile(relPath);
      const fileName = path.basename(abs);
      const mime = getMimeType(abs);

      const $newDiv = $('<div>')
        .attr('data-type', 'attachment')
        .attr('data-attachment-url', apiFilePath)
        .attr('data-attachment-name', fileName)
        .attr('data-attachment-mime', mime)
        .attr('data-attachment-id', attachmentId);

      $oldDiv.replaceWith($newDiv);
      unwrapFromParagraph($, $newDiv);
    }

    // rewrite other attachments via <a>
    for (const aEl of $('a').toArray()) {
      const $a = $(aEl);
      const href = cleanUrlString($a.attr('href') ?? '')!;
      if (!href || href.startsWith('http')) continue;

      const relPath = resolveRelativeAttachmentPath(
        href,
        pageDir,
        attachmentCandidates,
      );
      if (!relPath) continue;

      const { attachmentId, apiFilePath, abs } = processFile(relPath);
      const ext = path.extname(relPath).toLowerCase();

      if (ext === '.mp4') {
        const $video = $('<video>')
          .attr('src', apiFilePath)
          .attr('data-attachment-id', attachmentId)
          .attr('width', '100%')
          .attr('data-align', 'center');
        $a.replaceWith($video);
        unwrapFromParagraph($, $video);
      } else {
        const attachmentName = path.basename(abs);

        const $div = $('<div>')
          .attr('data-type', 'attachment')
          .attr('data-attachment-url', apiFilePath)
          .attr('data-attachment-name', attachmentName)
          .attr('data-attachment-mime', getMimeType(abs))
          .attr('data-attachment-id', attachmentId);

        $a.replaceWith($div);
        unwrapFromParagraph($, $div);
      }
    }

    // excalidraw and drawio
    for (const type of ['excalidraw', 'drawio'] as const) {
      for (const el of $(`div[data-type="${type}"]`).toArray()) {
        const $oldDiv = $(el);
        const rawSrc = cleanUrlString($oldDiv.attr('data-src') ?? '')!;
        if (!rawSrc || rawSrc.startsWith('http')) continue;

        const relPath = resolveRelativeAttachmentPath(
          rawSrc,
          pageDir,
          attachmentCandidates,
        );
        if (!relPath) continue;

        const { attachmentId, apiFilePath, abs } = processFile(relPath);
        const fileName = path.basename(abs);

        const width = $oldDiv.attr('data-width') || '100%';
        const align = $oldDiv.attr('data-align') || 'center';

        const $newDiv = $('<div>')
          .attr('data-type', type)
          .attr('data-src', apiFilePath)
          .attr('data-title', fileName)
          .attr('data-width', width)
          .attr('data-align', align)
          .attr('data-attachment-id', attachmentId);

        $oldDiv.replaceWith($newDiv);
        unwrapFromParagraph($, $newDiv);
      }
    }

    // Process attachments from the attachment section that weren't referenced in HTML
    // These need to be added as attachment nodes so they get uploaded
    for (const attachment of pageAttachments) {
      const { href, fileName, mimeType } = attachment;

      // Check if already processed (was referenced in HTML)
      if (processed.has(href)) {
        continue;
      }

      // Skip if the file doesn't exist
      if (!attachmentCandidates.has(href)) {
        continue;
      }

      // This attachment was in the list but not referenced in HTML - add it
      const { attachmentId, apiFilePath, abs } = processFile(href);
      const mime = mimeType || getMimeType(abs);

      // Add as attachment node at the end
      const $attachmentDiv = $('<div>')
        .attr('data-type', 'attachment')
        .attr('data-attachment-url', apiFilePath)
        .attr('data-attachment-name', fileName)
        .attr('data-attachment-mime', mime)
        .attr('data-attachment-id', attachmentId);

      $.root().append($attachmentDiv);
    }

    // wait for all uploads & DB inserts
    uploadStats.total = attachmentTasks.length;

    if (uploadStats.total > 0) {
      try {
        await Promise.all(attachmentTasks.map((task) => limit(task)));
      } catch (err) {
        this.logger.error('Import attachment upload error', err);
      }

      this.logger.debug(
        `Upload completed: ${uploadStats.completed}/${uploadStats.total} successful, ${uploadStats.failed} failed`,
      );

      if (uploadStats.failed > 0) {
        this.logger.warn(
          `Failed to upload ${uploadStats.failed} files:`,
          uploadStats.failedFiles,
        );
        throw new Error(
          `Attachment import failed for ${uploadStats.failed} file(s): ${uploadStats.failedFiles.join(', ')}`,
        );
      }
    }

    // Post-process DOM elements to add file sizes after uploads complete
    // This avoids blocking file operations during initial DOM processing
    const elementsNeedingSize = $('[data-attachment-id]:not([data-size])');
    for (const element of elementsNeedingSize.toArray()) {
      const $el = $(element);
      const attachmentId = $el.attr('data-attachment-id');
      if (!attachmentId) continue;

      // Find the corresponding processed file info
      const processedEntry = Array.from(processed.values()).find(
        (entry) => entry.attachmentId === attachmentId,
      );

      if (processedEntry) {
        try {
          const stat = await fs.stat(processedEntry.abs);
          $el.attr('data-size', stat.size.toString());
        } catch (error) {
          this.logger.debug(
            `Could not get size for ${processedEntry.abs}:`,
            error,
          );
        }
      }
    }

    return $.root().html() || '';
  }

  private async uploadWithRetry(opts: {
    abs: string;
    storageFilePath: string;
    attachmentId: string;
    fileNameWithExt: string;
    ext: string;
    pageId: string;
    fileTask: FileTask;
    uploadStats: {
      total: number;
      completed: number;
      failed: number;
      failedFiles: string[];
    };
  }): Promise<void> {
    const {
      abs,
      storageFilePath,
      attachmentId,
      fileNameWithExt,
      ext,
      pageId,
      fileTask,
      uploadStats,
    } = opts;

    let lastError: Error;
    const isContentIndexable = CONTENT_INDEXABLE_EXTENSIONS.includes(
      ext?.toLowerCase() as (typeof CONTENT_INDEXABLE_EXTENSIONS)[number],
    );

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const fileBuffer = await fs.readFile(abs);
        await validateFileExtensionAndSignature({
          fileName: fileNameWithExt,
          fileBuffer,
          safeErrorMessage: SAFE_FILE_VALIDATION_ERROR_MESSAGE,
        });

        const trustedMimeType = resolveTrustedMimeType({
          fileExtension: ext,
          fileBuffer,
          fallbackMimeType: getMimeType(fileNameWithExt),
        });

        const fileStream = createReadStream(abs);
        await this.storageService.uploadStream(storageFilePath, fileStream, {
          recreateClient: true,
        });

        const stat = await fs.stat(abs);

        await this.db
          .insertInto('attachments')
          .values({
            id: attachmentId,
            filePath: storageFilePath,
            fileName: fileNameWithExt,
            fileSize: stat.size,
            mimeType: trustedMimeType,
            type: 'file',
            fileExt: ext,
            creatorId: fileTask.creatorId,
            workspaceId: fileTask.workspaceId,
            pageId,
            spaceId: fileTask.spaceId,
            contentIndexStatus: isContentIndexable ? 'pending' : null,
          })
          .execute();

        // Queue PDF and DOCX files for indexing
        if (isContentIndexable) {
          try {
            await this.attachmentQueue.add(
              QueueJob.ATTACHMENT_INDEX_CONTENT,
              { attachmentId },
              {
                attempts: 3,
                backoff: {
                  type: 'exponential',
                  delay: 10_000,
                },
                removeOnComplete: true,
                removeOnFail: true,
              },
            );
            this.logger.debug(
              `Queued ${fileNameWithExt} for indexing (attachment ID: ${attachmentId})`,
            );
          } catch (err) {
            this.logger.error(
              `Failed to queue indexing for imported attachment ${attachmentId}: ${err}`,
            );
          }
        }

        uploadStats.completed++;

        if (uploadStats.completed % 10 === 0) {
          this.logger.debug(
            `Upload progress: ${uploadStats.completed}/${uploadStats.total}`,
          );
        }

        return;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Upload attempt ${attempt}/${this.MAX_RETRIES} failed for ${fileNameWithExt}: ${error instanceof Error ? error.message : String(error)}`,
        );

        if (attempt < this.MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.RETRY_DELAY * attempt),
          );
        }
      }
    }

    uploadStats.failed++;
    uploadStats.failedFiles.push(fileNameWithExt);
    this.logger.error(
      `Failed to upload ${fileNameWithExt} after ${this.MAX_RETRIES} attempts:`,
      lastError,
    );
  }
}
