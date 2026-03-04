import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import pLimit from 'p-limit';
import { QueueJob, QueueName } from '../constants';
import {
  IAddPageWatchersJob,
  IDuplicatePageAttachmentMapping,
  IDuplicatePageAttachmentsJob,
  IPageBacklinkJob,
} from '../constants/queue.interface';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { BacklinkRepo } from '@docmost/db/repos/backlink/backlink.repo';
import {
  WatcherRepo,
  WatcherType,
} from '@docmost/db/repos/watcher/watcher.repo';
import { InsertableWatcher } from '@docmost/db/types/entity.types';
import { processBacklinks } from '../tasks/backlinks.task';
import { StorageService } from '../../storage/storage.service';

@Processor(QueueName.GENERAL_QUEUE)
export class GeneralQueueProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly logger = new Logger(GeneralQueueProcessor.name);

  /**
   * Concurrency limit for attachment copy during page duplication.
   * A small limit protects storage from spikes of concurrent operations.
   */
  private static readonly DUPLICATE_ATTACHMENTS_CONCURRENCY = 5;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly backlinkRepo: BacklinkRepo,
    private readonly watcherRepo: WatcherRepo,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      switch (job.name) {
        case QueueJob.ADD_PAGE_WATCHERS: {
          const { userIds, pageId, spaceId, workspaceId } =
            job.data as IAddPageWatchersJob;
          const watchers: InsertableWatcher[] = userIds.map((userId) => ({
            userId,
            pageId,
            spaceId,
            workspaceId,
            type: WatcherType.PAGE,
            addedById: userId,
          }));
          await this.watcherRepo.insertMany(watchers);
          break;
        }

        case QueueJob.PAGE_BACKLINKS: {
          await processBacklinks(
            this.db,
            this.backlinkRepo,
            job.data as IPageBacklinkJob,
          );
          break;
        }

        case QueueJob.DUPLICATE_PAGE_ATTACHMENTS: {
          await this.processDuplicatePageAttachments(
            job.data as IDuplicatePageAttachmentsJob,
          );
          break;
        }
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * Asynchronously copies attachments after duplicating a page tree.
   * This runs in a worker so the duplicate API can respond quickly.
   */
  private async processDuplicatePageAttachments(
    data: IDuplicatePageAttachmentsJob,
  ): Promise<void> {
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
        `Duplicate attachments job skipped: no attachments. rootPageId=${data.rootPageId}, newPageId=${data.newPageId}`,
      );
      return;
    }

    const attachments = await this.db
      .selectFrom('attachments')
      .selectAll()
      .where('id', 'in', attachmentIds)
      .where('workspaceId', '=', data.workspaceId)
      .execute();

    const limit = pLimit(GeneralQueueProcessor.DUPLICATE_ATTACHMENTS_CONCURRENCY);

    let successCount = 0;
    let errorCount = 0;

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
              })
              .execute();

            successCount += 1;
          } catch (err) {
            errorCount += 1;
            this.logger.error(
              `Duplicate attachment copy failed. attachmentId=${attachment.id}, newAttachmentId=${mapping.newAttachmentId}, oldPageId=${mapping.oldPageId}, newPageId=${mapping.newPageId}, rootPageId=${data.rootPageId}, workspaceId=${data.workspaceId}`,
              err,
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

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `Duplicate attachments job finished. rootPageId=${data.rootPageId}, newPageId=${data.newPageId}, workspaceId=${data.workspaceId}, durationMs=${durationMs}, successCount=${successCount}, errorCount=${errorCount}`,
    );

    if (errorCount > 0) {
      this.logger.warn(
        `Duplicate attachments job completed with partial errors. rootPageId=${data.rootPageId}, newPageId=${data.newPageId}, workspaceId=${data.workspaceId}, successCount=${successCount}, errorCount=${errorCount}`,
      );
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    this.logger.error(
      `Error processing ${job.name} job. Reason: ${job.failedReason}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Completed ${job.name} job`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
