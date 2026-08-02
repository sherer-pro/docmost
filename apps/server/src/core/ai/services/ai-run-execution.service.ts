import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AiRun,
  AiRunStep,
  User,
} from '@docmost/db/types/entity.types';
import { sql } from 'kysely';
import { AI_RETRIEVAL_DEFAULTS } from '../ai.constants';
import { AiRetrievalService } from '../retrieval/ai-retrieval.service';
import { AiConfigService } from './ai-config.service';
import { AiConversationService } from './ai-conversation.service';
import { AiFileService } from './ai-file.service';
import { AiPromptBuilderService } from './ai-prompt-builder.service';
import { AiRunEventService } from './ai-run-event.service';
import { OpenAiCompatibleProviderService } from './openai-compatible-provider.service';
import { AiContextService } from './ai-context.service';
import { AiAuxRunService } from './ai-aux-run.service';
import {
  AI_AGENT_MAX_MODEL_STEPS,
  AI_AGENT_MAX_RUN_MODEL_STEPS,
  AI_AGENT_MAX_RUN_TOOL_CALLS,
  AI_AGENT_MAX_TOOL_CALLS,
  AI_TOOL_RESULTS_TOTAL_MAX_BYTES,
  AI_WRITE_PROPOSAL_TTL_MS,
  AiToolRegistryService,
} from '../tools/ai-tool-registry.service';
import { AiProviderMessage, AiProviderUsage } from '../ai.types';

