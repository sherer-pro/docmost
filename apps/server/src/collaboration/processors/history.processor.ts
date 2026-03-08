import { Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
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
} from '../services/collab-history.service';
import { WatcherService } from '../../core/watcher/watcher.service';
import { PAGE_HISTORY_EVENT_VERSION } from '../../core/page/services/page-history-change.types';

type HistoryQueueJobData = IPageHistoryJob | IPageHistoryEventFlushJob;

@Processor(QueueName.HISTORY_QUEUE)
export class HistoryProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(HistoryProcessor.name);

  constructor(
    private readonly pageHistoryRepo: PageHistoryRepo,
    private readonly pageRepo: PageRepo,
    private readonly collabHistory: CollabHistoryService,
    private readonly watcherService: WatcherService,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<HistoryQueueJobData, void>): Promise<void> {
    if (job.name === QueueJob.PAGE_HISTORY) {
      await this.processPageContentHistory(job.data as IPageHistoryJob);
      return;
    }

    if (job.name === QueueJob.PAGE_HISTORY_EVENT_FLUSH) {
      await this.processBufferedEventHistory(job.data as IPageHistoryEventFlushJob);
    }
  }

  private async processPageContentHistory(data: IPageHistoryJob): Promise<void> {
    const { pageId } = data;

    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });

    if (!page) {
      this.logger.warn(`Page ${pageId} not found, skipping history`);
      await this.collabHistory.clearContributors(pageId);
      return;
    }

    const lastHistory = await this.pageHistoryRepo.findPageLastHistory(pageId, {
      includeContent: true,
    });

    if (lastHistory && isDeepStrictEqual(lastHistory.content, page.content)) {
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

      await this.pageHistoryRepo.saveHistory(page, { contributorIds });

      /**
       * Send the document-changed notification only after
       * a new page history record is actually created.
       *
       * This avoids notification spam for every intermediate
       * onStoreDocument/keyup event and reuses the existing logic
       * that compares content against the latest persisted revision.
       */
      if (page.lastUpdatedById) {
        await this.notificationQueue.add(QueueJob.PAGE_RECIPIENT_NOTIFICATION, {
          reason: 'document-changed',
          actorId: page.lastUpdatedById,
          pageId,
          spaceId: page.spaceId,
          workspaceId: page.workspaceId,
        } as IPageRecipientNotificationJob);
      }

      this.logger.debug(`History created for page: ${pageId}`);
    } catch (err) {
      await this.collabHistory.addContributors(pageId, contributorIds);
      throw err;
    }
  }

  private async processBufferedEventHistory(
    data: IPageHistoryEventFlushJob,
  ): Promise<void> {
    const { pageId } = data;
    const bufferedEvents = await this.collabHistory.takeBufferedEventsForProcessing(pageId);

    if (bufferedEvents.length === 0) {
      return;
    }

    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });

    if (!page) {
      this.logger.warn(`Page ${pageId} not found, skipping event history flush`);
      await this.collabHistory.clearBufferedProcessingEvents(pageId);

      if (await this.collabHistory.hasBufferedEvents(pageId)) {
        await this.collabHistory.scheduleEventFlush(pageId);
      }

      return;
    }

    const actorId =
      bufferedEvents[bufferedEvents.length - 1]?.actorId ??
      page.lastUpdatedById ??
      page.creatorId;

    try {
      await this.pageHistoryRepo.insertPageHistory({
        pageId: page.id,
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

      await this.collabHistory.clearBufferedProcessingEvents(pageId);

      if (await this.collabHistory.hasBufferedEvents(pageId)) {
        await this.collabHistory.scheduleEventFlush(pageId);
      }

      this.logger.debug(
        `Combined event history created for page: ${pageId} (${bufferedEvents.length} events)`,
      );
    } catch (err) {
      await this.collabHistory.requeueBufferedProcessingEvents(pageId);
      throw err;
    }
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
    const pageId = (job.data as { pageId?: string })?.pageId ?? 'unknown';
    this.logger.debug(`Processing ${job.name} for page: ${pageId}`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    const pageId = (job.data as { pageId?: string })?.pageId ?? 'unknown';
    this.logger.error(
      `Failed ${job.name} for page: ${pageId}. Reason: ${job.failedReason}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
