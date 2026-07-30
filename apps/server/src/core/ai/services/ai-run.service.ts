import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AiMessage as AiMessageEntity,
  AiRun as AiRunEntity,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import {
  AiMessage,
  AiRun,
  AiRunStep,
  AiRunTrigger,
  SendAiMessageResponse,
} from '@docmost/api-contract';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { AiRunActionDto, SendAiMessageDto } from '../dto/ai.dto';
import { AiConfigService } from './ai-config.service';
import { AiConversationService } from './ai-conversation.service';
import { PageAccessService } from '../../page-access/page-access.service';
import { extractAiApprovalPreview } from '../../../common/helpers/prosemirror/ai-page-operation';
import { AiRunEventService } from './ai-run-event.service';
import { AiContextService } from './ai-context.service';
import { AI_CONCURRENCY_LIMITS } from '../ai.constants';

@Injectable()
export class AiRunService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.AI_CHAT_QUEUE)
    private readonly queue: Queue,
    private readonly conversations: AiConversationService,
    private readonly configs: AiConfigService,
    private readonly pageAccessService: PageAccessService,
    private readonly events: AiRunEventService,
    private readonly contexts: AiContextService,
  ) {}

  async send(
    conversationId: string,
    dto: SendAiMessageDto,
    user: User,
    workspace: Workspace,
  ): Promise<SendAiMessageResponse> {
    const conversation = await this.conversations.getOwnedEntity(
      conversationId,
      user,
      workspace,
    );
    if (dto.selection && dto.selection.to < dto.selection.from) {
      throw new BadRequestException('Selection range is invalid');
    }

    if (dto.contextRevision !== conversation.contextRevision) {
      throw new ConflictException({
        code: 'ai_context_revision_conflict',
        message: 'AI conversation context was updated elsewhere',
      });
    }
    const chatFileIds = [...conversation.contextChatFileIds].sort();
    const attachmentIds = [...conversation.contextAttachmentIds].sort();
    const fingerprint = this.fingerprint({
      content: dto.content,
      documentSnapshot: conversation.includeCurrentDocument
        ? (dto.documentSnapshot ?? null)
        : null,
      snapshotHash: dto.snapshotHash ?? null,
      selection: conversation.includeCurrentDocument
        ? (dto.selection ?? null)
        : null,
      contextRevision: conversation.contextRevision,
      contextFingerprint: conversation.contextFingerprint,
      chatFileIds,
      attachmentIds,
      useSpaceSearch: dto.useSpaceSearch ?? conversation.useSpaceSearch,
      executionMode: conversation.agentMode ? 'agent' : 'chat',
    });
    const existing = await this.findIdempotentRun(
      conversation.id,
      user.id,
      dto.clientRequestId,
      fingerprint,
    );
    if (existing) return this.toSendResult(existing);

    const config = await this.configs.getRawConfig(
      conversation.spaceId,
      workspace.id,
    );
    if (!config?.enabled || !config.baseUrl || !config.chatModel) {
      throw new ForbiddenException('AI is not available in this space');
    }
    if (
      conversation.agentMode &&
      (!config.agentEnabled ||
        config.agentVerifiedProviderFingerprint !==
          this.configs.getProviderFingerprint(config))
    ) {
      throw new ForbiddenException({
        code: 'agent_provider_unverified',
        message: 'The AI agent is disabled or its provider is unverified',
      });
    }
    await this.assertChatFiles(
      chatFileIds,
      conversation.id,
      user.id,
      workspace.id,
    );
    await this.assertAttachments(
      attachmentIds,
      conversation.spaceId,
      workspace.id,
      user,
    );

    const userMessageId = uuidv7();
    const assistantMessageId = uuidv7();
    const runId = uuidv7();
    const now = new Date();
    const reservedTokens = this.estimateReservation(
      dto.content,
      dto.documentSnapshot,
      dto.selection?.text,
      config.contextWindow,
      config.maxOutputTokens,
    );

    let run: AiRunEntity;
    try {
      run = await this.db.transaction().execute(async (trx) => {
        await this.lockAdmission(
          trx,
          conversation.spaceId,
          user.id,
          conversation.id,
        );
        const lockedConversation = await trx
          .selectFrom('aiConversations')
          .selectAll()
          .where('id', '=', conversation.id)
          .where('deletedAt', 'is', null)
          .forUpdate()
          .executeTakeFirst();
        if (!lockedConversation) {
          throw new NotFoundException('AI conversation not found');
        }
        if (lockedConversation.contextRevision !== dto.contextRevision) {
          throw new ConflictException({
            code: 'ai_context_revision_conflict',
            message: 'AI conversation context was updated elsewhere',
          });
        }

        const raced = await trx
          .selectFrom('aiRuns')
          .selectAll()
          .where('conversationId', '=', conversation.id)
          .where('userId', '=', user.id)
          .where('clientRequestId', '=', dto.clientRequestId)
          .executeTakeFirst();
        if (raced) {
          this.assertFingerprint(raced.requestFingerprint, fingerprint);
          return raced;
        }

        await this.assertQuotaAndConcurrency(
          trx,
          user.id,
          workspace.id,
          conversation.spaceId,
          conversation.id,
          config.dailyRequestLimitPerUser,
          Number(config.dailyTokenLimitPerSpace),
          reservedTokens,
        );
        await trx
          .insertInto('aiMessages')
          .values([
            {
              id: userMessageId,
              workspaceId: workspace.id,
              conversationId: conversation.id,
              userId: user.id,
              role: 'user',
              content: dto.content,
              status: 'completed',
              clientRequestId: dto.clientRequestId,
              currentRunId: null,
            },
            {
              id: assistantMessageId,
              workspaceId: workspace.id,
              conversationId: conversation.id,
              userId: null,
              role: 'assistant',
              content: '',
              status: 'pending',
              clientRequestId: null,
              currentRunId: null,
            },
          ])
          .execute();
        const inserted = await trx
          .insertInto('aiRuns')
          .values({
            id: runId,
            rootRunId: runId,
            previousRunId: null,
            attemptNo: 1,
            trigger: 'send',
            conversationId: conversation.id,
            userId: user.id,
            workspaceId: workspace.id,
            spaceId: conversation.spaceId,
            pageId: conversation.pageId,
            userMessageId,
            assistantMessageId,
            status: 'queued',
            executionMode: lockedConversation.agentMode ? 'agent' : 'chat',
            clientRequestId: dto.clientRequestId,
            requestFingerprint: fingerprint,
            contextRevision: lockedConversation.contextRevision,
            useSpaceSearch: dto.useSpaceSearch ?? conversation.useSpaceSearch,
            chatFileIds,
            attachmentIds,
            documentSnapshot: lockedConversation.includeCurrentDocument
              ? (dto.documentSnapshot ?? null)
              : null,
            snapshotHash: dto.snapshotHash ?? null,
            selectionText: lockedConversation.includeCurrentDocument
              ? (dto.selection?.text ?? null)
              : null,
            selectionFrom: lockedConversation.includeCurrentDocument
              ? (dto.selection?.from ?? null)
              : null,
            selectionTo: lockedConversation.includeCurrentDocument
              ? (dto.selection?.to ?? null)
              : null,
            retrievalOutcome: 'not_requested',
            reservedTokens,
            createdAt: now,
            updatedAt: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.contexts.captureRunContext(
          trx,
          inserted.id,
          lockedConversation,
          dto,
          user,
        );
        await trx
          .updateTable('aiMessages')
          .set({ currentRunId: inserted.id })
          .where('id', '=', assistantMessageId)
          .execute();
        await trx
          .updateTable('aiConversations')
          .set({
            draft: null,
            lastOpenedAt: now,
            updatedAt: now,
          })
          .where('id', '=', conversation.id)
          .execute();
        return inserted;
      });
    } catch (error) {
      if ((error as any)?.code === '23505') {
        const raced = await this.findIdempotentRun(
          conversation.id,
          user.id,
          dto.clientRequestId,
          fingerprint,
        );
        if (raced) return this.toSendResult(raced);
        throw this.busyError();
      }
      throw error;
    }

    await this.enqueue(run);
    return this.toSendResult(run);
  }

  async get(runId: string, user: User, workspace: Workspace): Promise<AiRun> {
    const run = await this.getOwnedRun(runId, user, workspace);
    const steps = await this.db
      .selectFrom('aiRunSteps')
      .selectAll()
      .where('runId', '=', run.id)
      .orderBy('sequence', 'asc')
      .execute();
    return { ...this.toRun(run), steps: steps.map((step) => this.toStep(step)) };
  }

  async cancel(
    runId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiRun> {
    const owned = await this.getOwnedRun(runId, user, workspace);
    let terminalEvent: AiRunEntity | null = null;
    const updated = await this.db.transaction().execute(async (trx) => {
      const run = await trx
        .selectFrom('aiRuns')
        .selectAll()
        .where('id', '=', owned.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (this.isTerminal(run.status)) return run;

      const now = new Date();
      if (run.status === 'queued' || run.status === 'awaiting_approval') {
        const sequence = run.sequence + 1;
        const assistant = await trx
          .selectFrom('aiMessages')
          .select(['content', 'reasoning'])
          .where('id', '=', run.assistantMessageId)
          .executeTakeFirst();
        const cancelled = await trx
          .updateTable('aiRuns')
          .set({
            status: 'cancelled',
            sequence,
            cancelRequestedAt: now,
            completedAt: now,
            finishReason: 'cancelled',
            responseSnapshot: assistant?.content ?? '',
            reasoningSnapshot: assistant?.reasoning ?? '',
            updatedAt: now,
          })
          .where('id', '=', run.id)
          .where('status', '=', run.status)
          .returningAll()
          .executeTakeFirst();
        if (!cancelled) {
          return trx
            .selectFrom('aiRuns')
            .selectAll()
            .where('id', '=', run.id)
            .executeTakeFirstOrThrow();
        }
        await trx
          .updateTable('aiMessages')
          .set({ status: 'cancelled', updatedAt: now })
          .where('id', '=', run.assistantMessageId)
          .where('currentRunId', '=', run.id)
          .execute();
        if (run.status === 'awaiting_approval') {
          await trx
            .updateTable('aiRunSteps')
            .set({
              status: 'expired',
              errorCode: 'cancelled',
              errorMessage: 'The run was cancelled',
              decidedAt: now,
              decidedById: user.id,
              updatedAt: now,
            })
            .where('runId', '=', run.id)
            .where('status', '=', 'pending_approval')
            .execute();
        }
        terminalEvent = cancelled;
        return cancelled;
      }

      return trx
        .updateTable('aiRuns')
        .set({
          cancelRequestedAt: run.cancelRequestedAt ?? now,
          updatedAt: now,
        })
        .where('id', '=', run.id)
        .where('status', '=', 'running')
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    if (terminalEvent) {
      await this.queue
        .getJob(this.runJobId(updated.id))
        .then((job) => job?.remove())
        .catch(() => undefined);
      this.events.emitStatus(updated, updated.sequence, 'cancelled', {
        finishReason: 'cancelled',
      });
    }
    return this.toRun(updated);
  }

  async retry(
    runId: string,
    dto: AiRunActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiRun> {
    const source = await this.getOwnedRun(runId, user, workspace);
    return this.createAttempt(source, 'retry', dto, user, workspace);
  }

  async regenerate(
    messageId: string,
    dto: AiRunActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiRun> {
    const message = await this.db
      .selectFrom('aiMessages')
      .select(['currentRunId'])
      .where('id', '=', messageId)
      .where('workspaceId', '=', workspace.id)
      .where('role', '=', 'assistant')
      .executeTakeFirst();
    if (!message?.currentRunId) {
      throw new NotFoundException('AI message not found');
    }
    const source = await this.getOwnedRun(
      message.currentRunId,
      user,
      workspace,
    );
    return this.createAttempt(source, 'regenerate', dto, user, workspace);
  }

  async getOwnedRun(
    runId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiRunEntity> {
    const run = await this.db
      .selectFrom('aiRuns')
      .selectAll()
      .where('id', '=', runId)
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();
    if (!run) throw new NotFoundException('AI run not found');
    await this.conversations.getOwnedEntity(
      run.conversationId,
      user,
      workspace,
    );
    return run;
  }

  async enqueue(run: AiRunEntity): Promise<boolean> {
    if (run.status !== 'queued') return false;
    try {
      const jobId = this.runJobId(run.id);
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'failed' || state === 'completed') {
          await existingJob.remove();
        } else {
          return true;
        }
      }
      await this.queue.add(
        QueueJob.AI_CHAT_RUN,
        { runId: run.id },
        {
          jobId,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
      await this.db
        .updateTable('aiRuns')
        .set({ enqueuedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', run.id)
        .where('status', '=', 'queued')
        .execute();
      return true;
    } catch {
      return false;
    }
  }

  toRun(run: AiRunEntity): AiRun {
    return {
      id: run.id,
      conversationId: run.conversationId,
      userId: run.userId,
      workspaceId: run.workspaceId,
      spaceId: run.spaceId,
      pageId: run.pageId,
      userMessageId: run.userMessageId,
      assistantMessageId: run.assistantMessageId,
      rootRunId: run.rootRunId,
      previousRunId: run.previousRunId,
      attemptNo: run.attemptNo,
      trigger: run.trigger as AiRunTrigger,
      executionMode: run.executionMode as AiRun['executionMode'],
      status: run.status as AiRun['status'],
      clientRequestId: run.clientRequestId,
      contextRevision: run.contextRevision,
      useSpaceSearch: run.useSpaceSearch,
      chatFileIds: run.chatFileIds,
      attachmentIds: run.attachmentIds,
      applyContext: {
        pageId: run.pageId,
        snapshotHash: run.snapshotHash,
        selection:
          run.selectionText !== null &&
          run.selectionFrom !== null &&
          run.selectionTo !== null
            ? {
                text: run.selectionText,
                from: run.selectionFrom,
                to: run.selectionTo,
              }
            : null,
      },
      sequence: run.sequence,
      reservedTokens: Number(run.reservedTokens),
      enqueuedAt: run.enqueuedAt?.toISOString() ?? null,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      finishReason: run.finishReason,
      retrievalOutcome: run.retrievalOutcome as AiRun['retrievalOutcome'],
      retrievalErrorCode: run.retrievalErrorCode,
      inputTokens: Number(run.inputTokens),
      outputTokens: Number(run.outputTokens),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private async createAttempt(
    source: AiRunEntity,
    trigger: Exclude<AiRunTrigger, 'send'>,
    dto: AiRunActionDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiRun> {
    const fingerprint = this.fingerprint({
      trigger,
      rootRunId: source.rootRunId,
      sourceRunId: source.id,
    });
    const idempotent = await this.findIdempotentRun(
      source.conversationId,
      user.id,
      dto.clientRequestId,
      fingerprint,
    );
    if (idempotent) return this.toRun(idempotent);

    const config = await this.configs.getRawConfig(
      source.spaceId,
      workspace.id,
    );
    if (!config?.enabled) {
      throw new ForbiddenException('AI is not available in this space');
    }

    let created: AiRunEntity;
    try {
      created = await this.db.transaction().execute(async (trx) => {
        await this.lockAdmission(
          trx,
          source.spaceId,
          user.id,
          source.conversationId,
        );
        const locked = await trx
          .selectFrom('aiRuns')
          .selectAll()
          .where('id', '=', source.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const assistant = await trx
          .selectFrom('aiMessages')
          .selectAll()
          .where('id', '=', locked.assistantMessageId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const latestAssistant = await trx
          .selectFrom('aiMessages')
          .select('id')
          .where('conversationId', '=', locked.conversationId)
          .where('role', '=', 'assistant')
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(1)
          .executeTakeFirst();
        if (
          assistant.currentRunId !== locked.id ||
          latestAssistant?.id !== locked.assistantMessageId
        ) {
          throw this.notLatestError();
        }
        if (
          trigger === 'retry' &&
          !['failed', 'cancelled'].includes(locked.status)
        ) {
          throw new ConflictException(
            'Only failed or cancelled runs can be retried',
          );
        }
        if (trigger === 'regenerate' && locked.status !== 'completed') {
          throw new ConflictException('Only completed runs can be regenerated');
        }

        const raced = await trx
          .selectFrom('aiRuns')
          .selectAll()
          .where('conversationId', '=', locked.conversationId)
          .where('userId', '=', user.id)
          .where('clientRequestId', '=', dto.clientRequestId)
          .executeTakeFirst();
        if (raced) {
          this.assertFingerprint(raced.requestFingerprint, fingerprint);
          return raced;
        }

        const reservedTokens = this.estimateReservation(
          '',
          locked.documentSnapshot ?? undefined,
          locked.selectionText ?? undefined,
          config.contextWindow,
          config.maxOutputTokens,
        );
        await this.assertQuotaAndConcurrency(
          trx,
          user.id,
          workspace.id,
          locked.spaceId,
          locked.conversationId,
          config.dailyRequestLimitPerUser,
          Number(config.dailyTokenLimitPerSpace),
          reservedTokens,
        );
        const latestAttempt = await trx
          .selectFrom('aiRuns')
          .select((eb) => eb.fn.max<number>('attemptNo').as('attemptNo'))
          .where('rootRunId', '=', locked.rootRunId)
          .executeTakeFirstOrThrow();
        const id = uuidv7();
        const now = new Date();
        const run = await trx
          .insertInto('aiRuns')
          .values({
            id,
            rootRunId: locked.rootRunId,
            previousRunId: locked.id,
            attemptNo: Number(latestAttempt.attemptNo ?? locked.attemptNo) + 1,
            trigger,
            conversationId: locked.conversationId,
            userId: locked.userId,
            workspaceId: locked.workspaceId,
            spaceId: locked.spaceId,
            pageId: locked.pageId,
            userMessageId: locked.userMessageId,
            assistantMessageId: locked.assistantMessageId,
            status: 'queued',
            executionMode: locked.executionMode,
            clientRequestId: dto.clientRequestId,
            requestFingerprint: fingerprint,
            contextRevision: locked.contextRevision,
            useSpaceSearch: locked.useSpaceSearch,
            chatFileIds: locked.chatFileIds,
            attachmentIds: locked.attachmentIds,
            documentSnapshot: locked.documentSnapshot,
            snapshotHash: locked.snapshotHash,
            selectionText: locked.selectionText,
            selectionFrom: locked.selectionFrom,
            selectionTo: locked.selectionTo,
            retrievalOutcome: 'not_requested',
            reservedTokens,
            createdAt: now,
            updatedAt: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.contexts.copyRunContext(
          trx,
          locked.id,
          run.id,
          locked.assistantMessageId,
          user,
        );
        await trx
          .updateTable('aiMessages')
          .set({
            currentRunId: run.id,
            content: '',
            reasoning: '',
            status: 'pending',
            errorCode: null,
            errorMessage: null,
            inputTokens: 0,
            outputTokens: 0,
            updatedAt: now,
          })
          .where('id', '=', locked.assistantMessageId)
          .execute();
        return run;
      });
    } catch (error) {
      if ((error as any)?.code === '23505') {
        const raced = await this.findIdempotentRun(
          source.conversationId,
          user.id,
          dto.clientRequestId,
          fingerprint,
        );
        if (raced) return this.toRun(raced);
        throw this.busyError();
      }
      throw error;
    }

    await this.enqueue(created);
    return this.toRun(created);
  }

  private async assertQuotaAndConcurrency(
    db: any,
    userId: string,
    workspaceId: string,
    spaceId: string,
    conversationId: string,
    requestLimit: number,
    tokenLimit: number,
    requestedReservation: number,
  ): Promise<void> {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [
      requestCount,
      auxRequestCount,
      tokenRow,
      auxTokenRow,
      conversationActive,
      userActive,
      userAuxActive,
      spaceActive,
      spaceAuxActive,
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
      db
        .selectFrom('aiRuns')
        .select(
          sql<number>`
              coalesce(sum(
                case
                  when status in ('queued', 'running', 'awaiting_approval') then reserved_tokens
                  else input_tokens + output_tokens
                end
              ), 0)
            `.as('tokens'),
        )
        .where('workspaceId', '=', workspaceId)
        .where('spaceId', '=', spaceId)
        .where('createdAt', '>=', dayStart)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('aiAuxRuns')
        .select(
          sql<number>`
              coalesce(sum(
                case
                  when status in ('queued', 'running', 'awaiting_approval') then reserved_tokens
                  else input_tokens + output_tokens
                end
              ), 0)
            `.as('tokens'),
        )
        .where('workspaceId', '=', workspaceId)
        .where('spaceId', '=', spaceId)
        .where('createdAt', '>=', dayStart)
        .executeTakeFirstOrThrow(),
      this.countActive(db, 'conversationId', conversationId),
      this.countActive(db, 'userId', userId),
      this.countActiveAux(db, 'userId', userId),
      this.countActive(db, 'spaceId', spaceId),
      this.countActiveAux(db, 'spaceId', spaceId),
    ]);
    if (
      Number(requestCount.count) + Number(auxRequestCount.count) >=
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
    if (
      Number(tokenRow.tokens) +
        Number(auxTokenRow.tokens) +
        requestedReservation >
      tokenLimit
    ) {
      throw new HttpException(
        {
          code: 'ai_daily_token_limit',
          message: 'AI daily token limit exceeded',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      Number(conversationActive) >= AI_CONCURRENCY_LIMITS.perConversation ||
      Number(userActive) + Number(userAuxActive) >=
        AI_CONCURRENCY_LIMITS.perUser ||
      Number(spaceActive) + Number(spaceAuxActive) >=
        AI_CONCURRENCY_LIMITS.perSpace
    ) {
      throw this.busyError();
    }
  }

  private async countActive(
    db: any,
    field: 'conversationId' | 'userId' | 'spaceId',
    value: string,
  ): Promise<number> {
    return Number(
      (
        await db
          .selectFrom('aiRuns')
          .select(sql<number>`count(*)`.as('count'))
          .where(field, '=', value)
          .where('status', 'in', [
            'queued',
            'running',
            'awaiting_approval',
          ])
          .executeTakeFirstOrThrow()
      ).count,
    );
  }

  private async countActiveAux(
    db: any,
    field: 'userId' | 'spaceId',
    value: string,
  ): Promise<number> {
    return Number(
      (
        await db
          .selectFrom('aiAuxRuns')
          .select(sql<number>`count(*)`.as('count'))
          .where(field, '=', value)
          .where('status', 'in', ['queued', 'running'])
          .executeTakeFirstOrThrow()
      ).count,
    );
  }

  private toStep(row: any): AiRunStep {
    return {
      id: row.id,
      runId: row.runId,
      sequence: row.sequence,
      modelStep: row.modelStep,
      callIndex: row.callIndex,
      toolCallId: row.toolCallId,
      toolName: row.toolName,
      writeClass: row.writeClass,
      arguments: row.arguments as Record<string, unknown>,
      result: row.result,
      approvalPreview: extractAiApprovalPreview(row.result),
      status: row.status,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      targetPageId: row.targetPageId,
      baseContentHash: row.baseContentHash,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async lockAdmission(
    trx: any,
    spaceId: string,
    userId: string,
    conversationId: string,
  ): Promise<void> {
    for (const key of [
      `ai-space:${spaceId}`,
      `ai-user:${userId}`,
      `ai-conversation:${conversationId}`,
    ]) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(
        trx,
      );
    }
  }

  private async assertChatFiles(
    ids: string[],
    conversationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.db
      .selectFrom('aiChatFiles')
      .select(['id', 'status'])
      .where('id', 'in', ids)
      .where('conversationId', '=', conversationId)
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
    if (
      rows.length !== ids.length ||
      rows.some((row) => row.status !== 'ready')
    ) {
      throw new BadRequestException('AI chat files are missing or not ready');
    }
  }

  private async assertAttachments(
    ids: string[],
    spaceId: string,
    workspaceId: string,
    user: User,
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.db
      .selectFrom('attachments')
      .select(['id', 'pageId'])
      .where('id', 'in', ids)
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .execute();
    if (rows.length !== ids.length || rows.some((row) => !row.pageId)) {
      throw new BadRequestException('Attachments are missing or inaccessible');
    }
    const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      spaceId,
    );
    if (rows.some((row) => !snapshot.readablePageIds.has(row.pageId!))) {
      throw new ForbiddenException('Attachment access denied');
    }
  }

  private async findIdempotentRun(
    conversationId: string,
    userId: string,
    clientRequestId: string,
    fingerprint: string,
  ): Promise<AiRunEntity | undefined> {
    const existing = await this.db
      .selectFrom('aiRuns')
      .selectAll()
      .where('conversationId', '=', conversationId)
      .where('userId', '=', userId)
      .where('clientRequestId', '=', clientRequestId)
      .executeTakeFirst();
    if (existing) {
      this.assertFingerprint(existing.requestFingerprint, fingerprint);
    }
    return existing;
  }

  private assertFingerprint(existing: string | null, expected: string): void {
    if (existing && existing !== expected) {
      throw new ConflictException({
        code: 'idempotency_key_reused',
        message: 'The idempotency key was already used for another request',
      });
    }
  }

  private estimateReservation(
    content: string,
    documentSnapshot: string | undefined,
    selectionText: string | undefined,
    contextWindow: number,
    maxOutputTokens: number,
  ): number {
    const chars =
      content.length + (selectionText?.length ?? documentSnapshot?.length ?? 0);
    const inputBudget = Math.max(1, contextWindow - maxOutputTokens);
    return Math.min(inputBudget, Math.ceil(chars / 4)) + maxOutputTokens;
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private runJobId(runId: string): string {
    return `ai-run-${runId}`;
  }

  private isTerminal(status: string): boolean {
    return ['completed', 'failed', 'cancelled'].includes(status);
  }

  private busyError(): ConflictException {
    return new ConflictException({
      code: 'ai_conversation_busy',
      message: 'Too many concurrent AI runs',
    });
  }

  private notLatestError(): ConflictException {
    return new ConflictException({
      code: 'ai_run_not_latest',
      message: 'Only the latest AI response can be retried or regenerated',
    });
  }

  private async toSendResult(run: AiRunEntity): Promise<SendAiMessageResponse> {
    const messages = await this.db
      .selectFrom('aiMessages')
      .selectAll()
      .where('id', 'in', [run.userMessageId, run.assistantMessageId])
      .execute();
    const map = new Map(messages.map((message) => [message.id, message]));
    const userMessage = map.get(run.userMessageId);
    const assistantMessage = map.get(run.assistantMessageId);
    if (!userMessage || !assistantMessage) {
      throw new ServiceUnavailableException('AI message state is incomplete');
    }
    return {
      userMessage: this.toMessage(userMessage),
      assistantMessage: this.toMessage(assistantMessage),
      run: this.toRun(run),
    };
  }

  private toMessage(message: AiMessageEntity): AiMessage {
    return {
      id: message.id,
      conversationId: message.conversationId,
      userId: message.userId,
      role: message.role as AiMessage['role'],
      content: message.content,
      reasoning: message.reasoning,
      status: message.status as AiMessage['status'],
      clientRequestId: message.clientRequestId,
      currentRunId: message.currentRunId,
      inputTokens: Number(message.inputTokens),
      outputTokens: Number(message.outputTokens),
      errorCode: message.errorCode,
      errorMessage: message.errorMessage,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    };
  }
}
