import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AiRun, User } from '@docmost/db/types/entity.types';
import { sql } from 'kysely';
import { AI_RETRIEVAL_DEFAULTS } from '../ai.constants';
import { AiRetrievalService } from '../retrieval/ai-retrieval.service';
import { AiConfigService } from './ai-config.service';
import { AiConversationService } from './ai-conversation.service';
import { AiFileService } from './ai-file.service';
import { AiPromptBuilderService } from './ai-prompt-builder.service';
import { AiRunEventService } from './ai-run-event.service';
import { OpenAiCompatibleProviderService } from './openai-compatible-provider.service';

class AiRunCancelledError extends Error {}

@Injectable()
export class AiRunExecutionService {
  private readonly logger = new Logger(AiRunExecutionService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly configs: AiConfigService,
    private readonly conversations: AiConversationService,
    private readonly files: AiFileService,
    private readonly retrieval: AiRetrievalService,
    private readonly provider: OpenAiCompatibleProviderService,
    private readonly promptBuilder: AiPromptBuilderService,
    private readonly events: AiRunEventService,
  ) {}

  async execute(runId: string): Promise<void> {
    const run = await this.claim(runId);
    if (!run) return;
    this.events.emitStatus(run, run.sequence, 'running');

    const [user, config, userMessage, conversation] = await Promise.all([
      this.db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', run.userId)
        .where('workspaceId', '=', run.workspaceId)
        .where('deletedAt', 'is', null)
        .where('deactivatedAt', 'is', null)
        .executeTakeFirst(),
      this.configs.getRawConfig(run.spaceId, run.workspaceId),
      this.db
        .selectFrom('aiMessages')
        .selectAll()
        .where('id', '=', run.userMessageId)
        .executeTakeFirst(),
      this.db
        .selectFrom('aiConversations')
        .selectAll()
        .where('id', '=', run.conversationId)
        .where('userId', '=', run.userId)
        .where('workspaceId', '=', run.workspaceId)
        .where('spaceId', '=', run.spaceId)
        .where('pageId', '=', run.pageId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst(),
    ]);
    if (!user || !config?.enabled || !userMessage || !conversation) {
      await this.fail(run, '', 'ai_unavailable', 'AI is no longer available');
      return;
    }
    try {
      await this.conversations.assertWritablePage(
        run.pageId,
        user as User,
        run.workspaceId,
      );
    } catch {
      await this.fail(
        run,
        '',
        'page_write_required',
        'Page write access is required',
      );
      return;
    }
    if (await this.isCancelled(run.id)) {
      await this.cancel(run, '');
      return;
    }

    let content = '';
    let pendingDelta = '';
    let sequence = run.sequence;
    let lastFlush = Date.now();
    let lastHeartbeat = 0;
    try {
      const fileContext = await this.files.buildContext(
        run.chatFileIds,
        run.attachmentIds,
        {
          conversationId: run.conversationId,
          userId: run.userId,
          workspaceId: run.workspaceId,
          spaceId: run.spaceId,
          visionEnabled: config.visionEnabled,
          maxTextChars: Math.min(
            250_000,
            Math.max(
              8_000,
              (config.contextWindow - config.maxOutputTokens) * 1.5,
            ),
          ),
          maxImageBytes: Math.min(
            2 * 1024 * 1024,
            Math.max(
              256 * 1024,
              (config.contextWindow - config.maxOutputTokens) * 4,
            ),
          ),
        },
      );
      const retrievalOutcome = await this.retrieval.retrieveSafe({
        config: this.configs.toRetrievalConfig(config),
        user: user as User,
        requested: run.useSpaceSearch,
        request: {
          schemaVersion: 1,
          requestId: `${run.rootRunId}-${run.attemptNo}`,
          workspaceId: run.workspaceId,
          spaceId: run.spaceId,
          pageId: run.pageId,
          query: userMessage.content,
          allowedPageIds: [],
          sourceTypes: ['page', 'database_row', 'attachment'],
          limit: config.retrievalMaxResults,
          candidateLimit: AI_RETRIEVAL_DEFAULTS.candidateLimit,
        },
      });
      await this.db
        .updateTable('aiRuns')
        .set({
          retrievalOutcome: retrievalOutcome.status,
          retrievalErrorCode: retrievalOutcome.errorCode ?? null,
          updatedAt: new Date(),
        })
        .where('id', '=', run.id)
        .where('status', '=', 'running')
        .execute();

      const messages = await this.promptBuilder.build({
        run,
        instructions: config.systemInstructions,
        currentUserContent: userMessage.content,
        fileText: fileContext.text,
        fileSources: fileContext.citations,
        images: fileContext.images,
        retrievalSources: retrievalOutcome.sources,
        contextWindow: config.contextWindow,
        maxOutputTokens: config.maxOutputTokens,
      });

      const heartbeat = async () => {
        const now = Date.now();
        if (now - lastHeartbeat < 5_000) return;
        lastHeartbeat = now;
        await this.db
          .updateTable('aiRuns')
          .set({ heartbeatAt: new Date(), updatedAt: new Date() })
          .where('id', '=', run.id)
          .where('status', '=', 'running')
          .execute();
      };
      const flush = async (force = false) => {
        if (
          !pendingDelta ||
          (!force && pendingDelta.length < 1024 && Date.now() - lastFlush < 250)
        ) {
          return;
        }
        const delta = pendingDelta;
        pendingDelta = '';
        lastFlush = Date.now();
        const nextSequence = sequence + 1;
        const persisted = await this.db.transaction().execute(async (trx) => {
          const updated = await trx
            .updateTable('aiRuns')
            .set({
              sequence: nextSequence,
              heartbeatAt: new Date(),
              updatedAt: new Date(),
            })
            .where('id', '=', run.id)
            .where('status', '=', 'running')
            .where('cancelRequestedAt', 'is', null)
            .returning('id')
            .executeTakeFirst();
          if (!updated) return false;
          await trx
            .updateTable('aiMessages')
            .set({ content, status: 'streaming', updatedAt: new Date() })
            .where('id', '=', run.assistantMessageId)
            .where('currentRunId', '=', run.id)
            .execute();
          return true;
        });
        if (!persisted) throw new AiRunCancelledError();
        sequence = nextSequence;
        this.events.emitDelta(run, sequence, delta);
      };

      const usage = await this.provider.stream(
        this.configs.toProviderConfig(config),
        messages,
        {
          onText: async (delta) => {
            content += delta;
            pendingDelta += delta;
            await flush();
          },
          onActivity: heartbeat,
          isCancelled: () => this.isCancelled(run.id),
        },
      );
      await flush(true);
      if (await this.isCancelled(run.id)) {
        await this.cancel(run, content);
        return;
      }

      sequence += 1;
      const completedAt = new Date();
      const completed = await this.db.transaction().execute(async (trx) => {
        const updated = await trx
          .updateTable('aiRuns')
          .set({
            status: 'completed',
            sequence,
            completedAt,
            heartbeatAt: completedAt,
            finishReason: 'stop',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            responseSnapshot: content,
            updatedAt: completedAt,
          })
          .where('id', '=', run.id)
          .where('status', '=', 'running')
          .where('cancelRequestedAt', 'is', null)
          .returning('id')
          .executeTakeFirst();
        if (!updated) return false;
        await trx
          .updateTable('aiMessages')
          .set({
            content,
            status: 'completed',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            updatedAt: completedAt,
          })
          .where('id', '=', run.assistantMessageId)
          .where('currentRunId', '=', run.id)
          .execute();
        const allSources = [
          ...retrievalOutcome.sources,
          ...fileContext.citations,
        ];
        if (allSources.length > 0) {
          await trx
            .insertInto('aiMessageSources')
            .values(
              allSources.map((source, position) => ({
                runId: run.id,
                messageId: run.assistantMessageId,
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                pageId: source.pageId,
                sourceTitle: source.sourceTitle,
                sourceUrl: source.sourceUrl,
                excerpt: source.excerpt,
                position,
                relevanceScore: source.relevanceScore,
              })),
            )
            .execute();
        }
        return true;
      });
      if (!completed) {
        await this.cancel(run, content);
        return;
      }
      this.events.emitStatus(run, sequence, 'completed', {
        finishReason: 'stop',
        retrievalOutcome: retrievalOutcome.status,
        retrievalErrorCode: retrievalOutcome.errorCode,
      });
    } catch (error) {
      if (
        error instanceof AiRunCancelledError ||
        (await this.isCancelled(run.id))
      ) {
        await this.cancel(run, content);
        return;
      }
      this.logger.warn(`AI run failed: ${run.id}`);
      await this.fail(
        run,
        content,
        this.errorCode(error),
        'AI generation failed',
      );
    }
  }

  private async claim(runId: string): Promise<AiRun | undefined> {
    const now = new Date();
    return this.db.transaction().execute(async (trx) => {
      const run = await trx
        .updateTable('aiRuns')
        .set({
          status: 'running',
          startedAt: now,
          heartbeatAt: now,
          sequence: sql`sequence + 1`,
          updatedAt: now,
        })
        .where('id', '=', runId)
        .where('status', '=', 'queued')
        .where('cancelRequestedAt', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!run) return undefined;
      await trx
        .updateTable('aiMessages')
        .set({ status: 'streaming', updatedAt: now })
        .where('id', '=', run.assistantMessageId)
        .where('currentRunId', '=', run.id)
        .execute();
      return run;
    });
  }

  private async isCancelled(runId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('aiRuns')
      .select(['status', 'cancelRequestedAt'])
      .where('id', '=', runId)
      .executeTakeFirst();
    return (
      !row || row.status === 'cancelled' || Boolean(row.cancelRequestedAt)
    );
  }

  private async cancel(run: AiRun, content: string): Promise<void> {
    const now = new Date();
    const cancelled = await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('aiRuns')
        .set({
          status: 'cancelled',
          sequence: sql`sequence + 1`,
          completedAt: now,
          finishReason: 'cancelled',
          responseSnapshot: content,
          updatedAt: now,
        })
        .where('id', '=', run.id)
        .where('status', '=', 'running')
        .returningAll()
        .executeTakeFirst();
      if (!updated) return undefined;
      await trx
        .updateTable('aiMessages')
        .set({ content, status: 'cancelled', updatedAt: now })
        .where('id', '=', run.assistantMessageId)
        .where('currentRunId', '=', run.id)
        .execute();
      return updated;
    });
    if (cancelled) {
      this.events.emitStatus(cancelled, cancelled.sequence, 'cancelled', {
        finishReason: 'cancelled',
      });
    }
  }

  private async fail(
    run: AiRun,
    content: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const now = new Date();
    const failed = await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('aiRuns')
        .set({
          status: 'failed',
          sequence: sql`sequence + 1`,
          completedAt: now,
          finishReason: 'error',
          errorCode,
          errorMessage,
          responseSnapshot: content,
          updatedAt: now,
        })
        .where('id', '=', run.id)
        .where('status', 'in', ['queued', 'running'])
        .where('cancelRequestedAt', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!updated) return undefined;
      await trx
        .updateTable('aiMessages')
        .set({
          content,
          status: 'failed',
          errorCode,
          errorMessage,
          updatedAt: now,
        })
        .where('id', '=', run.assistantMessageId)
        .where('currentRunId', '=', run.id)
        .execute();
      return updated;
    });
    if (failed) {
      this.events.emitStatus(failed, failed.sequence, 'failed', {
        errorCode,
        errorMessage,
      });
    } else if (await this.isCancelled(run.id)) {
      await this.cancel(run, content);
    }
  }

  private errorCode(error: unknown): string {
    if ((error as any)?.aiErrorCode === 'provider_invalid_response') {
      return 'provider_invalid_response';
    }
    const status = Number((error as any)?.status);
    if (status === 504) return 'provider_timeout';
    if (status === 400) return 'provider_url_rejected';
    return 'provider_unavailable';
  }
}
