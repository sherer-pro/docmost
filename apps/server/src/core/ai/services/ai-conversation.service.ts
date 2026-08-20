import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AiConversation as AiConversationEntity,
  Page,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import {
  AiAssistantProfileSnapshot,
  AiCitation,
  AiConversation,
  AiMessage,
} from '@docmost/api-contract';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../../page-access/page-access.service';
import {
  AiMessagesQueryDto,
  CreateAiConversationDto,
  UpdateAiConversationDto,
} from '../dto/ai.dto';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { AiRunEventService } from './ai-run-event.service';
import { AiConfigService } from './ai-config.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';
import { AiAssistantProfileService } from './ai-assistant-profile.service';
import { AiSourceAccessService } from './ai-source-access.service';

@Injectable()
export class AiConversationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly runEvents: AiRunEventService,
    private readonly configService: AiConfigService,
    private readonly contentPolicy: AiContentPolicyService,
    private readonly profiles: AiAssistantProfileService,
    private readonly sourceAccess: AiSourceAccessService,
  ) {}

  async list(pageId: string, user: User, workspace: Workspace) {
    const page = await this.assertReadablePage(pageId, user, workspace.id);
    const access = await this.pageAccessService.getEffectiveAccess(page, user);
    let query = this.db
      .selectFrom('aiConversations')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null);
    if (!access.capabilities.canWrite) {
      query = query.where('agentMode', '=', true);
    }
    const rows = await query.orderBy('lastOpenedAt', 'desc').execute();
    return {
      items: await Promise.all(
        rows.map((row) => this.toConversation(row, user.id, workspace.id)),
      ),
    };
  }

  async create(dto: CreateAiConversationDto, user: User, workspace: Workspace) {
    const agentMode = dto.agentMode ?? false;
    const page = agentMode
      ? await this.assertAgentPage(dto.pageId, user, workspace)
      : await this.assertWritablePage(dto.pageId, user, workspace.id);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          pageId: page.id,
          title: dto.title?.trim() || null,
          useSpaceSearch: dto.useSpaceSearch ?? false,
          agentMode,
          assistantProfileId: dto.assistantProfileId,
        }),
      )
      .digest('hex');
    const contextFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          includeCurrentDocument: true,
          sources: [],
          fileIds: [],
          attachmentIds: [],
        }),
      )
      .digest('hex');
    const row = await this.db.transaction().execute(async (trx) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(
            ${`ai-conversation-request:${workspace.id}:${user.id}:${dto.clientRequestId}`},
            0
          )
        )
      `.execute(trx);
      const existing = await trx
        .selectFrom('aiConversations')
        .selectAll()
        .where('workspaceId', '=', workspace.id)
        .where('userId', '=', user.id)
        .where('clientRequestId', '=', dto.clientRequestId)
        .executeTakeFirst();
      if (existing) {
        if (
          existing.requestFingerprint &&
          existing.requestFingerprint !== fingerprint
        ) {
          throw new ConflictException({
            code: 'idempotency_key_reused',
            message: 'The idempotency key was already used for another request',
          });
        }
        return existing;
      }
      const resolvedProfile = await this.profiles.resolveConversationSnapshot(
        trx,
        {
          workspaceId: workspace.id,
          spaceId: page.spaceId,
          userId: user.id,
          assistantProfileId: dto.assistantProfileId,
        },
      );
      if (agentMode) {
        const config = await trx
          .selectFrom('aiSpaceConfigs')
          .selectAll()
          .where('spaceId', '=', page.spaceId)
          .where('workspaceId', '=', workspace.id)
          .executeTakeFirst();
        if (!config) {
          throw new BadRequestException('Configure AI for this space first');
        }
        if (resolvedProfile.snapshot.source === 'assistant_profile') {
          await this.profiles.assertProfileAgentAvailable(
            resolvedProfile.snapshot,
            config,
            user.id,
            trx,
          );
        } else {
          this.assertLegacyAgentConfig(config);
        }
      }
      return trx
        .insertInto('aiConversations')
        .values({
          workspaceId: workspace.id,
          spaceId: page.spaceId,
          pageId: page.id,
          userId: user.id,
          clientRequestId: dto.clientRequestId,
          requestFingerprint: fingerprint,
          title: dto.title?.trim() || null,
          titleSource: dto.title?.trim() ? 'manual' : null,
          useSpaceSearch: dto.useSpaceSearch ?? false,
          agentMode,
          contextFingerprint,
          assistantProfileId: resolvedProfile.snapshot.profileId,
          assistantProfileVersion: resolvedProfile.snapshot.profileVersion,
          assistantProfileSnapshot: resolvedProfile.snapshot as never,
          assistantProfileFingerprint: resolvedProfile.fingerprint,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return this.toConversation(row, user.id, workspace.id);
  }

  async get(id: string, user: User, workspace: Workspace) {
    return this.toConversation(
      await this.getOwnedEntity(id, user, workspace),
      user.id,
      workspace.id,
    );
  }

  async open(id: string, user: User, workspace: Workspace) {
    return this.toConversation(
      await this.getOwnedEntity(id, user, workspace, true),
      user.id,
      workspace.id,
    );
  }

  async update(
    id: string,
    dto: UpdateAiConversationDto,
    user: User,
    workspace: Workspace,
  ) {
    const conversation = await this.getOwnedEntity(id, user, workspace);
    if (dto.agentMode === true) {
      await this.assertAgentPage(conversation.pageId, user, workspace);
    } else if (dto.agentMode === false) {
      await this.assertWritablePage(conversation.pageId, user, workspace.id);
    }
    const row = await this.db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('aiConversations')
        .selectAll()
        .where('id', '=', conversation.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      let profileUpdate: Record<string, unknown> = {};
      let effectiveSnapshot = this.profiles.readSnapshot(
        locked.assistantProfileSnapshot,
        locked.assistantProfileFingerprint,
      );
      if (dto.assistantProfileId !== undefined) {
        const activity = await trx
          .selectFrom('aiMessages')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('conversationId', '=', locked.id)
          .executeTakeFirstOrThrow();
        const runActivity = await trx
          .selectFrom('aiRuns')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('conversationId', '=', locked.id)
          .executeTakeFirstOrThrow();
        if (Number(activity.count) > 0 || Number(runActivity.count) > 0) {
          throw new ConflictException({
            code: 'ai_profile_locked',
            message: 'Start a new conversation to change assistant profile',
          });
        }
        const resolved = await this.profiles.resolveConversationSnapshot(trx, {
          workspaceId: workspace.id,
          spaceId: locked.spaceId,
          userId: user.id,
          assistantProfileId: dto.assistantProfileId,
        });
        effectiveSnapshot = resolved.snapshot;
        profileUpdate = {
          assistantProfileId: resolved.snapshot.profileId,
          assistantProfileVersion: resolved.snapshot.profileVersion,
          assistantProfileSnapshot: resolved.snapshot as never,
          assistantProfileFingerprint: resolved.fingerprint,
        };
      }
      const effectiveAgentMode = dto.agentMode ?? locked.agentMode;
      if (effectiveAgentMode) {
        const snapshot = effectiveSnapshot ?? this.legacySnapshot();
        const config = await trx
          .selectFrom('aiSpaceConfigs')
          .selectAll()
          .where('spaceId', '=', locked.spaceId)
          .where('workspaceId', '=', workspace.id)
          .executeTakeFirst();
        if (!config) {
          throw new BadRequestException('Configure AI for this space first');
        }
        if (snapshot.source === 'assistant_profile') {
          await this.profiles.assertProfileAgentAvailable(
            snapshot,
            config,
            user.id,
            trx,
          );
        } else {
          this.assertLegacyAgentConfig(config);
        }
      }
      return trx
        .updateTable('aiConversations')
        .set({
          ...(dto.title !== undefined
            ? {
                title: dto.title?.trim() || null,
                titleSource: dto.title?.trim() ? 'manual' : null,
              }
            : {}),
          ...(dto.draft !== undefined ? { draft: dto.draft || null } : {}),
          ...(dto.useSpaceSearch !== undefined
            ? { useSpaceSearch: dto.useSpaceSearch }
            : {}),
          ...(dto.agentMode !== undefined ? { agentMode: dto.agentMode } : {}),
          ...profileUpdate,
          updatedAt: new Date(),
        })
        .where('id', '=', locked.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    const result = await this.toConversation(row, user.id, workspace.id);
    this.runEvents.emitConversationUpdated(result);
    return result;
  }

  async remove(id: string, user: User, workspace: Workspace) {
    const conversation = await this.db
      .selectFrom('aiConversations')
      .selectAll()
      .where('id', '=', id)
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();
    if (!conversation) {
      throw new NotFoundException('AI conversation not found');
    }
    if (conversation.deletedAt) return { success: true };

    const now = new Date();
    const cancelledRuns = await this.db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('aiConversations')
        .selectAll()
        .where('id', '=', conversation.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (locked.deletedAt) return [];
      const runs = await trx
        .updateTable('aiRuns')
        .set({
          status: 'cancelled',
          sequence: sql`sequence + 1`,
          cancelRequestedAt: now,
          completedAt: now,
          finishReason: 'cancelled',
          updatedAt: now,
        })
        .where('conversationId', '=', conversation.id)
        .where('status', 'in', ['queued', 'running', 'awaiting_approval'])
        .returningAll()
        .execute();
      await trx
        .updateTable('aiMessages')
        .set({ status: 'cancelled', updatedAt: now })
        .where('conversationId', '=', conversation.id)
        .where('status', 'in', ['pending', 'streaming'])
        .execute();
      await trx
        .updateTable('aiChatFiles')
        .set({ deletedAt: now, updatedAt: now })
        .where('conversationId', '=', conversation.id)
        .where('deletedAt', 'is', null)
        .execute();
      await trx
        .updateTable('aiConversations')
        .set({ deletedAt: now, updatedAt: now })
        .where('id', '=', conversation.id)
        .execute();
      return runs;
    });
    for (const run of cancelledRuns) {
      this.runEvents.emitStatus(run, run.sequence, 'cancelled', {
        finishReason: 'cancelled',
      });
    }
    return { success: true };
  }

  async listMessages(
    id: string,
    query: AiMessagesQueryDto,
    user: User,
    workspace: Workspace,
  ) {
    const conversation = await this.getOwnedEntity(id, user, workspace);
    let messagesQuery = this.db
      .selectFrom('aiMessages')
      .selectAll()
      .where('conversationId', '=', conversation.id)
      .where('workspaceId', '=', workspace.id)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(query.limit + 1);
    if (query.before) {
      const cursor = await this.db
        .selectFrom('aiMessages')
        .select(['id', 'createdAt'])
        .where('id', '=', query.before)
        .where('conversationId', '=', conversation.id)
        .executeTakeFirst();
      if (!cursor) {
        throw new BadRequestException('Invalid AI message cursor');
      }
      messagesQuery = messagesQuery.where((eb) =>
        eb.or([
          eb('createdAt', '<', cursor.createdAt),
          eb.and([
            eb('createdAt', '=', cursor.createdAt),
            eb('id', '<', cursor.id),
          ]),
        ]),
      );
    }
    const rows = await messagesQuery.execute();
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit).reverse();
    const currentRunIds = pageRows
      .map((row) => row.currentRunId)
      .filter(Boolean) as string[];
    const sources = currentRunIds.length
      ? await this.db
          .selectFrom('aiMessageSources')
          .selectAll()
          .where('runId', 'in', currentRunIds)
          .where('citationState', '!=', 'candidate')
          .orderBy('position', 'asc')
          .execute()
      : [];
    const runs = currentRunIds.length
      ? await this.db
          .selectFrom('aiRuns')
          .selectAll()
          .where('id', 'in', currentRunIds)
          .execute()
      : [];
    const dependencies = currentRunIds.length
      ? await this.db
          .selectFrom('aiRunSourceDependencies')
          .select(['runId', 'messageId', 'pageId'])
          .where('runId', 'in', currentRunIds)
          .execute()
      : [];
    const runByMessageId = new Map(
      runs.map((run) => [run.assistantMessageId, run]),
    );
    const sourceReferences = [
      ...sources
        .filter((source) => source.sourceType !== 'chat_file')
        .map((source) => ({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          pageId: source.pageId,
        })),
      ...dependencies.map((dependency) => ({
        sourceType: 'page',
        sourceId: dependency.pageId,
        pageId: dependency.pageId,
      })),
    ];
    const accessibleReferences = await this.sourceAccess.filterAccessible(
      sourceReferences,
      {
        user,
        workspaceId: workspace.id,
        spaceId: conversation.spaceId,
      },
    );
    const accessibleKeys = new Set(
      accessibleReferences.map((source) =>
        this.sourceAccessKey(source.sourceType, source.sourceId, source.pageId),
      ),
    );
    const chatFileSourceIds = sources
      .filter((source) => source.sourceType === 'chat_file')
      .map((source) => source.sourceId);
    const liveChatFiles = chatFileSourceIds.length
      ? await this.db
          .selectFrom('aiChatFiles')
          .select('id')
          .where('id', 'in', chatFileSourceIds)
          .where('conversationId', '=', conversation.id)
          .where('userId', '=', user.id)
          .where('workspaceId', '=', workspace.id)
          .where('status', '=', 'ready')
          .where('deletedAt', 'is', null)
          .execute()
      : [];
    const liveChatFileIds = new Set(liveChatFiles.map((file) => file.id));
    const sourcesByMessage = new Map<string, AiCitation[]>();
    const restrictedMessages = new Set<string>();
    for (const dependency of dependencies) {
      if (
        !accessibleKeys.has(
          this.sourceAccessKey('page', dependency.pageId, dependency.pageId),
        )
      ) {
        restrictedMessages.add(dependency.messageId);
      }
    }
    for (const source of sources) {
      if (
        source.sourceType === 'chat_file'
          ? !liveChatFileIds.has(source.sourceId)
          : !accessibleKeys.has(
              this.sourceAccessKey(
                source.sourceType,
                source.sourceId,
                source.pageId,
              ),
            )
      ) {
        restrictedMessages.add(source.messageId);
        continue;
      }
      const current = sourcesByMessage.get(source.messageId) ?? [];
      current.push({
        id: source.id,
        messageId: source.messageId,
        sourceType: source.sourceType as AiCitation['sourceType'],
        sourceId: source.sourceId,
        pageId: source.pageId,
        sourceTitle: source.sourceTitle,
        sourceUrl: source.sourceUrl,
        excerpt: source.excerpt,
        position: source.displayPosition ?? source.position,
        relevanceScore: source.relevanceScore,
        citationKey: source.citationKey,
        citationState: source.citationState as AiCitation['citationState'],
        sectionId: source.sectionId,
        sectionTitle: source.sectionTitle,
      });
      sourcesByMessage.set(source.messageId, current);
    }
    return {
      items: pageRows.map((row) =>
        this.toMessage(
          row,
          sourcesByMessage.get(row.id) ?? [],
          restrictedMessages.has(row.id),
          runByMessageId.get(row.id),
        ),
      ),
      hasMore,
      nextCursor: hasMore ? (pageRows[0]?.id ?? null) : null,
    };
  }

  async getOwnedEntity(
    id: string,
    user: User,
    workspace: Workspace,
    touch = false,
  ): Promise<AiConversationEntity> {
    const row = await this.db
      .selectFrom('aiConversations')
      .selectAll()
      .where('id', '=', id)
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException('AI conversation not found');
    }
    if (row.agentMode) {
      await this.assertReadablePage(row.pageId, user, workspace.id);
    } else {
      await this.assertWritablePage(row.pageId, user, workspace.id);
    }
    if (touch) {
      const now = new Date();
      await this.db
        .updateTable('aiConversations')
        .set({ lastOpenedAt: now })
        .where('id', '=', row.id)
        .execute();
      row.lastOpenedAt = now;
    }
    return row;
  }

  async assertWritablePage(
    pageId: string,
    user: User,
    workspaceId: string,
  ): Promise<Page> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt || page.workspaceId !== workspaceId) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.assertCanWritePage(page, user);
    return page;
  }

  async assertReadablePage(
    pageId: string,
    user: User,
    workspaceId: string,
  ): Promise<Page> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt || page.workspaceId !== workspaceId) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.assertCanReadPage(page, user);
    return page;
  }

  private async assertAgentPage(
    pageId: string,
    user: User,
    workspace: Workspace,
  ): Promise<Page> {
    const page = await this.assertReadablePage(pageId, user, workspace.id);
    if (
      await this.contentPolicy.isPageExcluded(
        page.id,
        page.spaceId,
        workspace.id,
      )
    ) {
      throw new BadRequestException({
        code: 'agent_disabled',
        message: 'The current page is excluded from AI access',
      });
    }
    return page;
  }

  private assertLegacyAgentConfig(
    config: Awaited<ReturnType<AiConfigService['getRawConfig']>> & {},
  ): void {
    if (!config.enabled || !config.agentEnabled) {
      throw new BadRequestException({
        code: 'agent_disabled',
        message: 'The AI agent is disabled for this space',
      });
    }
    if (
      config.agentVerifiedProviderFingerprint !==
      this.configService.getProviderFingerprint(config)
    ) {
      throw new BadRequestException({
        code: 'agent_provider_unverified',
        message: 'The current AI provider has not passed the tool calling test',
      });
    }
  }

  private sourceAccessKey(
    sourceType: string,
    sourceId: string,
    pageId: string | null,
  ): string {
    return `${sourceType}:${sourceId}:${pageId}`;
  }

  async toConversation(
    row: AiConversationEntity,
    userId: string,
    workspaceId: string,
  ): Promise<AiConversation> {
    const snapshot =
      this.profiles.readSnapshot(
        row.assistantProfileSnapshot,
        row.assistantProfileFingerprint,
      ) ?? this.legacySnapshot();
    const availability = await this.profiles.snapshotAvailability(
      snapshot,
      userId,
      workspaceId,
    );
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      spaceId: row.spaceId,
      pageId: row.pageId,
      userId: row.userId,
      clientRequestId: row.clientRequestId,
      title: row.title,
      titleSource: row.titleSource as AiConversation['titleSource'],
      draft: row.draft,
      useSpaceSearch: row.useSpaceSearch,
      agentMode: row.agentMode,
      includeCurrentDocument: row.includeCurrentDocument,
      contextRevision: row.contextRevision,
      assistantProfile: this.profiles.toConversationSummary(
        snapshot,
        availability,
      ),
      lastOpenedAt: row.lastOpenedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private legacySnapshot(): AiAssistantProfileSnapshot {
    return {
      schemaVersion: 1,
      source: 'legacy_space',
      profileId: null,
      profileVersion: null,
      display: null,
      instructions: null,
      quickCommands: null,
      chatModelOverride: null,
      temperatureOverride: null,
      maxOutputTokensOverride: null,
      allowedBuiltinCapabilities: null,
      allowedExternalTools: null,
      autoStart: false,
      launchMessage: null,
      toolPolicyFingerprint: 'legacy_space',
    };
  }

  private toMessage(
    row: any,
    sources: AiCitation[],
    accessRestricted: boolean,
    run?: any,
  ): AiMessage {
    return {
      id: row.id,
      conversationId: row.conversationId,
      userId: row.userId,
      role: row.role,
      content: accessRestricted ? '' : row.content,
      reasoning: accessRestricted ? '' : row.reasoning,
      status: row.status,
      clientRequestId: row.clientRequestId,
      currentRunId: row.currentRunId,
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      accessRestricted,
      ...(run
        ? {
            runId: run.id,
            runStatus: run.status,
            runSequence: run.sequence,
            retrievalOutcome: run.retrievalOutcome,
            retrievalErrorCode: run.retrievalErrorCode,
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
          }
        : {}),
      sources,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
