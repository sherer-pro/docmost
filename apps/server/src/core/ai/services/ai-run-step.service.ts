import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AiRunStep as AiRunStepEntity,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import { AiRunService } from './ai-run.service';
import { AiRunEventService } from './ai-run-event.service';
import { PageAccessService } from '../../page-access/page-access.service';
import { PageService } from '../../page/services/page.service';
import { PageHistoryRecorderService } from '../../page/services/page-history-recorder.service';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { sql } from 'kysely';
import {
  AiPageOperation,
  assertSafeAiPageOperation,
} from '../../../common/helpers/prosemirror/ai-page-operation';
import { JsonObject, JsonValue } from '../../../database/types/db';

@Injectable()
export class AiRunStepService {
  private readonly logger = new Logger(AiRunStepService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly runs: AiRunService,
    private readonly events: AiRunEventService,
    private readonly pages: PageService,
    private readonly pageAccess: PageAccessService,
    private readonly history: PageHistoryRecorderService,
    private readonly collaboration: CollaborationGateway,
  ) {}

  async approve(
    runId: string,
    stepId: string,
    user: User,
    workspace: Workspace,
  ) {
    const run = await this.runs.getOwnedRun(runId, user, workspace);
    const step = await this.getPendingStep(run.id, stepId);
    const now = new Date();
    if (!step.expiresAt || step.expiresAt <= now) {
      const resumed = await this.decideAndResume({
        run,
        stepId,
        status: 'expired',
        user,
        result: {
          ok: false,
          error: 'The write proposal expired before approval',
        },
        existingResult: step.result,
        errorCode: 'agent_write_expired',
        errorMessage: 'The write proposal expired before approval',
      });
      throw new ConflictException({
        code: 'agent_write_expired',
        message: 'The write proposal expired',
        run: this.runs.toRun(resumed.run),
      });
    }

    const claimed = await this.runs.withProviderAdmission<
      AiRunStepEntity | undefined
    >(run, (trx) =>
      trx
        .updateTable('aiRunSteps')
        .set({
          status: 'approved',
          decidedAt: now,
          decidedById: user.id,
          updatedAt: now,
        })
        .where('id', '=', step.id)
        .where('runId', '=', run.id)
        .where('status', '=', 'pending_approval')
        .returningAll()
        .executeTakeFirst(),
    );
    if (!claimed) {
      throw new ConflictException('The write proposal was already decided');
    }

    let applied: Record<string, unknown> | undefined;
    try {
      if (
        claimed.targetPageId !== run.pageId ||
        claimed.targetPageId !==
          this.requireString(
            claimed.arguments as Record<string, unknown>,
            'pageId',
          )
      ) {
        throw new Error('agent_write_not_allowed');
      }
      const page = await this.pages.findById(run.pageId, true);
      if (
        !page ||
        page.deletedAt ||
        page.workspaceId !== workspace.id ||
        page.spaceId !== run.spaceId
      ) {
        throw new Error('page_unavailable');
      }
      await this.pageAccess.assertCanWritePage(page, user);
      const operation = this.toOperation(
        claimed.toolName,
        claimed.arguments as Record<string, unknown>,
      );
      assertSafeAiPageOperation(operation);
      applied = (await this.collaboration.handleYjsEvent(
        'applyAiPageOperation',
        `page.${run.pageId}`,
        {
          operation,
          baseContentHash: claimed.baseContentHash!,
          user,
        },
      )) as Record<string, unknown> | undefined;
    } catch (error) {
      const code =
        (error as Error)?.message === 'agent_write_stale'
          ? 'agent_write_stale'
          : 'agent_write_not_allowed';
      const message =
        code === 'agent_write_stale'
          ? 'The page changed after the proposal was created'
          : 'The approved write could not be applied';
      const resumed = await this.finishClaimAndResume({
        run,
        stepId: claimed.id,
        status: 'failed',
        result: { ok: false, applied: false, error: message },
        existingResult: claimed.result,
        errorCode: code,
        errorMessage: message,
      });
      return {
        run: this.runs.toRun(resumed.run),
        step: resumed.step,
      };
    }

    try {
      await this.history.enqueuePageEvent({
        pageId: run.pageId,
        changeType: 'page.ai-agent.changed',
        changeData: {
          runId: run.id,
          stepId: claimed.id,
          toolName: claimed.toolName,
        },
        actorId: user.id,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record AI agent page history for step ${claimed.id}`,
        (error as Error)?.stack,
      );
    }

    const resumed = await this.finishClaimAndResume({
      run,
      stepId: claimed.id,
      status: 'approved',
      result: {
        ok: true,
        applied: true,
        ...(applied ?? {}),
      },
      existingResult: claimed.result,
    });
    return {
      run: this.runs.toRun(resumed.run),
      step: resumed.step,
    };
  }

  async reject(
    runId: string,
    stepId: string,
    user: User,
    workspace: Workspace,
  ) {
    const run = await this.runs.getOwnedRun(runId, user, workspace);
    const step = await this.getPendingStep(run.id, stepId);
    const resumed = await this.decideAndResume({
      run,
      stepId,
      status: 'rejected',
      user,
      result: {
        ok: false,
        applied: false,
        error: 'The initiating user rejected the write proposal',
      },
      existingResult: step.result,
      errorCode: 'agent_write_rejected',
      errorMessage: 'The initiating user rejected the write proposal',
    });
    return {
      run: this.runs.toRun(resumed.run),
      step: resumed.step,
    };
  }

  async expirePending(limit = 100): Promise<number> {
    const now = new Date();
    const candidates = await this.db
      .selectFrom('aiRunSteps')
      .select(['id', 'runId', 'result'])
      .where('status', '=', 'pending_approval')
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt', 'asc')
      .limit(limit)
      .execute();
    let expiredCount = 0;

    for (const candidate of candidates) {
      const expired = await this.db.transaction().execute(async (trx) => {
        const step = await trx
          .updateTable('aiRunSteps')
          .set({
            status: 'expired',
            result: this.mergeStepResult(candidate.result, {
              ok: false,
              applied: false,
              error: 'The write proposal expired before approval',
            }),
            errorCode: 'agent_write_expired',
            errorMessage: 'The write proposal expired before approval',
            decidedAt: now,
            decidedById: null,
            updatedAt: now,
          })
          .where('id', '=', candidate.id)
          .where('runId', '=', candidate.runId)
          .where('status', '=', 'pending_approval')
          .returningAll()
          .executeTakeFirst();
        if (!step) return undefined;

        const run = await trx
          .updateTable('aiRuns')
          .set({
            status: 'queued',
            sequence: sql`sequence + 1`,
            heartbeatAt: null,
            enqueuedAt: null,
            updatedAt: now,
          })
          .where('id', '=', candidate.runId)
          .where('status', '=', 'awaiting_approval')
          .returningAll()
          .executeTakeFirst();
        return { run, step };
      });
      if (!expired) continue;
      expiredCount += 1;
      if (!expired.run) continue;
      this.events.emitStep(expired.run, expired.step);
      this.events.emitStatus(expired.run, expired.run.sequence, 'queued');
      await this.runs.enqueue(expired.run);
    }

    return expiredCount;
  }

  private async getPendingStep(runId: string, stepId: string) {
    const step = await this.db
      .selectFrom('aiRunSteps')
      .selectAll()
      .where('id', '=', stepId)
      .where('runId', '=', runId)
      .executeTakeFirst();
    if (!step) {
      throw new NotFoundException('AI run step not found');
    }
    if (step.status !== 'pending_approval') {
      throw new ConflictException('The write proposal was already decided');
    }
    return step;
  }

  private async decideAndResume(params: {
    run: any;
    stepId: string;
    status: 'rejected' | 'expired';
    user: User;
    result: JsonValue;
    existingResult: JsonValue | null;
    errorCode: string;
    errorMessage: string;
  }) {
    const now = new Date();
    const step = await this.db
      .updateTable('aiRunSteps')
      .set({
        status: params.status,
        result: this.mergeStepResult(params.existingResult, params.result),
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        decidedAt: now,
        decidedById: params.user.id,
        updatedAt: now,
      })
      .where('id', '=', params.stepId)
      .where('runId', '=', params.run.id)
      .where('status', '=', 'pending_approval')
      .returningAll()
      .executeTakeFirst();
    if (!step) {
      throw new ConflictException('The write proposal was already decided');
    }
    return this.resume(params.run, step);
  }

  private async finishClaimAndResume(params: {
    run: any;
    stepId: string;
    status: 'approved' | 'failed';
    result: JsonValue;
    existingResult: JsonValue | null;
    errorCode?: string;
    errorMessage?: string;
  }) {
    const step = await this.db
      .updateTable('aiRunSteps')
      .set({
        status: params.status,
        result: this.mergeStepResult(params.existingResult, params.result),
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        updatedAt: new Date(),
      })
      .where('id', '=', params.stepId)
      .where('runId', '=', params.run.id)
      .where('status', '=', 'approved')
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.resume(params.run, step);
  }

  private async resume(run: any, step: any) {
    const updatedRun = await this.db
      .updateTable('aiRuns')
      .set({
        status: 'queued',
        sequence: sql`sequence + 1`,
        heartbeatAt: null,
        enqueuedAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', run.id)
      .where('status', '=', 'awaiting_approval')
      .returningAll()
      .executeTakeFirstOrThrow();
    this.events.emitStep(updatedRun, step);
    this.events.emitStatus(updatedRun, updatedRun.sequence, 'queued');
    await this.runs.enqueue(updatedRun);
    return { run: updatedRun, step };
  }

  private toOperation(
    toolName: string,
    args: Record<string, unknown>,
  ): AiPageOperation {
    switch (toolName) {
      case 'editPageText':
        return {
          kind: 'editPageText',
          nodeId: this.requireString(args, 'nodeId'),
          oldText: this.requireString(args, 'oldText'),
          newText: this.requireString(args, 'newText', true),
        };
      case 'patchNode':
        return {
          kind: 'patchNode',
          nodeId: this.requireString(args, 'nodeId'),
          node: this.requireObject(args, 'node'),
        };
      case 'insertNode':
        return {
          kind: 'insertNode',
          anchorNodeId: this.requireString(args, 'anchorNodeId'),
          position:
            args.position === 'before' || args.position === 'after'
              ? args.position
              : (() => {
                  throw new Error('agent_write_not_allowed');
                })(),
          node: this.requireObject(args, 'node'),
        };
      case 'deleteNode':
        return {
          kind: 'deleteNode',
          nodeId: this.requireString(args, 'nodeId'),
        };
      default:
        throw new Error('agent_write_not_allowed');
    }
  }

  private requireString(
    args: Record<string, unknown>,
    key: string,
    allowEmpty = false,
  ): string {
    const value = args[key];
    if (
      typeof value !== 'string' ||
      (!allowEmpty && value.trim().length === 0)
    ) {
      throw new Error('agent_write_not_allowed');
    }
    return value;
  }

  private requireObject(
    args: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> {
    const value = args[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('agent_write_not_allowed');
    }
    return value as Record<string, unknown>;
  }

  private mergeStepResult(
    existing: JsonValue | null | undefined,
    next: JsonValue,
  ): JsonObject {
    const existingRecord =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? existing
        : {};
    const nextRecord =
      next && typeof next === 'object' && !Array.isArray(next)
        ? next
        : { value: next };
    return {
      ...(existingRecord.approvalPreview !== undefined
        ? { approvalPreview: existingRecord.approvalPreview }
        : {}),
      ...nextRecord,
    };
  }
}
