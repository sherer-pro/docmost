import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { v7 as uuid7 } from 'uuid';
import type { User } from '@docmost/db/types/entity.types';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import type { PageTemplateSyncOutboxHandler } from '../../../integrations/queue/outbox/queue-outbox.types';
import { PageTemplateOperationService } from './page-template-operation.service';
import { PageTemplateSyncService } from './page-template-sync.service';

const SYNC_RUN_LEASE_MS = 5 * 60 * 1000;
const SYNC_RESUME_INTERVAL_MS = 15_000;
const SYNC_ITEM_BATCH_SIZE = 100;

@Injectable()
export class PageTemplateRuntimeService
  implements OnModuleInit, OnModuleDestroy, PageTemplateSyncOutboxHandler
{
  private readonly logger = new Logger(PageTemplateRuntimeService.name);
  private readonly activeSyncRuns = new Set<string>();
  private syncResumeTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly templateSync: PageTemplateSyncService,
    private readonly operations: PageTemplateOperationService,
  ) {}

  async onModuleInit(): Promise<void> {
    void this.resumePendingSyncRuns();
    this.syncResumeTimer = setInterval(
      () => void this.resumePendingSyncRuns(),
      SYNC_RESUME_INTERVAL_MS,
    );
    this.syncResumeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.syncResumeTimer) clearInterval(this.syncResumeTimer);
  }

  async processSyncRunFromOutbox(runId: string): Promise<void> {
    await this.processSyncRun(runId);
  }

  private async resumePendingSyncRuns(): Promise<void> {
    const runs = await this.db
      .selectFrom('pageTemplateSyncRuns')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('status', '=', 'pending'),
          eb.and([
            eb('status', '=', 'running'),
            eb.or([
              eb('leaseExpiresAt', 'is', null),
              eb('leaseExpiresAt', '<=', new Date()),
            ]),
          ]),
        ]),
      )
      .orderBy('createdAt', 'asc')
      .limit(10)
      .execute();
    for (const run of runs) void this.processSyncRun(run.id);
  }

  private async processSyncRun(runId: string): Promise<void> {
    if (this.activeSyncRuns.has(runId)) return;
    this.activeSyncRuns.add(runId);
    const leaseToken = uuid7();
    try {
      const claimed = await this.db
        .updateTable('pageTemplateSyncRuns')
        .set({
          status: 'running',
          leaseToken,
          leaseExpiresAt: new Date(Date.now() + SYNC_RUN_LEASE_MS),
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id', '=', runId)
        .where((eb) =>
          eb.or([
            eb('status', '=', 'pending'),
            eb.and([
              eb('status', '=', 'running'),
              eb.or([
                eb('leaseExpiresAt', 'is', null),
                eb('leaseExpiresAt', '<=', new Date()),
              ]),
            ]),
          ]),
        )
        .returningAll()
        .executeTakeFirst();
      if (!claimed) return;

      await this.db
        .updateTable('pageTemplateSyncItems')
        .set({ status: 'pending', updatedAt: new Date() })
        .where('runId', '=', runId)
        .where('status', '=', 'running')
        .execute();
      const [revision, requestedActor] = await Promise.all([
        this.db
          .selectFrom('pageTemplateRevisions')
          .selectAll()
          .where('id', '=', claimed.revisionId)
          .executeTakeFirst(),
        claimed.requestedById
          ? this.db
              .selectFrom('users')
              .selectAll()
              .where('id', '=', claimed.requestedById)
              .where('workspaceId', '=', claimed.workspaceId)
              .executeTakeFirst()
          : null,
      ]);
      let actor = requestedActor;
      if (!actor && revision) {
        const template = await this.pageRepo.findById(claimed.templatePageId);
        if (template) {
          actor =
            (await this.db
              .selectFrom('users')
              .selectAll()
              .where('id', '=', template.creatorId)
              .where('workspaceId', '=', template.workspaceId)
              .where('deletedAt', 'is', null)
              .where('deactivatedAt', 'is', null)
              .executeTakeFirst()) ??
            (await this.db
              .selectFrom('users')
              .selectAll()
              .where('workspaceId', '=', template.workspaceId)
              .where('deletedAt', 'is', null)
              .where('deactivatedAt', 'is', null)
              .orderBy('createdAt', 'asc')
              .executeTakeFirst());
        }
      }
      if (!revision || !actor) {
        await this.templateSync.finishSyncRun(
          runId,
          leaseToken,
          'failed',
          'page_template_sync_actor_missing',
        );
        return;
      }

      let lastItemId: string | null = null;
      while (true) {
        let itemQuery = this.db
          .selectFrom('pageTemplateSyncItems')
          .selectAll()
          .where('runId', '=', runId)
          .where('status', '=', 'pending');
        if (lastItemId) {
          itemQuery = itemQuery.where('id', '>', lastItemId);
        }
        const items = await itemQuery
          .orderBy('id', 'asc')
          .limit(SYNC_ITEM_BATCH_SIZE)
          .execute();
        if (items.length === 0) break;
        for (const item of items) {
          const renewed = await this.db
            .updateTable('pageTemplateSyncRuns')
            .set({
              leaseExpiresAt: new Date(Date.now() + SYNC_RUN_LEASE_MS),
              updatedAt: new Date(),
            })
            .where('id', '=', runId)
            .where('leaseToken', '=', leaseToken)
            .returning('id')
            .executeTakeFirst();
          if (!renewed) return;
          await this.templateSync.processSyncItem(
            claimed,
            revision,
            item,
            actor as User,
          );
          const progressUpdated =
            await this.templateSync.updateSyncRunProgress(runId, leaseToken);
          if (!progressUpdated) return;
          lastItemId = item.id;
        }
        if (items.length < SYNC_ITEM_BATCH_SIZE) break;
      }
      await this.templateSync.recalculateSyncRun(runId, leaseToken);
    } catch (error) {
      this.logger.error(
        `Template synchronization run failed; runId=${runId}; code=${this.operations.errorCode(error)}`,
      );
      await this.templateSync.finishSyncRun(
        runId,
        leaseToken,
        'failed',
        this.operations.errorCode(error),
      );
    } finally {
      this.activeSyncRuns.delete(runId);
    }
  }
}