class AiRunCancelledError extends Error {}
class AiAgentExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

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
    private readonly contexts: AiContextService,
    private readonly auxRuns: AiAuxRunService,
    private readonly tools: AiToolRegistryService,
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
      await this.fail(
        run,
        '',
        '',
        'ai_unavailable',
        'AI is no longer available',
      );
      return;
    }
    try {
      if (run.executionMode === 'agent') {
        await this.conversations.assertReadablePage(
          run.pageId,
          user as User,
          run.workspaceId,
        );
        if (
          !config.agentEnabled ||
          config.agentVerifiedProviderFingerprint !==
            this.configs.getProviderFingerprint(config)
        ) {
          throw new AiAgentExecutionError(
            'agent_provider_unverified',
            'The AI agent provider is not verified',
          );
        }
      } else {
        await this.conversations.assertWritablePage(
          run.pageId,
          user as User,
          run.workspaceId,
        );
      }
    } catch {
      await this.fail(
        run,
        '',
        '',
        run.executionMode === 'agent'
          ? 'agent_provider_unverified'
          : 'page_write_required',
        run.executionMode === 'agent'
          ? 'The AI agent is unavailable'
          : 'Page write access is required',
      );
      return;
    }
    if (await this.isCancelled(run.id)) {
      await this.cancel(run, '', '');
      return;
    }

    let content = '';
    let pendingDelta = '';
    let reasoning = '';
    let pendingReasoningDelta = '';
    let sequence = run.sequence;
    let lastFlush = Date.now();
    let lastHeartbeat = 0;
    try {
      const contextSources = await this.contexts.resolveRunContext(
        run,
        user as User,
        Math.min(
          500_000,
          Math.max(16_000, (config.contextWindow - config.maxOutputTokens) * 2),
        ),
      );
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
        assistantIdentity: this.configs.toAssistantIdentity(config),
        currentUserContent: userMessage.content,
        fileText: fileContext.text,
        fileSources: fileContext.citations,
        contextSources,
        images: fileContext.images,
        retrievalSources: retrievalOutcome.sources,
        contextWindow: config.contextWindow,
        maxOutputTokens: config.maxOutputTokens,
      });

      if (run.executionMode === 'agent') {
        await this.executeAgent({
          run,
          user: user as User,
          config,
          messages,
          contextSources,
          fileCitations: fileContext.citations,
          retrievalOutcome,
          userContent: userMessage.content,
        });
        return;
      }

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
        const pendingLength =
          pendingDelta.length + pendingReasoningDelta.length;
        if (
          pendingLength === 0 ||
          (!force && pendingLength < 1024 && Date.now() - lastFlush < 250)
        ) {
          return;
        }
        const delta = pendingDelta;
        const reasoningDelta = pendingReasoningDelta;
        pendingDelta = '';
        pendingReasoningDelta = '';
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
            .set({
              content,
              reasoning,
              status: 'streaming',
              updatedAt: new Date(),
            })
            .where('id', '=', run.assistantMessageId)
            .where('currentRunId', '=', run.id)
            .execute();
          return true;
        });
        if (!persisted) throw new AiRunCancelledError();
        sequence = nextSequence;
        this.events.emitDelta(run, sequence, delta, reasoningDelta);
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
          onReasoning: config.reasoningEnabled
            ? async (delta) => {
                reasoning += delta;
                pendingReasoningDelta += delta;
                await flush();
              }
            : undefined,
          onActivity: heartbeat,
          isCancelled: () => this.isCancelled(run.id),
        },
      );
      await flush(true);
      if (await this.isCancelled(run.id)) {
        await this.cancel(run, content, reasoning);
        return;
      }

      sequence += 1;
      const completedAt = new Date();
      const completion = await this.db.transaction().execute(async (trx) => {
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
            reasoningSnapshot: reasoning,
            updatedAt: completedAt,
          })
          .where('id', '=', run.id)
          .where('status', '=', 'running')
          .where('cancelRequestedAt', 'is', null)
          .returning('id')
          .executeTakeFirst();
        if (!updated) return { completed: false, titleRun: undefined };
        await trx
          .updateTable('aiMessages')
          .set({
            content,
            reasoning,
            status: 'completed',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            updatedAt: completedAt,
          })
          .where('id', '=', run.assistantMessageId)
          .where('currentRunId', '=', run.id)
          .execute();
        const allSources = [
          ...contextSources
            .filter((source) => source.origin === 'explicit')
            .map((source) => ({
              sourceType: source.sourceType,
              sourceId: source.sourceId,
              pageId: source.pageId,
              sourceTitle: source.sourceTitle,
              sourceUrl: source.sourceUrl,
              excerpt: source.excerpt,
              relevanceScore: null,
            })),
          ...fileContext.citations,
          ...retrievalOutcome.sources,
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
        const titleRun = await this.auxRuns.scheduleConversationTitle(
          trx,
          run,
          userMessage.content,
          Number(config.dailyTokenLimitPerSpace),
        );
        return { completed: true, titleRun };
      });
      if (!completion.completed) {
        await this.cancel(run, content, reasoning);
        return;
      }
      if (completion.titleRun) {
        await this.auxRuns.enqueue(completion.titleRun);
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
        await this.cancel(run, content, reasoning);
        return;
      }
      this.logger.warn(`AI run failed: ${run.id}`);
      await this.fail(
        run,
        content,
        reasoning,
        this.errorCode(error),
        'AI generation failed',
      );
    }
  }

  private async executeAgent(params: {
    run: AiRun;
    user: User;
    config: any;
    messages: AiProviderMessage[];
    contextSources: any[];
    fileCitations: any[];
    retrievalOutcome: {
      status: any;
      errorCode?: string;
      sources: any[];
    };
    userContent: string;
  }): Promise<void> {
    const {
      run,
      user,
      config,
      contextSources,
      fileCitations,
      retrievalOutcome,
      userContent,
    } = params;
    const definitions = this.tools.list('agent');
    const providerTools = definitions.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    const messages: AiProviderMessage[] = [
      {
        role: 'system',
        content: await this.buildAgentInstructions(run),
      },
      ...params.messages,
    ];
    const previousSteps = await this.db
      .selectFrom('aiRunSteps')
      .selectAll()
      .where('runId', '=', run.id)
      .orderBy('modelStep', 'asc')
      .orderBy('callIndex', 'asc')
      .execute();
    this.appendStepHistory(messages, previousSteps);

    // Every write approval resumes the same run, so the step and tool-call
    // budgets are counted from the last write the user decided on. The run
    // still has a hard overall ceiling that no sequence of approvals can pass.
    const segmentSteps = previousSteps.filter(
      (step) => step.modelStep >= this.lastDecidedWriteModelStep(previousSteps),
    );
    let toolCallCount = segmentSteps.length;
    let totalToolCallCount = previousSteps.length;
    let resultBytes = previousSteps.reduce(
      (sum, step) =>
        sum + Buffer.byteLength(JSON.stringify(step.result ?? {}), 'utf8'),
      0,
    );
    let usage: AiProviderUsage = {
      inputTokens: Number(run.inputTokens),
      outputTokens: Number(run.outputTokens),
    };
    let modelStep =
      previousSteps.length > 0
        ? Math.max(...previousSteps.map((step) => step.modelStep)) + 1
        : 0;
    let segmentModelStep = segmentSteps.length
      ? modelStep - Math.min(...segmentSteps.map((step) => step.modelStep))
      : 0;

    for (
      ;
      segmentModelStep < AI_AGENT_MAX_MODEL_STEPS &&
      modelStep < AI_AGENT_MAX_RUN_MODEL_STEPS;
      modelStep += 1, segmentModelStep += 1
    ) {
      if (await this.isCancelled(run.id)) {
        throw new AiRunCancelledError();
      }
      const response = await this.provider.completeWithTools(
        this.configs.toProviderConfig(config),
        messages,
        providerTools,
        'auto',
        () => this.isCancelled(run.id),
      );
      if (await this.isCancelled(run.id)) {
        throw new AiRunCancelledError();
      }
      usage = {
        inputTokens: usage.inputTokens + response.usage.inputTokens,
        outputTokens: usage.outputTokens + response.usage.outputTokens,
      };

      if (response.toolCalls.length === 0) {
        if (response.finishReason === 'tool_calls' || !response.content.trim()) {
          throw new AiAgentExecutionError(
            'agent_tool_call_required',
            'The provider did not return a valid tool call or final answer',
          );
        }
        await this.completeAgentRun({
          run,
          content: response.content,
          usage,
          contextSources,
          fileCitations,
          retrievalOutcome,
          userContent,
          dailyTokenLimitPerSpace: Number(config.dailyTokenLimitPerSpace),
        });
        return;
      }

      if (
        toolCallCount + response.toolCalls.length > AI_AGENT_MAX_TOOL_CALLS ||
        totalToolCallCount + response.toolCalls.length >
          AI_AGENT_MAX_RUN_TOOL_CALLS
      ) {
        throw new AiAgentExecutionError(
          'agent_tool_limit',
          'The agent exceeded the tool call limit',
        );
      }
      const resolvedDefinitions = response.toolCalls.map((call) =>
        this.tools.get(call.function.name, 'agent'),
      );
      if (
        resolvedDefinitions.some((tool) => tool?.writeClass === 'write') &&
        response.toolCalls.length !== 1
      ) {
        throw new AiAgentExecutionError(
          'agent_tool_call_invalid',
          'A write proposal must be the only tool call in a model turn',
        );
      }

      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls,
      });

      for (let callIndex = 0; callIndex < response.toolCalls.length; callIndex += 1) {
        const call = response.toolCalls[callIndex];
        toolCallCount += 1;
        totalToolCallCount += 1;
        let args: Record<string, unknown> = {};
        let parseError: string | null = null;
        try {
          const parsed = JSON.parse(call.function.arguments);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Tool arguments must be an object');
          }
          args = parsed as Record<string, unknown>;
        } catch {
          parseError = 'The provider returned malformed tool arguments';
        }

        const definition = resolvedDefinitions[callIndex];
        if (parseError || !definition) {
          const errorMessage =
            parseError ?? `Unknown tool: ${call.function.name}`;
          const result = { ok: false, error: errorMessage };
          const step = await this.insertToolStep({
            run,
            modelStep,
            callIndex,
            toolCallId: call.id,
            toolName: call.function.name,
            writeClass: definition?.writeClass ?? 'read_only',
            args,
            result,
            assistantContent: response.content,
            status: 'failed',
            errorCode: 'agent_tool_call_invalid',
            errorMessage,
          });
          this.events.emitStep(run, step);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
          continue;
        }

        try {
          const execution = await this.tools.execute(
            call.function.name,
            args,
            {
              user,
              workspaceId: run.workspaceId,
              spaceId: run.spaceId,
              currentPageId: run.pageId,
              source: 'agent',
            },
          );
          const bytes = Buffer.byteLength(
            JSON.stringify(execution.content),
            'utf8',
          );
          resultBytes += bytes;
          if (resultBytes > AI_TOOL_RESULTS_TOTAL_MAX_BYTES) {
            throw new AiAgentExecutionError(
              'agent_result_limit',
              'The agent exceeded the cumulative tool result limit',
            );
          }

          if (execution.writeProposal) {
            await this.pauseForApproval({
              run,
              modelStep,
              callIndex,
              call,
              assistantContent: response.content,
              result: execution.content,
              proposal: execution.writeProposal,
              usage,
            });
            return;
          }

          const step = await this.insertToolStep({
            run,
            modelStep,
            callIndex,
            toolCallId: call.id,
            toolName: call.function.name,
            writeClass: 'read_only',
            args,
            result: execution.content,
            assistantContent: response.content,
            status: 'completed',
          });
          this.events.emitStep(run, step);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ ok: true, result: execution.content }),
          });
        } catch (error) {
          if (error instanceof AiAgentExecutionError) {
            throw error;
          }
          const errorMessage = this.safeToolError(error);
          const result = { ok: false, error: errorMessage };
          const step = await this.insertToolStep({
            run,
            modelStep,
            callIndex,
            toolCallId: call.id,
            toolName: call.function.name,
            writeClass: definition.writeClass,
            args,
            result,
            assistantContent: response.content,
            status: 'failed',
            errorCode: 'agent_tool_call_invalid',
            errorMessage,
          });
          this.events.emitStep(run, step);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      }
    }

    throw new AiAgentExecutionError(
      'agent_step_limit',
      'The agent exceeded the model step limit',
    );
  }

  /**
   * The first model step that belongs to the current approval segment: the
   * step right after the last write proposal the initiating user decided on.
   */
  private lastDecidedWriteModelStep(steps: AiRunStep[]): number {
    const decided = steps.filter(
      (step) =>
        step.writeClass === 'write' &&
        ['approved', 'rejected', 'expired'].includes(step.status),
    );
    return decided.length
      ? Math.max(...decided.map((step) => step.modelStep)) + 1
      : 0;
  }

  /**
   * Server-controlled agent preamble. The page identity comes from the run
   * row, never from document content, so it stays trusted instruction data.
   */
  private async buildAgentInstructions(run: AiRun): Promise<string> {
    const page = await this.db
      .selectFrom('pages')
      .select(['id', 'title'])
      .where('id', '=', run.pageId)
      .executeTakeFirst();
    const title = (page?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return [
      'You are operating in a bounded Docmost agent mode. Use tools iteratively when they improve accuracy. Read tools may inspect only authorized content. Write tools create proposals only for the current page and always require the initiating user to approve them. Call at most one write tool in a model turn. Never claim that a proposed change was applied until its tool result confirms approval.',
      `The current page ID is ${run.pageId}${title ? ` and its title is ${JSON.stringify(title)}` : ''}. Use exactly this ID whenever a tool asks for a page ID of the current page, and never invent placeholder identifiers.`,
      'To change the current page, first call getOutline with the current page ID, then pass one of the returned node identifiers to editPageText, patchNode, insertNode, or deleteNode. Use the outline item "id" when it exists, otherwise its "#index" form such as "#3". Never guess a node identifier.',
    ].join('\n\n');
  }

  private appendStepHistory(
    messages: AiProviderMessage[],
    steps: AiRunStep[],
  ): void {
    const byModelStep = new Map<number, AiRunStep[]>();
    for (const step of steps) {
      const current = byModelStep.get(step.modelStep) ?? [];
      current.push(step);
      byModelStep.set(step.modelStep, current);
    }
    for (const group of [...byModelStep.values()]) {
      messages.push({
        role: 'assistant',
        content: group[0]?.assistantContent || null,
        tool_calls: group.map((step) => ({
          id: step.toolCallId,
          type: 'function' as const,
          function: {
            name: step.toolName,
            arguments: JSON.stringify(step.arguments),
          },
        })),
      });
      for (const step of group) {
        if (step.status === 'pending_approval') {
          throw new AiAgentExecutionError(
            'agent_tool_call_invalid',
            'The run resumed with an undecided write proposal',
          );
        }
        messages.push({
          role: 'tool',
          tool_call_id: step.toolCallId,
          content: JSON.stringify({
            ok: ['completed', 'approved'].includes(step.status),
            status: step.status,
            result: step.result,
            error: step.errorMessage,
          }),
        });
      }
    }
  }

  private async insertToolStep(params: {
    run: AiRun;
    modelStep: number;
    callIndex: number;
    toolCallId: string;
    toolName: string;
    writeClass: 'read_only' | 'write';
    args: Record<string, unknown>;
    result: unknown;
    assistantContent: string;
    status: 'completed' | 'failed';
    errorCode?: string;
    errorMessage?: string;
  }): Promise<AiRunStep> {
    const last = await this.db
      .selectFrom('aiRunSteps')
      .select((eb) => eb.fn.max<number>('sequence').as('sequence'))
      .where('runId', '=', params.run.id)
      .executeTakeFirstOrThrow();
    return this.db
      .insertInto('aiRunSteps')
      .values({
        runId: params.run.id,
        sequence: Number(last.sequence ?? -1) + 1,
        modelStep: params.modelStep,
        callIndex: params.callIndex,
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        writeClass: params.writeClass,
        arguments: params.args as any,
        result: params.result as any,
        assistantContent: params.assistantContent || null,
        status: params.status,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async pauseForApproval(params: {
    run: AiRun;
    modelStep: number;
    callIndex: number;
    call: {
      id: string;
      function: { name: string };
    };
    assistantContent: string;
    result: unknown;
    proposal: {
      pageId: string;
      baseContentHash: string;
      expectedAfterHash: string;
      operation: Record<string, unknown> & { kind: string };
    };
    usage: AiProviderUsage;
  }): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + AI_WRITE_PROPOSAL_TTL_MS);
    const result = await this.db.transaction().execute(async (trx) => {
      const last = await trx
        .selectFrom('aiRunSteps')
        .select((eb) => eb.fn.max<number>('sequence').as('sequence'))
        .where('runId', '=', params.run.id)
        .executeTakeFirstOrThrow();
      const step = await trx
        .insertInto('aiRunSteps')
        .values({
          runId: params.run.id,
          sequence: Number(last.sequence ?? -1) + 1,
          modelStep: params.modelStep,
          callIndex: params.callIndex,
          toolCallId: params.call.id,
          toolName: params.call.function.name,
          writeClass: 'write',
          arguments: this.writeProposalArguments(params.proposal) as any,
          result: this.writeProposalResult(params.result, params.proposal) as any,
          assistantContent: params.assistantContent || null,
          status: 'pending_approval',
          targetPageId: params.proposal.pageId,
          baseContentHash: params.proposal.baseContentHash,
          expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const updated = await trx
        .updateTable('aiRuns')
        .set({
          status: 'awaiting_approval',
          sequence: sql`sequence + 1`,
          inputTokens: params.usage.inputTokens,
          outputTokens: params.usage.outputTokens,
          heartbeatAt: now,
          updatedAt: now,
        })
        .where('id', '=', params.run.id)
        .where('status', '=', 'running')
        .where('cancelRequestedAt', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw new AiRunCancelledError();
      return { step, run: updated };
    });
    this.events.emitStep(result.run, result.step);
    this.events.emitStatus(
      result.run,
      result.run.sequence,
      'awaiting_approval',
    );
  }

  private writeProposalArguments(proposal: {
    pageId: string;
    operation: Record<string, unknown> & { kind: string };
  }): Record<string, unknown> {
    const { kind: _kind, ...operationArguments } = proposal.operation;
    return { pageId: proposal.pageId, ...operationArguments };
  }

  private writeProposalResult(
    result: unknown,
    proposal: { expectedAfterHash: string },
  ): Record<string, unknown> {
    const record =
      result && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : { value: result };
    return {
      ...record,
      expectedAfterHash: proposal.expectedAfterHash,
    };
  }

  private async completeAgentRun(params: {
    run: AiRun;
    content: string;
    usage: AiProviderUsage;
    contextSources: any[];
    fileCitations: any[];
    retrievalOutcome: {
      status: any;
      errorCode?: string;
      sources: any[];
    };
    userContent: string;
    dailyTokenLimitPerSpace: number;
  }): Promise<void> {
    const completedAt = new Date();
    const completion = await this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('aiRuns')
        .set({
          status: 'completed',
          sequence: sql`sequence + 1`,
          completedAt,
          heartbeatAt: completedAt,
          finishReason: 'stop',
          inputTokens: params.usage.inputTokens,
          outputTokens: params.usage.outputTokens,
          responseSnapshot: params.content,
          reasoningSnapshot: '',
          updatedAt: completedAt,
        })
        .where('id', '=', params.run.id)
        .where('status', '=', 'running')
        .where('cancelRequestedAt', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!updated) return { run: undefined, titleRun: undefined };
      await trx
        .updateTable('aiMessages')
        .set({
          content: params.content,
          reasoning: '',
          status: 'completed',
          inputTokens: params.usage.inputTokens,
          outputTokens: params.usage.outputTokens,
          updatedAt: completedAt,
        })
        .where('id', '=', params.run.assistantMessageId)
        .where('currentRunId', '=', params.run.id)
        .execute();
      const allSources = [
        ...params.contextSources
          .filter((source) => source.origin === 'explicit')
          .map((source) => ({
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            pageId: source.pageId,
            sourceTitle: source.sourceTitle,
            sourceUrl: source.sourceUrl,
            excerpt: source.excerpt,
            relevanceScore: null,
          })),
        ...params.fileCitations,
        ...params.retrievalOutcome.sources,
      ];
      if (allSources.length > 0) {
        await trx
          .insertInto('aiMessageSources')
          .values(
            allSources.map((source, position) => ({
              runId: params.run.id,
              messageId: params.run.assistantMessageId,
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
      const titleRun = await this.auxRuns.scheduleConversationTitle(
        trx,
        params.run,
        params.userContent,
        params.dailyTokenLimitPerSpace,
      );
      return { run: updated, titleRun };
    });
    if (!completion.run) {
      throw new AiRunCancelledError();
    }
    if (completion.titleRun) {
      await this.auxRuns.enqueue(completion.titleRun);
    }
    this.events.emitStatus(
      completion.run,
      completion.run.sequence,
      'completed',
      {
        finishReason: 'stop',
        retrievalOutcome: params.retrievalOutcome.status,
        retrievalErrorCode: params.retrievalOutcome.errorCode,
      },
    );
  }

  private safeToolError(error: unknown): string {
    const message =
      (error as any)?.response?.message ??
      (error as Error)?.message ??
      'Tool execution failed';
    return String(message).slice(0, 500);
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
    return !row || row.status === 'cancelled' || Boolean(row.cancelRequestedAt);
  }

  private async cancel(
    run: AiRun,
    content: string,
    reasoning: string,
  ): Promise<void> {
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
          reasoningSnapshot: reasoning,
          updatedAt: now,
        })
        .where('id', '=', run.id)
        .where('status', '=', 'running')
        .returningAll()
        .executeTakeFirst();
      if (!updated) return undefined;
      await trx
        .updateTable('aiMessages')
        .set({ content, reasoning, status: 'cancelled', updatedAt: now })
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
    reasoning: string,
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
          reasoningSnapshot: reasoning,
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
          reasoning,
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
      await this.cancel(run, content, reasoning);
    }
  }

  private errorCode(error: unknown): string {
    if (error instanceof AiAgentExecutionError) {
      return error.code;
    }
    const responseCode = (error as any)?.response?.code;
    if (typeof responseCode === 'string') {
      return responseCode;
    }
    if ((error as any)?.aiErrorCode === 'provider_invalid_response') {
      return 'provider_invalid_response';
    }
    const status = Number((error as any)?.status);
    if (status === 504) return 'provider_timeout';
    if (status === 400) return 'provider_url_rejected';
    return 'provider_unavailable';
  }
}
