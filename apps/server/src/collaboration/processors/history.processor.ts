import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { Job, Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import {
  IPageHistoryEventFlushJob,
  IPageHistoryJob,
  IPageRecipientNotificationJob,
} from '../../integrations/queue/constants/queue.interface';
import { PageHistoryRepo } from '@docmost/db/repos/page/page-history.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { isDeepStrictEqual } from 'node:util';
import {
  CollabHistoryService,
  IBufferedPageHistoryEvent,
  IHistoryDirtyState,
} from '../services/collab-history.service';
import { WatcherService } from '../../core/watcher/watcher.service';
import { PAGE_HISTORY_EVENT_VERSION } from '../../core/page/services/page-history-change.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { QueueOutboxRepo } from '@docmost/db/repos/queue-outbox/queue-outbox.repo';
import { QueueOutboxKind } from '../../integrations/queue/outbox/queue-outbox.types';
import type { JsonValue } from '@docmost/db/types/db';

type HistoryQueueJobData = IPageHistoryJob | IPageHistoryEventFlushJob;

const PAGE_HISTORY_RETENTION_BATCH_SIZE = 500;
const PAGE_HISTORY_RETENTION_MAX_BATCHES_PER_RUN = 20;
const PAGE_HISTORY_EVENT_RECONCILE_BATCH_SIZE = 100;

@Processor(QueueName.HISTORY_QUEUE)
export class HistoryProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(HistoryProcessor.name);

  constructor(
    private readonly pageHistoryRepo: PageHistoryRepo,
    private readonly pageRepo: PageRepo,
    private readonly collabHistory: CollabHistoryService,
    private readonly watcherService: WatcherService,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly outboxRepo: QueueOutboxRepo,
    @InjectQueue(QueueName.HISTORY_QUEUE)
    private readonly historyQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<HistoryQueueJobData, void>): Promise<void> {
    if (job.name === QueueJob.PAGE_HISTORY) {
      await this.processPageContentHistory(job.data as IPageHistoryJob);
      return;
    }

    if (job.name === QueueJob.PAGE_HISTORY_EVENT_FLUSH) {
      await this.processBufferedEventHistory(
        job as Job<IPageHistoryEventFlushJob, void>,
      );
      return;
    }

    if (job.name === QueueJob.PAGE_HISTORY_RETENTION_CLEANUP) {
      await this.cleanupExpiredPageHistory();
      return;
    }

    if (job.name === QueueJob.PAGE_HISTORY_EVENT_RECONCILE) {
      await this.reconcileRecoverableHistory();
      return;
    }

    throw new Error(`Unsupported history queue job: ${job.name}`);
  }

  private async processPageContentHistory(
    data: IPageHistoryJob,
  ): Promise<void> {
    const { pageId } = data;
    const dirtyState = await this.collabHistory.getContentDirtyState(pageId);

    if (dirtyState && dirtyState.delayMs > 0) {
      await this.collabHistory.scheduleContentHistoryFlush(pageId);
      return;
    }

    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });

    if (!page) {
      this.logger.warn(`Page ${pageId} not found, skipping history`);
      await this.collabHistory.clearContributors(pageId);
      await this.clearProcessedContentDirtyState(pageId, dirtyState);
      return;
    }

    const lastHistory = await this.pageHistoryRepo.findPageLastHistory(pageId, {
      includeContent: true,
    });

    if (lastHistory && isDeepStrictEqual(lastHistory.content, page.content)) {
      if (await this.clearProcessedContentDirtyState(pageId, dirtyState)) {
        await this.collabHistory.clearContributors(pageId);
      }
      return;
    }

    const contributorIds = await this.collabHistory.popContributors(pageId);

    try {
      await this.watcherService.addPageWatchers(
        contributorIds,
        pageId,
        page.spaceId,
        page.workspaceId,
      );

      await executeTx(this.db, async (trx) => {
        const history = await this.pageHistoryRepo.saveHistory(page, {
          contributorIds,
          trx,
        });

        // Persist dispatch in the same transaction as history. The outbox
        // sweep repairs a lost Redis signal, and an ambiguous PostgreSQL
        // commit cannot leave only one side committed.
        if (page.lastUpdatedById) {
          const jobData = {
            eventId: history.id,
            reason: 'document-changed',
            actorId: page.lastUpdatedById,
            pageId,
            spaceId: page.spaceId,
            workspaceId: page.workspaceId,
          } satisfies IPageRecipientNotificationJob;
          await this.outboxRepo.enqueue(
            {
              kind: QueueOutboxKind.NOTIFICATION_DISPATCH,
              payload: {
                jobName: QueueJob.PAGE_RECIPIENT_NOTIFICATION,
                jobData,
              } as unknown as JsonValue,
              dedupeKey: `notification-dispatch:${QueueJob.PAGE_RECIPIENT_NOTIFICATION}:${history.id}`,
            },
            trx,
          );
        }
      });

      await this.clearProcessedContentDirtyState(pageId, dirtyState);
      this.logger.debug(`History created for page: ${pageId}`);
    } catch (err) {
      await this.collabHistory.addContributors(pageId, contributorIds);
      throw err;
    }
  }

  private async processBufferedEventHistory(
    job: Job<IPageHistoryEventFlushJob, void>,
  ): Promise<void> {
    const data = job.data;
    const { pageId } = data;
    const dirtyState = await this.collabHistory.getEventDirtyState(pageId);

    if (dirtyState && dirtyState.delayMs > 0) {
      await this.collabHistory.scheduleEventFlush(pageId);
      return;
    }

    const batch =
      await this.collabHistory.takeBufferedEventsForProcessing(pageId);

    if (!batch) {
      await this.clearProcessedEventDirtyState(pageId, dirtyState);
      return;
    }

    const { batchId, events: bufferedEvents } = batch;
    if (data.batchId && data.batchId !== batchId) {
      throw new Error('Page history event recovery batch ownership changed');
    }
    if (!data.batchId && typeof job.updateData === 'function') {
      await job.updateData({ ...data, batchId });
    }
    if (bufferedEvents.length === 0) {
      await this.acknowledgeEventBatch(pageId, batchId);
      await this.clearProcessedEventDirtyState(pageId, dirtyState);
      return;
    }

    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });

    if (!page) {
      this.logger.warn(
        `Page ${pageId} not found, skipping event history flush`,
      );
      await this.acknowledgeEventBatch(pageId, batchId);
      const clearedDirty = await this.clearProcessedEventDirtyState(
        pageId,
        dirtyState,
      );

      if (
        clearedDirty &&
        (await this.collabHistory.hasBufferedEvents(pageId))
      ) {
        await this.collabHistory.scheduleEventFlush(pageId);
      }

      return;
    }

    const actorId =
      bufferedEvents[bufferedEvents.length - 1]?.actorId ??
      page.lastUpdatedById ??
      page.creatorId;

    const persisted = await this.pageHistoryRepo.insertPageHistoryIdempotent({
      pageId: page.id,
      sourceBatchId: batchId,
      slugId: page.slugId,
      title: page.title,
      content: page.content,
      icon: page.icon,
      coverPhoto: page.coverPhoto,
      lastUpdatedById: actorId,
      contributorIds: undefined,
      spaceId: page.spaceId,
      workspaceId: page.workspaceId,
      changeType: 'page.events.combined',
      changeData: this.buildCombinedChangeData(bufferedEvents) as never,
    });

    // Keep the claimed Redis batch and its stable batchId intact until the
    // database write is known to have succeeded. A connection error can be
    // ambiguous after PostgreSQL commits; the retry must therefore reuse the
    // same sourceBatchId and hit the unique constraint instead of requeueing
    // the events under a new identity.
    await this.acknowledgeEventBatch(pageId, batchId);
    const clearedDirty = await this.clearProcessedEventDirtyState(
      pageId,
      dirtyState,
    );

    if (clearedDirty && (await this.collabHistory.hasBufferedEvents(pageId))) {
      await this.collabHistory.scheduleEventFlush(pageId);
    }

    this.logger.debug(
      `Combined event history ${persisted.inserted ? 'created' : 'recovered'} for page: ${pageId} (${bufferedEvents.length} events)`,
    );
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.historyQueue.add(
        QueueJob.PAGE_HISTORY_RETENTION_CLEANUP,
        {},
        {
          jobId: 'page-history-retention-cleanup',
          repeat: { every: 60 * 60 * 1000 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: 10,
        },
      ),
      this.historyQueue.add(
        QueueJob.PAGE_HISTORY_EVENT_RECONCILE,
        {},
        {
          jobId: 'page-history-event-reconcile',
          repeat: { every: 60_000 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: 10,
        },
      ),
    ]);
  }

  private async reconcileRecoverableHistory(): Promise<void> {
    await this.collabHistory.recoverLegacyUnindexedHistory(
      PAGE_HISTORY_EVENT_RECONCILE_BATCH_SIZE,
    );

    const dirtyStates = await this.collabHistory.listRecoverableDirtyStates(
      PAGE_HISTORY_EVENT_RECONCILE_BATCH_SIZE,
    );
    for (const dirtyState of dirtyStates) {
      try {
        if (dirtyState.kind === 'content') {
          await this.collabHistory.scheduleContentHistoryFlush(
            dirtyState.pageId,
          );
        } else {
          await this.collabHistory.scheduleEventFlush(dirtyState.pageId);
        }
      } catch (error) {
        this.logger.error({
          event: 'history_dirty_state_reconcile_schedule_failed',
          historyKind: dirtyState.kind,
          pageId: dirtyState.pageId,
          error: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }

    const batches = await this.collabHistory.listRecoverableEventBatches(
      PAGE_HISTORY_EVENT_RECONCILE_BATCH_SIZE,
    );
    for (const batch of batches) {
      try {
        await this.collabHistory.scheduleEventBatchRecovery(
          batch.pageId,
          batch.batchId,
          0,
        );
        await this.collabHistory.deferEventBatchRecovery(
          batch.pageId,
          batch.batchId,
        );
      } catch (error) {
        this.logger.error({
          event: 'history_event_batch_reconcile_schedule_failed',
          pageId: batch.pageId,
          error: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }
  }

  private async cleanupExpiredPageHistory(): Promise<void> {
    for (
      let batch = 0;
      batch < PAGE_HISTORY_RETENTION_MAX_BATCHES_PER_RUN;
      batch += 1
    ) {
      const deleted = await this.pageHistoryRepo.deleteExpiredHistoryBatch(
        PAGE_HISTORY_RETENTION_BATCH_SIZE,
      );
      if (deleted < PAGE_HISTORY_RETENTION_BATCH_SIZE) return;
    }
  }

  private async acknowledgeEventBatch(
    pageId: string,
    batchId: string,
  ): Promise<void> {
    const acknowledged =
      await this.collabHistory.acknowledgeBufferedProcessingEvents(
        pageId,
        batchId,
      );

    if (!acknowledged) {
      throw new Error('Page history event batch ownership changed');
    }
  }

  private async clearProcessedContentDirtyState(
    pageId: string,
    dirtyState: IHistoryDirtyState | null,
  ): Promise<boolean> {
    if (!dirtyState) {
      return true;
    }

    const cleared = await this.collabHistory.clearContentDirtyState(
      pageId,
      dirtyState.lastDirtyAt,
    );

    if (!cleared) {
      await this.collabHistory.scheduleContentHistoryFlush(pageId);
    }

    return cleared;
  }

  private async clearProcessedEventDirtyState(
    pageId: string,
    dirtyState: IHistoryDirtyState | null,
  ): Promise<boolean> {
    if (!dirtyState) {
      return true;
    }

    const cleared = await this.collabHistory.clearEventDirtyState(
      pageId,
      dirtyState.lastDirtyAt,
    );

    if (!cleared) {
      await this.collabHistory.scheduleEventFlush(pageId);
    }

    return cleared;
  }

  private buildCombinedChangeData(
    events: IBufferedPageHistoryEvent[],
  ): Record<string, unknown> {
    const databaseId = this.extractCombinedDatabaseId(events);

    return {
      eventVersion: PAGE_HISTORY_EVENT_VERSION,
      ...(databaseId ? { databaseId } : {}),
      events: events.map((event) => ({
        changeType: event.changeType,
        changeData: event.changeData,
        actorId: event.actorId ?? null,
        createdAt: event.createdAt,
      })),
    };
  }

  private extractCombinedDatabaseId(
    events: IBufferedPageHistoryEvent[],
  ): string | null {
    const databaseIds = events
      .map((event) => {
        const value = event.changeData?.['databaseId'];
        return typeof value === 'string' ? value : null;
      })
      .filter((value): value is string => Boolean(value));

    const uniqueDatabaseIds = [...new Set(databaseIds)];
    if (uniqueDatabaseIds.length === 1) {
      return uniqueDatabaseIds[0];
    }

    return null;
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent('failed')
  async onError(job: Job): Promise<void> {
    this.logger.error({
      event: 'history_queue_job_failed',
      jobName: job.name,
    });

    if (
      job.name !== QueueJob.PAGE_HISTORY_EVENT_FLUSH ||
      !this.isFinalAttempt(job)
    ) {
      return;
    }

    const data = job.data as IPageHistoryEventFlushJob;
    if (!data?.pageId) return;

    try {
      const currentBatchId = await this.collabHistory.getProcessingEventBatchId(
        data.pageId,
      );
      const stableBatchId = data.batchId ?? currentBatchId;
      if (!stableBatchId || currentBatchId !== stableBatchId) {
        return;
      }

      await this.collabHistory.scheduleEventBatchRecovery(
        data.pageId,
        stableBatchId,
      );
    } catch (error) {
      this.logger.error({
        event: 'history_event_batch_recovery_schedule_failed',
        pageId: data.pageId,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  private isFinalAttempt(job: Job): boolean {
    const attempts = Math.max(1, Number(job.opts?.attempts ?? 1));
    return job.attemptsMade >= attempts;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
