import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueJob, QueueName } from '../constants';
import {
  IAddPageWatchersJob,
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
import { DuplicatePageAttachmentsService } from '../services/duplicate-page-attachments.service';
import { QueueOutboxService } from '../outbox/queue-outbox.service';

@Processor(QueueName.GENERAL_QUEUE)
export class GeneralQueueProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly logger = new Logger(GeneralQueueProcessor.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly backlinkRepo: BacklinkRepo,
    private readonly watcherRepo: WatcherRepo,
    private readonly duplicatePageAttachments: DuplicatePageAttachmentsService,
    private readonly queueOutbox: QueueOutboxService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
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
        return;
      }
      case QueueJob.PAGE_BACKLINKS:
        await processBacklinks(
          this.db,
          this.backlinkRepo,
          job.data as IPageBacklinkJob,
        );
        return;
      case QueueJob.DUPLICATE_PAGE_ATTACHMENTS:
        await this.duplicatePageAttachments.process(
          job.data as IDuplicatePageAttachmentsJob,
        );
        return;
      case QueueJob.PROCESS_QUEUE_OUTBOX:
        await this.queueOutbox.processAvailable();
        return;
      case QueueJob.PURGE_QUEUE_OUTBOX:
        await this.queueOutbox.purgeExpiredTerminalEntries();
        return;
      default:
        throw new Error(`Unsupported general queue job: ${job.name}`);
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job): void {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job): void {
    this.logger.error({
      event: 'general_queue_job_failed',
      jobName: job.name,
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.debug(`Completed ${job.name} job`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
