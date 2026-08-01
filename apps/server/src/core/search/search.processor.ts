import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { TypesenseIndexService } from './typesense-index.service';

@Processor(QueueName.SEARCH_QUEUE)
export class SearchProcessor extends WorkerHost {
  private readonly logger = new Logger(SearchProcessor.name);

  constructor(private readonly typesenseIndexService: TypesenseIndexService) {
    super();
  }

  async process(job: Job<any, void>): Promise<void> {
    if (!this.typesenseIndexService.isEnabled()) {
      return;
    }

    switch (job.name) {
      case QueueJob.PAGE_CREATED:
      case QueueJob.PAGE_UPDATED:
      case QueueJob.PAGE_RESTORED:
      case QueueJob.PAGE_DELETED:
      case QueueJob.PAGE_SOFT_DELETED:
        await this.typesenseIndexService.reconcilePages(
          job.data.pageIds ?? (job.data.pageId ? [job.data.pageId] : []),
        );
        return;

      case QueueJob.SEARCH_INDEX_ATTACHMENT:
        await this.typesenseIndexService.indexAttachments(
          job.data.attachmentIds ??
            (job.data.attachmentId ? [job.data.attachmentId] : []),
        );
        return;

      case QueueJob.SPACE_UPDATED:
      case QueueJob.SPACE_DELETED:
        await this.typesenseIndexService.reconcileSpace(job.data.spaceId);
        return;

      case QueueJob.WORKSPACE_DELETED:
        await this.typesenseIndexService.removeWorkspace(job.data.workspaceId);
        return;

      case QueueJob.TYPESENSE_FLUSH:
        await this.typesenseIndexService.rebuildAll();
        return;

      default:
        this.logger.debug(`Ignoring unsupported search job ${job.name}`);
    }
  }
}
