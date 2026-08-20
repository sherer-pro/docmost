import { Logger, Optional } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { TypesenseIndexService } from './typesense-index.service';
import { DatabaseSearchProjectionService } from '../database/services/database-search-projection.service';

@Processor(QueueName.SEARCH_QUEUE)
export class SearchProcessor extends WorkerHost {
  private readonly logger = new Logger(SearchProcessor.name);

  constructor(
    private readonly typesenseIndexService: TypesenseIndexService,
    @Optional()
    private readonly databaseSearchProjection?: DatabaseSearchProjectionService,
    @Optional()
    @InjectQueue(QueueName.SEARCH_QUEUE)
    private readonly searchQueue?: Queue,
  ) {
    super();
  }

  async process(job: Job<any, void>): Promise<void> {
    const projectionPageIds = await this.processDatabaseProjection(job);
    if (projectionPageIds) {
      if (this.typesenseIndexService.isEnabled()) {
        await this.typesenseIndexService.reconcilePages(projectionPageIds);
      }
      return;
    }

    if (job.name === QueueJob.PAGE_CREATED) {
      const pageIds =
        job.data.pageIds ?? (job.data.pageId ? [job.data.pageId] : []);
      if (this.databaseSearchProjection && job.data.workspaceId) {
        await this.databaseSearchProjection.refreshPages(
          pageIds,
          job.data.workspaceId,
        );
      }
      if (this.typesenseIndexService.isEnabled()) {
        await this.typesenseIndexService.reconcilePages(pageIds);
      }
      return;
    }

    if (!this.typesenseIndexService.isEnabled()) {
      return;
    }

    switch (job.name) {
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
        await this.logQueueDepth();
        await this.typesenseIndexService.rebuildAll({
          workspaceId: job.data.workspaceId,
          entities: job.data.entities,
        });
        return;

      case QueueJob.DICTIONARY_TERMS_UPDATED:
        await this.typesenseIndexService.reconcileDictionaryTerms(
          job.data.termIds ?? [],
        );
        return;

      case QueueJob.DICTIONARY_SPACE_UPDATED:
        await this.typesenseIndexService.reconcileDictionarySpace(
          job.data.spaceId,
        );
        return;

      case QueueJob.TYPESENSE_CLEANUP_GENERATION:
        await this.typesenseIndexService.cleanupGeneration(
          job.data.collection,
          job.data.alias,
        );
        return;

      default:
        this.logger.debug(`Ignoring unsupported search job ${job.name}`);
    }
  }

  private async processDatabaseProjection(
    job: Job<any, void>,
  ): Promise<string[] | null> {
    if (!this.databaseSearchProjection) return null;
    switch (job.name) {
      case QueueJob.DATABASE_SEARCH_REBUILD_DATABASE:
        return this.databaseSearchProjection.refreshDatabase(
          job.data.databaseId,
          job.data.workspaceId,
        );
      case QueueJob.DATABASE_SEARCH_REBUILD_USER:
        return this.databaseSearchProjection.refreshRowsForUser(
          job.data.userId,
          job.data.workspaceId,
        );
      case QueueJob.DATABASE_SEARCH_REBUILD_WORKSPACE:
        return this.databaseSearchProjection.refreshWorkspace(
          job.data.workspaceId,
        );
      default:
        return null;
    }
  }

  private async logQueueDepth(): Promise<void> {
    try {
      const counts = await this.searchQueue?.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
      );
      if (counts) {
        this.logger.log({ event: 'search_queue_depth', ...counts });
      }
    } catch {
      this.logger.warn({ event: 'search_queue_depth_unavailable' });
    }
  }
}
