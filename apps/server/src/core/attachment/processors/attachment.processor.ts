import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AttachmentService } from '../services/attachment.service';
import { AttachmentContentService } from '../services/attachment-content.service';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';

@Processor(QueueName.ATTACHMENT_QUEUE)
export class AttachmentProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(AttachmentProcessor.name);
  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly attachmentContentService: AttachmentContentService,
  ) {
    super();
  }

  async process(job: Job<any, void>): Promise<void> {
    try {
      switch (job.name) {
        case QueueJob.DELETE_SPACE_ATTACHMENTS:
          await this.attachmentService.handleDeleteSpaceAttachments(
            this.requireLegacyCleanupId(job.data?.id),
          );
          return;
        case QueueJob.DELETE_USER_AVATARS:
          await this.attachmentService.handleDeleteUserAvatars(
            this.requireLegacyCleanupId(job.data?.id),
          );
          return;
        case QueueJob.DELETE_PAGE_ATTACHMENTS:
          await this.attachmentService.handleDeletePageAttachments(
            this.requireLegacyCleanupId(job.data?.pageId),
          );
          return;
        case QueueJob.ATTACHMENT_INDEX_CONTENT:
          await this.attachmentContentService.indexAttachment(
            job.data.attachmentId,
            { retryFailed: Boolean(job.data.retryFailed) },
          );
          return;
        case QueueJob.ATTACHMENT_INDEXING:
          await this.attachmentContentService.indexWorkspace(
            job.data.workspaceId,
            { retryFailed: Boolean(job.data.retryFailed) },
          );
          return;
        default:
          throw new Error('unknown_attachment_queue_job');
      }
    } catch (err) {
      throw err;
    }
  }

  private requireLegacyCleanupId(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('invalid_attachment_cleanup_job_payload');
    }
    return value;
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    this.logger.error({
      event: 'attachment_queue_job_failed',
      jobName: job.name,
    });
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
