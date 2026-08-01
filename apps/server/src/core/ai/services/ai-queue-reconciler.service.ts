import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AiFileService } from './ai-file.service';
import { AiRunEventService } from './ai-run-event.service';
import { AiRunService } from './ai-run.service';
import { DatabaseReadinessService } from '@docmost/db/services/database-readiness.service';
import { AiOperationalMetricsService } from './ai-operational-metrics.service';
import { AiAuxRunService } from './ai-aux-run.service';
import { AiAuxRunExecutionService } from './ai-aux-run-execution.service';
import { AiRunStepService } from './ai-run-step.service';

const RECONCILE_INTERVAL_MS = 15_000;
const RUN_DELIVERY_DEADLINE_MS = 5 * 60 * 1000;
const RUN_STALE_HEARTBEAT_MS = 12 * 60 * 1000;

@Injectable()
export class AiQueueReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiQueueReconcilerService.name);
  private timer: NodeJS.Timeout | undefined;
  private reconciling = false;
  private destroyed = false;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly runs: AiRunService,
    private readonly files: AiFileService,
    private readonly events: AiRunEventService,
    private readonly databaseReadiness: DatabaseReadinessService,
    private readonly metrics: AiOperationalMetricsService,
    private readonly auxRuns: AiAuxRunService,
    private readonly auxExecution: AiAuxRunExecutionService,
    private readonly steps: AiRunStepService,
  ) {}

  onModuleInit(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(
      () => void this.reconcile(),
      RECONCILE_INTERVAL_MS,
    );
    this.timer.unref();
    void this.reconcile();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async reconcile(): Promise<void> {
    if (this.reconciling || this.destroyed) return;
    this.reconciling = true;
    try {
      await this.databaseReadiness.waitUntilReady();
      if (this.destroyed) return;
      await this.steps.expirePending(100);
      await this.steps.recoverApproved(100);
      await this.reconcileRuns();
      await this.reconcileAuxRuns();
      const staleFileIds = await this.files.recoverStaleExtractions();
      const pendingFileIds = await this.files.pendingExtractionIds(100);
      for (const fileId of new Set([...staleFileIds, ...pendingFileIds])) {
        await this.files.enqueueExtraction(fileId);
      }
      await this.files.cleanupDeletedFiles(100);
      await this.auxRuns.cleanupExpired(100);
    } catch {
      this.logger.warn('AI queue reconciliation failed');
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileAuxRuns(): Promise<void> {
    const queued = await this.db
      .selectFrom('aiAuxRuns')
      .selectAll()
      .where('status', '=', 'queued')
      .orderBy('createdAt', 'asc')
      .limit(100)
      .execute();
    for (const run of queued) {
      const enqueued = await this.auxRuns.enqueue(run);
      if (
        !enqueued &&
        Date.now() - run.createdAt.getTime() >= RUN_DELIVERY_DEADLINE_MS
      ) {
        await this.auxExecution.recover(run.id, 'queue_unavailable');
      }
    }

    const staleBefore = new Date(Date.now() - RUN_STALE_HEARTBEAT_MS);
    const stale = await this.db
      .selectFrom('aiAuxRuns')
      .select('id')
      .where('status', '=', 'running')
      .where('heartbeatAt', '<', staleBefore)
      .limit(100)
      .execute();
    for (const run of stale) {
      await this.auxExecution.recover(run.id, 'worker_lost');
    }
  }

  private async reconcileRuns(): Promise<void> {
    const queued = await this.db
      .selectFrom('aiRuns')
      .selectAll()
      .where('status', '=', 'queued')
      .orderBy('createdAt', 'asc')
      .limit(100)
      .execute();
    for (const run of queued) {
      const enqueued = await this.runs.enqueue(run);
      if (enqueued && !run.enqueuedAt) {
        this.metrics.observeReconciledJob();
      }
      if (
        !enqueued &&
        Date.now() - run.createdAt.getTime() >= RUN_DELIVERY_DEADLINE_MS
      ) {
        await this.failRun(
          run.id,
          'queue_unavailable',
          'AI queue is unavailable',
        );
      }
    }

    const staleBefore = new Date(Date.now() - RUN_STALE_HEARTBEAT_MS);
    const stale = await this.db
      .selectFrom('aiRuns')
      .select('id')
      .where('status', '=', 'running')
      .where('heartbeatAt', '<', staleBefore)
      .limit(100)
      .execute();
    for (const run of stale) {
      await this.failRun(
        run.id,
        'worker_lost',
        'AI generation worker stopped responding',
      );
    }
  }

  private async failRun(
    runId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const now = new Date();
    const failed = await this.db.transaction().execute(async (trx) => {
      const message = await trx
        .selectFrom('aiRuns as r')
        .innerJoin('aiMessages as m', 'm.id', 'r.assistantMessageId')
        .select(['m.content'])
        .where('r.id', '=', runId)
        .executeTakeFirst();
      const run = await trx
        .updateTable('aiRuns')
        .set({
          status: 'failed',
          sequence: sql`sequence + 1`,
          completedAt: now,
          finishReason: 'error',
          errorCode,
          errorMessage,
          responseSnapshot: message?.content ?? '',
          updatedAt: now,
        })
        .where('id', '=', runId)
        .where('status', 'in', ['queued', 'running'])
        .where('cancelRequestedAt', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!run) return undefined;
      await trx
        .updateTable('aiMessages')
        .set({
          status: 'failed',
          errorCode,
          errorMessage,
          updatedAt: now,
        })
        .where('id', '=', run.assistantMessageId)
        .where('currentRunId', '=', run.id)
        .execute();
      return run;
    });
    if (failed) {
      this.events.emitStatus(failed, failed.sequence, 'failed', {
        errorCode,
        errorMessage,
      });
    }
  }
}
