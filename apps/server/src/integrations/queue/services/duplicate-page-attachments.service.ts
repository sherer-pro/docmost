import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { Queue } from 'bullmq';
import pLimit from 'p-limit';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { StorageService } from '../../storage/storage.service';
import { CONTENT_INDEXABLE_EXTENSIONS } from '../../../core/attachment/attachment.constants';
import { QueueJob, QueueName } from '../constants';
import {
  IDuplicatePageAttachmentMapping,
  IDuplicatePageAttachmentsJob,
} from '../constants/queue.interface';

@Injectable()
export class DuplicatePageAttachmentsService {
  private static readonly CONCURRENCY = 5;
  private readonly logger = new Logger(DuplicatePageAttachmentsService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
    @InjectQueue(QueueName.SEARCH_QUEUE)
    private readonly searchQueue: Queue,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE)
    private readonly attachmentQueue: Queue,
  ) {}

  async process(data: IDuplicatePageAttachmentsJob): Promise<void> {
    const startedAt = Date.now();
    const mappingByOldAttachmentId = new Map<
      string,
      IDuplicatePageAttachmentMapping
    >();
    for (const mapping of data.attachmentMappings) {
      mappingByOldAttachmentId.set(mapping.oldAttachmentId, mapping);
    }

    const attachmentIds = Array.from(mappingByOldAttachmentId.keys());
    if (attachmentIds.length === 0) {
      this.logger.debug(
        `Duplicate attachments task skipped: no attachments. rootPageId=${data.rootPageId}, newPageId=${data.newPageId}`,
      );
      return;
    }

    const attachments = await this.db
      .selectFrom('attachments')
      .select([
        'id',
        'type',
        'filePath',
        'fileName',
        'fileSize',
        'mimeType',
        'fileExt',
        'creatorId',
        'workspaceId',
        'pageId',
        'textContent',
        'contentIndexStatus',
        'contentIndexVersion',
        'contentIndexedAt',
      ])
      .where('id', 'in', attachmentIds)
      .where('workspaceId', '=', data.workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    const limit = pLimit(DuplicatePageAttachmentsService.CONCURRENCY);
    let successCount = 0;
    let errorCount = 0;
    const indexedAttachmentIds: string[] = [];
    const contentAttachmentIds: string[] = [];

    await Promise.all(
      attachments.map((attachment) =>
        limit(async () => {
          const mapping = mappingByOldAttachmentId.get(attachment.id);
          if (!mapping) {
            errorCount += 1;
            this.logger.warn(
              `Duplicate attachment mapping not found. attachmentId=${attachment.id}, rootPageId=${data.rootPageId}, newPageId=${data.newPageId}`,
            );
            return;
          }

          if (attachment.pageId !== mapping.oldPageId) {
            errorCount += 1;
            this.logger.warn(
              `Duplicate attachment page mismatch. attachmentId=${attachment.id}, expectedPageId=${mapping.oldPageId}, actualPageId=${attachment.pageId}, rootPageId=${data.rootPageId}`,
            );
            return;
          }

          const newPathFile = attachment.filePath.replace(
            attachment.id,
            mapping.newAttachmentId,
          );

          try {
            const existing = await this.db
              .selectFrom('attachments')
              .select([
                'id',
                'workspaceId',
                'pageId',
                'spaceId',
                'filePath',
                'fileExt',
                'textContent',
              ])
              .where('id', '=', mapping.newAttachmentId)
              .executeTakeFirst();

            if (existing) {
              if (
                existing.workspaceId !== data.workspaceId ||
                existing.pageId !== mapping.newPageId ||
                existing.spaceId !== data.spaceId ||
                existing.filePath !== newPathFile
              ) {
                throw new Error(
                  'Existing duplicate attachment is inconsistent',
                );
              }
              if (!(await this.storageService.exists(newPathFile))) {
                await this.storageService.copy(
                  attachment.filePath,
                  newPathFile,
                );
              }
            } else {
              await this.storageService.copy(attachment.filePath, newPathFile);
              await this.db
                .insertInto('attachments')
                .values({
                  id: mapping.newAttachmentId,
                  type: attachment.type,
                  filePath: newPathFile,
                  fileName: attachment.fileName,
                  fileSize: attachment.fileSize,
                  mimeType: attachment.mimeType,
                  fileExt: attachment.fileExt,
                  creatorId: attachment.creatorId,
                  workspaceId: attachment.workspaceId,
                  pageId: mapping.newPageId,
                  spaceId: data.spaceId,
                  textContent: attachment.textContent,
                  contentIndexStatus: attachment.contentIndexStatus,
                  contentIndexVersion: attachment.contentIndexVersion,
                  contentIndexedAt: attachment.contentIndexedAt,
                })
                .execute();
            }

            successCount += 1;
            indexedAttachmentIds.push(mapping.newAttachmentId);
            if (
              !attachment.textContent &&
              CONTENT_INDEXABLE_EXTENSIONS.includes(
                attachment.fileExt?.toLowerCase() as (typeof CONTENT_INDEXABLE_EXTENSIONS)[number],
              )
            ) {
              contentAttachmentIds.push(mapping.newAttachmentId);
            }
          } catch (error) {
            errorCount += 1;
            this.logger.error(
              `Duplicate attachment copy failed. attachmentId=${attachment.id}, newAttachmentId=${mapping.newAttachmentId}, oldPageId=${mapping.oldPageId}, newPageId=${mapping.newPageId}, rootPageId=${data.rootPageId}, workspaceId=${data.workspaceId}`,
              error,
            );
          }
        }),
      ),
    );

    const missingCount = data.attachmentMappings.length - attachments.length;
    if (missingCount > 0) {
      errorCount += missingCount;
      this.logger.warn(
        `Duplicate attachments missing source records. missing=${missingCount}, rootPageId=${data.rootPageId}, newPageId=${data.newPageId}, workspaceId=${data.workspaceId}`,
      );
    }

    if (indexedAttachmentIds.length > 0) {
      await this.searchQueue.add(
        QueueJob.SEARCH_INDEX_ATTACHMENT,
        { attachmentIds: indexedAttachmentIds },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }
    await Promise.all(
      contentAttachmentIds.map((attachmentId) =>
        this.attachmentQueue.add(
          QueueJob.ATTACHMENT_INDEX_CONTENT,
          { attachmentId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10_000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
      ),
    );

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `Duplicate attachments task finished. rootPageId=${data.rootPageId}, newPageId=${data.newPageId}, workspaceId=${data.workspaceId}, durationMs=${durationMs}, successCount=${successCount}, errorCount=${errorCount}`,
    );

    if (errorCount > 0) {
      throw new Error(
        `Duplicate attachments task has partial errors. rootPageId=${data.rootPageId}, newPageId=${data.newPageId}, workspaceId=${data.workspaceId}, successCount=${successCount}, errorCount=${errorCount}`,
      );
    }
  }
}
