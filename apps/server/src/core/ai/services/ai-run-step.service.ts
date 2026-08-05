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
import type { JsonObject, JsonValue } from '../../../database/types/db';
import { approvedStepRecoveryAction } from './ai-run-step-recovery';
import { AiBuiltinToolPolicyService } from '../tools/ai-builtin-tool-policy.service';

const APPROVED_STEP_RECOVERY_DELAY_MS = 30_000;

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
    private readonly builtinToolPolicy: AiBuiltinToolPolicyService,
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
    const resumed = await this.recoverApprovedStep(run.id, claimed.id);
    if (!resumed) {
      throw new ConflictException('The approved write was already resumed');
    }
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

  async recoverApproved(limit = 100): Promise<number> {
    const candidates = await this.db
      .selectFrom('aiRunSteps as step')
      .innerJoin('aiRuns as run', 'run.id', 'step.runId')
      .select(['step.id as id', 'step.runId as runId'])
      .where('step.status', '=', 'approved')
      .where('run.status', '=', 'awaiting_approval')
      .where(
        'step.updatedAt',
        '<=',
        new Date(Date.now() - APPROVED_STEP_RECOVERY_DELAY_MS),
      )
      .orderBy('step.updatedAt', 'asc')
      .limit(limit)
      .execute();
    let recoveredCount = 0;
    for (const candidate of candidates) {
      if (await this.recoverApprovedStep(candidate.runId, candidate.id)) {
        recoveredCount += 1;
      }
    }
    return recoveredCount;
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
    const resumed = await this.db.transaction().execute(async (trx) => {
      const step = await trx
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
      if (!step) return undefined;
      const run = await this.resumeRun(trx, params.run.id, now);
      return { run, step };
    });
    if (!resumed) {
      throw new ConflictException('The write proposal was already decided');
    }
    await this.publishResume(resumed.run, resumed.step);
    return resumed;
  }

  private async recoverApprovedStep(runId: string, stepId: string) {
    const outcome = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`ai-run-step:${stepId}`}, 0))`.execute(
        trx,
      );
      const step = await trx
        .selectFrom('aiRunSteps')
        .selectAll()
        .where('id', '=', stepId)
        .where('runId', '=', runId)
        .where('status', '=', 'approved')
        .executeTakeFirst();
      const run = await trx
        .selectFrom('aiRuns')
        .selectAll()
        .where('id', '=', runId)
        .where('status', '=', 'awaiting_approval')
        .executeTakeFirst();
      if (!step || !run) return undefined;

      const now = new Date();
      let applied = false;
      let result: JsonValue;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;
      try {
        const [user, workspace] = await Promise.all([
          trx
            .selectFrom('users')
            .selectAll()
            .where('id', '=', run.userId)
            .where('workspaceId', '=', run.workspaceId)
            .where('deletedAt', 'is', null)
            .where('deactivatedAt', 'is', null)
            .executeTakeFirst(),
          trx
            .selectFrom('workspaces')
            .selectAll()
            .where('id', '=', run.workspaceId)
            .executeTakeFirst(),
        ]);
        if (!user || !workspace || step.decidedById !== run.userId) {
          throw new Error('agent_write_not_allowed');
        }
        const definition = await this.builtinToolPolicy.assertRunToolAllowed(
          run,
          step.toolName,
        );
        if (
          definition.writeClass !== 'write' ||
          definition.approvalMode !== 'current_page_hash'
        ) {
          throw new Error('agent_write_not_allowed');
        }
        if (
          step.targetPageId !== run.pageId ||
          step.targetPageId !==
            this.requireString(
              step.arguments as Record<string, unknown>,
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
          step.toolName,
          step.arguments as Record<string, unknown>,
        );
        assertSafeAiPageOperation(operation);
        const expectedAfterHash = this.expectedAfterHash(step.result);
        const currentContentHash = (await this.collaboration.handleYjsEvent(
          'getAiPageContentHash',
          `page.${run.pageId}`,
          { user },
        )) as string;
        const recoveryAction = approvedStepRecoveryAction(
          step.baseContentHash,
          expectedAfterHash,
          currentContentHash,
        );
        if (recoveryAction === 'stale') {
          throw new Error('agent_write_stale');
        }
        const appliedResult =
          recoveryAction === 'complete'
            ? {
                beforeHash: step.baseContentHash,
                afterHash: expectedAfterHash,
                recovered: true,
              }
            : ((await this.collaboration.handleYjsEvent(
                'applyAiPageOperation',
                `page.${run.pageId}`,
                {
                  operation,
                  baseContentHash: step.baseContentHash!,
                  expectedAfterHash: expectedAfterHash!,
                  user,
                },
              )) as Record<string, unknown>);
        applied = true;
        result = {
          ok: true,
          applied: true,
          ...appliedResult,
        };
      } catch (error) {
        const responseCode = (error as any)?.response?.code;
        errorCode =
          responseCode === 'agent_tool_policy_changed'
            ? 'agent_tool_policy_changed'
            : (error as Error)?.message === 'agent_write_stale'
              ? 'agent_write_stale'
              : 'agent_write_not_allowed';
        errorMessage =
          errorCode === 'agent_tool_policy_changed'
            ? 'The built-in tool policy changed during this run'
            : errorCode === 'agent_write_stale'
              ? 'The page changed after the proposal was created'
              : 'The approved write could not be applied';
        result = { ok: false, applied: false, error: errorMessage };
      }

      const updatedStep = await trx
        .updateTable('aiRunSteps')
        .set({
          status: applied ? 'approved' : 'failed',
          result: this.mergeStepResult(step.result, result),
          errorCode,
          errorMessage,
          updatedAt: now,
        })
        .where('id', '=', step.id)
        .where('runId', '=', run.id)
        .where('status', '=', 'approved')
        .returningAll()
        .executeTakeFirstOrThrow();
      const policyChanged = errorCode === 'agent_tool_policy_changed';
      const updatedRun = policyChanged
        ? await this.failRunForPolicyChange(trx, run.id, now, errorMessage!)
        : await this.resumeRun(trx, run.id, now);
      return {
        run: updatedRun,
        step: updatedStep,
        applied,
        policyChanged,
      };
    });
    if (!outcome) return undefined;

    if (outcome.applied) {
      try {
        await this.history.enqueuePageEvent({
          pageId: outcome.run.pageId,
          changeType: 'page.ai-agent.changed',
          changeData: {
            runId: outcome.run.id,
            stepId: outcome.step.id,
            toolName: outcome.step.toolName,
          },
          actorId: outcome.step.decidedById,
        });
      } catch (error) {
        this.logger.error(
          `Failed to record AI agent page history for step ${outcome.step.id}`,
          (error as Error)?.stack,
        );
      }
    }
    if (outcome.policyChanged) {
      this.events.emitStep(outcome.run, outcome.step);
      this.events.emitStatus(outcome.run, outcome.run.sequence, 'failed', {
        errorCode: 'agent_tool_policy_changed',
        errorMessage: outcome.run.errorMessage,
      });
    } else {
      await this.publishResume(outcome.run, outcome.step);
    }
    return outcome;
  }

  private async failRunForPolicyChange(
    trx: any,
    runId: string,
    now: Date,
    errorMessage: string,
  ) {
    return trx
      .updateTable('aiRuns')
      .set({
        status: 'failed',
        errorCode: 'agent_tool_policy_changed',
        errorMessage,
        finishReason: 'error',
        completedAt: now,
        sequence: sql`sequence + 1`,
        heartbeatAt: null,
        updatedAt: now,
      })
      .where('id', '=', runId)
      .where('status', '=', 'awaiting_approval')
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async resumeRun(trx: any, runId: string, now: Date) {
    return trx
      .updateTable('aiRuns')
      .set({
        status: 'queued',
        sequence: sql`sequence + 1`,
        heartbeatAt: null,
        enqueuedAt: null,
        updatedAt: now,
      })
      .where('id', '=', runId)
      .where('status', '=', 'awaiting_approval')
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async publishResume(run: any, step: any): Promise<void> {
    this.events.emitStep(run, step);
    this.events.emitStatus(run, run.sequence, 'queued');
    await this.runs.enqueue(run);
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

  private expectedAfterHash(result: JsonValue | null): string | null {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return null;
    }
    const value = result.expectedAfterHash;
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      ? value
      : null;
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
      ...(existingRecord.expectedAfterHash !== undefined
        ? { expectedAfterHash: existingRecord.expectedAfterHash }
        : {}),
      ...nextRecord,
    };
  }
}
