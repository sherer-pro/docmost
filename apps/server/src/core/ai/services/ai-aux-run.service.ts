import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { AiEditorActionRun } from '@docmost/api-contract';
import {
  AiAuxRun,
  AiRun,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { CreateAiEditorActionDto } from '../dto/ai.dto';
import { AiConfigService } from './ai-config.service';
import { AiConversationService } from './ai-conversation.service';
import { AiAuxRunEventService } from './ai-aux-run-event.service';
import { AI_CONCURRENCY_LIMITS } from '../ai.constants';

@Injectable()
export class AiAuxRunService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.AI_CHAT_QUEUE)
    private readonly queue: Queue,
    private readonly configs: AiConfigService,
    private readonly conversations: AiConversationService,
    private readonly events: AiAuxRunEventService,
  ) {}

  async createEditorAction(
    dto: CreateAiEditorActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiEditorActionRun> {
    if (!dto.selection.text.trim() || dto.selection.to <= dto.selection.from) {
      throw new HttpException(
        {
          code: 'editor_selection_required',
          message: 'A non-empty editor selection is required',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const page = await this.conversations.assertWritablePage(
      dto.pageId,
      user,
      workspace.id,
    );
    const config = await this.configs.getRawConfig(page.spaceId, workspace.id);
    if (!config?.enabled || !config.baseUrl || !config.chatModel) {
      throw new ForbiddenException({
        code: 'ai_unavailable',
        message: 'AI is not available in this space',
      });
    }
    const fingerprint = this.fingerprint({
      pageId: page.id,
      commandId: dto.commandId,
      instruction: dto.instruction.trim(),
      selection: dto.selection,
      snapshotHash: dto.snapshotHash,
    });
    const existing = await this.findEditorAction(user.id, dto.clientRequestId);
    if (existing) {
      this.assertFingerprint(existing, fingerprint);
      return this.toEditorAction(existing);
    }

    const reservedTokens =
      Math.ceil((dto.instruction.length + dto.selection.text.length) / 4) +
      config.maxOutputTokens;
    const created = await this.db.transaction().execute(async (trx) => {
      await this.lockAdmission(trx, page.spaceId, user.id);
      const raced = await trx
        .selectFrom('aiAuxRuns')
        .selectAll()
        .where('kind', '=', 'editor_transform')
        .where('userId', '=', user.id)
        .where('clientRequestId', '=', dto.clientRequestId)
        .executeTakeFirst();
      if (raced) {
        this.assertFingerprint(raced, fingerprint);
        return raced;
      }
      await this.assertAdmission(
        trx,
        user.id,
        workspace.id,
        page.spaceId,
        config.dailyRequestLimitPerUser,
        Number(config.dailyTokenLimitPerSpace),
        reservedTokens,
      );
      return trx
        .insertInto('aiAuxRuns')
        .values({
          id: uuidv7(),
          kind: 'editor_transform',
          status: 'queued',
          workspaceId: workspace.id,
          spaceId: page.spaceId,
          userId: user.id,
          pageId: page.id,
          clientRequestId: dto.clientRequestId,
          requestFingerprint: fingerprint,
          commandId: dto.commandId,
          instruction: dto.instruction.trim(),
          selectionText: dto.selection.text,
          selectionFrom: dto.selection.from,
          selectionTo: dto.selection.to,
          snapshotHash: dto.snapshotHash,
          reservedTokens,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    await this.enqueue(created);
    return this.toEditorAction(created);
  }

  async getEditorAction(
    id: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiEditorActionRun> {
    return this.toEditorAction(
      await this.getOwnedEditorAction(id, user, workspace),
    );
  }

  async cancelEditorAction(
    id: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiEditorActionRun> {
    const owned = await this.getOwnedEditorAction(id, user, workspace);
    let terminal = false;
    const updated = await this.db.transaction().execute(async (trx) => {
      const run = await trx
        .selectFrom('aiAuxRuns')
        .selectAll()
        .where('id', '=', owned.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (this.isTerminal(run.status)) return run;
      const now = new Date();
      if (run.status === 'queued') {
        terminal = true;
        return trx
          .updateTable('aiAuxRuns')
          .set({
            status: 'cancelled',
            sequence: sql`sequence + 1`,
            cancelRequestedAt: now,
            completedAt: now,
            updatedAt: now,
          })
          .where('id', '=', run.id)
          .where('status', '=', 'queued')
          .returningAll()
          .executeTakeFirstOrThrow();
      }
      return trx
        .updateTable('aiAuxRuns')
        .set({
          cancelRequestedAt: run.cancelRequestedAt ?? now,
          updatedAt: now,
        })
        .where('id', '=', run.id)
        .where('status', '=', 'running')
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    if (terminal) {
      await this.queue
        .getJob(this.jobId(updated.id))
        .then((job) => job?.remove())
        .catch(() => undefined);
      this.events.emitEditorStatus(updated, 'cancelled');
    }
    return this.toEditorAction(updated);
  }

  async scheduleConversationTitle(
    trx: any,
    run: AiRun,
    userMessage: string,
    dailyTokenLimit: number,
  ): Promise<AiAuxRun | undefined> {
    if (run.trigger !== 'send' || run.attemptNo !== 1) return undefined;
    const priorCompleted = await trx
      .selectFrom('aiRuns')
      .select(({ fn }: any) => fn.countAll().as('count'))
      .where('conversationId', '=', run.conversationId)
      .where('status', '=', 'completed')
      .where('id', '!=', run.id)
      .executeTakeFirstOrThrow();
    if (Number(priorCompleted.count) > 0) return undefined;
    const conversation = await trx
      .selectFrom('aiConversations')
      .select(['id', 'title', 'titleSource'])
      .where('id', '=', run.conversationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!conversation || conversation.title || conversation.titleSource) {
      return undefined;
    }
    const sources = await trx
      .selectFrom('aiRunContextSources')
      .select(['sourceTitle', 'markdownSnapshot', 'origin'])
      .where('runId', '=', run.id)
      .orderBy('position', 'asc')
      .execute();
    const files = run.chatFileIds.length
      ? await trx
          .selectFrom('aiChatFiles')
          .select('name')
          .where('id', 'in', run.chatFileIds)
          .where('deletedAt', 'is', null)
          .execute()
      : [];
    const inputSnapshot = JSON.stringify({
      firstMessage: userMessage.slice(0, 4000),
      sources: sources.slice(0, 10).map((source: any) => ({
        title: source.sourceTitle,
        excerpt: source.markdownSnapshot.slice(0, 800),
        current: source.origin === 'current_document',
      })),
      files: files.map((file: any) => file.name).slice(0, 10),
    });
    await this.lockAdmission(trx, run.spaceId, run.userId);
    const reservedTokens = Math.ceil(inputSnapshot.length / 4) + 32;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const currentTokens =
      (await this.sumMainTokens(trx, run.workspaceId, run.spaceId, dayStart)) +
      (await this.sumAuxTokens(trx, run.workspaceId, run.spaceId, dayStart));
    const quotaUnavailable = currentTokens + reservedTokens > dailyTokenLimit;
    return trx
      .insertInto('aiAuxRuns')
      .values({
        id: uuidv7(),
        kind: 'conversation_title',
        status: 'queued',
        workspaceId: run.workspaceId,
        spaceId: run.spaceId,
        userId: run.userId,
        pageId: run.pageId,
        conversationId: run.conversationId,
        sourceRunId: run.id,
        requestFingerprint: this.fingerprint({
          kind: 'conversation_title',
          conversationId: run.conversationId,
        }),
        inputSnapshot,
        reservedTokens: quotaUnavailable ? 0 : reservedTokens,
        errorCode: quotaUnavailable ? 'ai_daily_token_limit' : null,
      })
      .onConflict((oc: any) =>
        oc
          .column('conversationId')
          .where('kind', '=', 'conversation_title')
          .doNothing(),
      )
      .returningAll()
      .executeTakeFirst();
  }

  async enqueue(run: AiAuxRun): Promise<boolean> {
    if (run.status !== 'queued') return false;
    try {
      const jobId = this.jobId(run.id);
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'failed' || state === 'completed') {
          await existing.remove();
        } else {
          return true;
        }
      }
      await this.queue.add(
        QueueJob.AI_AUX_RUN,
        { runId: run.id },
        {
          jobId,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
      await this.db
        .updateTable('aiAuxRuns')
        .set({ enqueuedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', run.id)
        .where('status', '=', 'queued')
        .execute();
      return true;
    } catch {
      return false;
    }
  }

  async cleanupExpired(limit = 100): Promise<number> {
    const rows = await this.db
      .selectFrom('aiAuxRuns')
      .select('id')
      .where('status', 'in', ['completed', 'failed', 'cancelled'])
      .where('expiresAt', '<=', new Date())
      .orderBy('expiresAt', 'asc')
      .limit(limit)
      .execute();
    if (rows.length === 0) return 0;
    const deleted = await this.db
      .deleteFrom('aiAuxRuns')
      .where(
        'id',
        'in',
        rows.map((row) => row.id),
      )
      .executeTakeFirst();
    return Number(deleted.numDeletedRows);
  }

  toEditorAction(run: AiAuxRun): AiEditorActionRun {
    if (
      run.kind !== 'editor_transform' ||
      !run.clientRequestId ||
      !run.commandId ||
      run.selectionText === null ||
      run.selectionFrom === null ||
      run.selectionTo === null ||
      !run.snapshotHash
    ) {
      throw new NotFoundException({
        code: 'editor_action_not_found',
        message: 'AI editor action not found',
      });
    }
    return {
      id: run.id,
      kind: 'editor_transform',
      userId: run.userId,
      workspaceId: run.workspaceId,
      spaceId: run.spaceId,
      pageId: run.pageId,
      clientRequestId: run.clientRequestId,
      commandId: run.commandId,
      selection: {
        text: run.selectionText,
        from: run.selectionFrom,
        to: run.selectionTo,
      },
      snapshotHash: run.snapshotHash,
      status: run.status as AiEditorActionRun['status'],
      sequence: run.sequence,
      response: run.responseSnapshot,
      inputTokens: Number(run.inputTokens),
      outputTokens: Number(run.outputTokens),
      cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      errorCode: run.errorCode,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private async getOwnedEditorAction(
    id: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiAuxRun> {
    const run = await this.db
      .selectFrom('aiAuxRuns')
      .selectAll()
      .where('id', '=', id)
      .where('kind', '=', 'editor_transform')
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();
    if (!run) {
      throw new NotFoundException({
        code: 'editor_action_not_found',
        message: 'AI editor action not found',
      });
    }
    return run;
  }

  private async findEditorAction(
    userId: string,
    clientRequestId: string,
  ): Promise<AiAuxRun | undefined> {
    return this.db
      .selectFrom('aiAuxRuns')
      .selectAll()
      .where('kind', '=', 'editor_transform')
      .where('userId', '=', userId)
      .where('clientRequestId', '=', clientRequestId)
      .executeTakeFirst();
  }

  private assertFingerprint(run: AiAuxRun, fingerprint: string): void {
    if (run.requestFingerprint !== fingerprint) {
      throw new ConflictException({
        code: 'idempotency_key_reused',
        message: 'The idempotency key was already used for another request',
      });
    }
  }

  private async assertAdmission(
    db: any,
    userId: string,
    workspaceId: string,
    spaceId: string,
    requestLimit: number,
    tokenLimit: number,
    reservation: number,
  ): Promise<void> {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [
      mainRequests,
      auxRequests,
      mainTokens,
      auxTokens,
      userMain,
      userAux,
      spaceMain,
      spaceAux,
    ] = await Promise.all([
      db
        .selectFrom('aiRuns')
        .select(sql<number>`count(*)`.as('count'))
        .where('userId', '=', userId)
        .where('spaceId', '=', spaceId)
        .where('createdAt', '>=', dayStart)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('aiAuxRuns')
        .select(sql<number>`count(*)`.as('count'))
        .where('kind', '=', 'editor_transform')
        .where('userId', '=', userId)
        .where('spaceId', '=', spaceId)
        .where('createdAt', '>=', dayStart)
        .executeTakeFirstOrThrow(),
      this.sumMainTokens(db, workspaceId, spaceId, dayStart),
      this.sumAuxTokens(db, workspaceId, spaceId, dayStart),
      this.countActive(db, 'aiRuns', 'userId', userId),
      this.countActive(db, 'aiAuxRuns', 'userId', userId),
      this.countActive(db, 'aiRuns', 'spaceId', spaceId),
      this.countActive(db, 'aiAuxRuns', 'spaceId', spaceId),
    ]);
    if (
      Number(mainRequests.count) + Number(auxRequests.count) >=
      requestLimit
    ) {
      throw new HttpException(
        {
          code: 'ai_daily_request_limit',
          message: 'AI daily request limit exceeded',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (mainTokens + auxTokens + reservation > tokenLimit) {
      throw new HttpException(
        {
          code: 'ai_daily_token_limit',
          message: 'AI daily token limit exceeded',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      userMain + userAux >= AI_CONCURRENCY_LIMITS.perUser ||
      spaceMain + spaceAux >= AI_CONCURRENCY_LIMITS.perSpace
    ) {
      throw new ConflictException({
        code: 'ai_conversation_busy',
        message: 'Too many concurrent AI runs',
      });
    }
  }

  private async sumMainTokens(
    db: any,
    workspaceId: string,
    spaceId: string,
    dayStart: Date,
  ): Promise<number> {
    const row = await db
      .selectFrom('aiRuns')
      .select(
        sql<number>`
          coalesce(sum(
            case
              when status in ('queued', 'running') then reserved_tokens
              else input_tokens + output_tokens
            end
          ), 0)
        `.as('tokens'),
      )
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('createdAt', '>=', dayStart)
      .executeTakeFirstOrThrow();
    return Number(row.tokens);
  }

  private async sumAuxTokens(
    db: any,
    workspaceId: string,
    spaceId: string,
    dayStart: Date,
  ): Promise<number> {
    const row = await db
      .selectFrom('aiAuxRuns')
      .select(
        sql<number>`
          coalesce(sum(
            case
              when status in ('queued', 'running') then reserved_tokens
              else input_tokens + output_tokens
            end
          ), 0)
        `.as('tokens'),
      )
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('createdAt', '>=', dayStart)
      .executeTakeFirstOrThrow();
    return Number(row.tokens);
  }

  private async countActive(
    db: any,
    table: 'aiRuns' | 'aiAuxRuns',
    field: 'userId' | 'spaceId',
    value: string,
  ): Promise<number> {
    const row = await db
      .selectFrom(table)
      .select(sql<number>`count(*)`.as('count'))
      .where(field, '=', value)
      .where('status', 'in', ['queued', 'running'])
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async lockAdmission(
    trx: any,
    spaceId: string,
    userId: string,
  ): Promise<void> {
    for (const key of [`ai-space:${spaceId}`, `ai-user:${userId}`]) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(
        trx,
      );
    }
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private jobId(runId: string): string {
    return `ai-aux-${runId}`;
  }

  private isTerminal(status: string): boolean {
    return ['completed', 'failed', 'cancelled'].includes(status);
  }
}
