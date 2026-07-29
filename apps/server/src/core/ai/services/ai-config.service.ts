import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AiSpaceConfig as AiSpaceConfigEntity,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import {
  AiAvailability,
  AiQuickCommand,
  AiRetrievalAdapter,
  AiSpaceConfig,
} from '@docmost/api-contract';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../../page-access/page-access.service';
import {
  decryptProtectedValue,
  encryptProtectedValue,
} from '../../../common/security/credential-protection.util';
import { TestAiSpaceConfigDto, UpdateAiSpaceConfigDto } from '../dto/ai.dto';
import { AI_DEFAULTS, AI_RETRIEVAL_DEFAULTS } from '../ai.constants';
import { AiProviderConfig, AiRetrievalConfig } from '../ai.types';
import { AiProviderUrlPolicyService } from './ai-provider-url-policy.service';
import { OpenAiCompatibleProviderService } from './openai-compatible-provider.service';
import { AiRetrievalService } from '../retrieval/ai-retrieval.service';
import { AiRetrievalUrlPolicyService } from './ai-retrieval-url-policy.service';
import { v7 as uuidv7 } from 'uuid';
import { sql } from 'kysely';
import { JsonValue } from '../../../database/types/db';

@Injectable()
export class AiConfigService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly urlPolicy: AiProviderUrlPolicyService,
    private readonly retrievalUrlPolicy: AiRetrievalUrlPolicyService,
    private readonly provider: OpenAiCompatibleProviderService,
    private readonly retrievalService: AiRetrievalService,
  ) {}

  async getAdminConfig(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiSpaceConfig | null> {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    const config = await this.getRawConfig(spaceId, workspace.id);
    return config ? this.toPublicConfig(config) : null;
  }

  async getStatus(
    spaceId: string,
    pageId: string | undefined,
    user: User,
    workspace: Workspace,
  ): Promise<
    AiAvailability & {
      usage?: {
        requestsToday: number;
        tokensToday: number;
        activeRuns: number;
      };
    }
  > {
    const config = await this.getRawConfig(spaceId, workspace.id);
    let canManage = false;
    try {
      await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
      canManage = true;
    } catch {
      canManage = false;
    }
    if (!pageId && !canManage) {
      throw new NotFoundException('AI status not found');
    }
    let canWrite = false;
    let pageUnavailable = false;
    if (pageId) {
      const page = await this.pageRepo.findById(pageId);
      if (
        !page ||
        page.deletedAt ||
        page.workspaceId !== workspace.id ||
        page.spaceId !== spaceId
      ) {
        if (!canManage) {
          throw new NotFoundException('Page not found');
        }
        pageUnavailable = true;
      } else {
        const access = await this.pageAccessService.getEffectiveAccess(
          page,
          user,
        );
        canWrite = access.capabilities.canWrite;
      }
    }

    const configured = Boolean(config?.baseUrl && config?.chatModel);
    const enabled = Boolean(config?.enabled);
    const canUse =
      enabled &&
      configured &&
      !pageUnavailable &&
      (pageId ? canWrite : canManage);
    const retrieval = config ? this.toRetrievalConfig(config) : null;
    let usage:
      | {
          requestsToday: number;
          tokensToday: number;
          activeRuns: number;
        }
      | undefined;
    if (canManage) {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const [daily, active] = await Promise.all([
        this.db
          .selectFrom('aiRuns')
          .select((eb) => [
            eb.fn.countAll<number>().as('requests'),
            sql<number>`coalesce(sum(input_tokens + output_tokens), 0)`.as(
              'tokens',
            ),
          ])
          .where('workspaceId', '=', workspace.id)
          .where('spaceId', '=', spaceId)
          .where('createdAt', '>=', dayStart)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('aiRuns')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('workspaceId', '=', workspace.id)
          .where('spaceId', '=', spaceId)
          .where('status', 'in', ['queued', 'running'])
          .executeTakeFirstOrThrow(),
      ]);
      usage = {
        requestsToday: Number(daily.requests),
        tokensToday: Number(daily.tokens),
        activeRuns: Number(active.count),
      };
    }

    return {
      enabled,
      configured,
      canUse,
      canManage,
      retrievalAvailable: Boolean(
        retrieval && this.isRetrievalConfigured(retrieval),
      ),
      quickCommands: this.publicQuickCommands(config?.quickCommands),
      ...(usage ? { usage } : {}),
      ...(!configured
        ? { unavailableReason: 'not_configured' }
        : !enabled
          ? { unavailableReason: 'disabled' }
          : pageUnavailable
            ? { unavailableReason: 'page_unavailable' }
            : pageId && !canWrite
              ? { unavailableReason: 'page_write_required' }
              : {}),
    };
  }

  async updateConfig(
    spaceId: string,
    dto: UpdateAiSpaceConfigDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiSpaceConfig> {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    await this.assertSpaceInWorkspace(spaceId, workspace.id);

    if (dto.apiKey && dto.clearApiKey) {
      throw new BadRequestException(
        'apiKey and clearApiKey cannot be used together',
      );
    }
    if (dto.retrieval?.apiKey && dto.retrieval.clearApiKey) {
      throw new BadRequestException(
        'retrieval.apiKey and retrieval.clearApiKey cannot be used together',
      );
    }
    if (
      dto.retrieval?.openWebUi?.apiKey &&
      dto.retrieval.openWebUi.clearApiKey
    ) {
      throw new BadRequestException(
        'retrieval.openWebUi.apiKey and clearApiKey cannot be used together',
      );
    }

    const saved = await this.db.transaction().execute(async (trx) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`ai-config:${spaceId}`}, 0)
        )
      `.execute(trx);
      const existing = await trx
        .selectFrom('aiSpaceConfigs')
        .selectAll()
        .where('spaceId', '=', spaceId)
        .where('workspaceId', '=', workspace.id)
        .executeTakeFirst();
      const baseUrl = dto.baseUrl?.trim() || existing?.baseUrl;
      const chatModel = dto.chatModel?.trim() || existing?.chatModel;
      if (!baseUrl || !chatModel) {
        throw new BadRequestException(
          'baseUrl and chatModel are required for AI configuration',
        );
      }
      const normalizedBaseUrl = await this.normalizeUrl(baseUrl);
      const retrievalAdapter =
        dto.retrieval?.adapter ??
        (existing?.retrievalAdapter as AiRetrievalAdapter) ??
        'none';
      const retrievalUrl =
        dto.retrieval?.url === null
          ? null
          : dto.retrieval?.url?.trim() || existing?.retrievalUrl || null;
      if (retrievalAdapter === 'http-json-v1' && !retrievalUrl) {
        throw new BadRequestException(
          'retrieval.url is required for http-json-v1',
        );
      }
      const normalizedRetrievalUrl =
        retrievalUrl &&
        (retrievalAdapter === 'http-json-v1' ||
          dto.retrieval?.url !== undefined)
          ? (
              await this.retrievalUrlPolicy.assertAllowed(retrievalUrl)
            ).toString()
          : retrievalUrl;
      const openWebUiBaseUrl =
        dto.retrieval?.openWebUi?.baseUrl === null
          ? null
          : dto.retrieval?.openWebUi?.baseUrl?.trim() ||
            existing?.retrievalOpenWebuiBaseUrl ||
            null;
      const openWebUiKnowledgeId =
        dto.retrieval?.openWebUi?.knowledgeId === null
          ? null
          : dto.retrieval?.openWebUi?.knowledgeId?.trim() ||
            existing?.retrievalOpenWebuiKnowledgeId ||
            null;
      if (
        retrievalAdapter === 'open-webui-knowledge-v1' &&
        (!openWebUiBaseUrl || !openWebUiKnowledgeId)
      ) {
        throw new BadRequestException(
          'retrieval.openWebUi baseUrl and knowledgeId are required',
        );
      }
      const normalizedOpenWebUiBaseUrl =
        openWebUiBaseUrl &&
        (retrievalAdapter === 'open-webui-knowledge-v1' ||
          dto.retrieval?.openWebUi?.baseUrl !== undefined)
          ? (
              await this.retrievalUrlPolicy.assertBaseAllowed(
                openWebUiBaseUrl,
              )
            )
              .toString()
              .replace(/\/+$/, '')
          : openWebUiBaseUrl;
      const values = {
        workspaceId: workspace.id,
        spaceId,
        enabled: dto.enabled ?? existing?.enabled ?? false,
        provider: 'openai-compatible',
        baseUrl: normalizedBaseUrl,
        chatModel,
        apiKeyEncrypted: this.updateEncryptedSecret({
          existing: existing?.apiKeyEncrypted,
          next: dto.apiKey,
          clear: dto.clearApiKey,
        }),
        retrievalAdapter,
        retrievalUrl: normalizedRetrievalUrl,
        retrievalApiKeyEncrypted: this.updateEncryptedSecret({
          existing: existing?.retrievalApiKeyEncrypted,
          next: dto.retrieval?.apiKey,
          clear: dto.retrieval?.clearApiKey,
        }),
        retrievalOpenWebuiBaseUrl: normalizedOpenWebUiBaseUrl,
        retrievalOpenWebuiKnowledgeId: openWebUiKnowledgeId,
        retrievalOpenWebuiApiKeyEncrypted: this.updateEncryptedSecret({
          existing: existing?.retrievalOpenWebuiApiKeyEncrypted,
          next: dto.retrieval?.openWebUi?.apiKey,
          clear: dto.retrieval?.openWebUi?.clearApiKey,
        }),
        retrievalTimeoutMs:
          dto.retrieval?.timeoutMs ??
          existing?.retrievalTimeoutMs ??
          AI_RETRIEVAL_DEFAULTS.timeoutMs,
        retrievalMaxResults:
          dto.retrieval?.maxResults ??
          existing?.retrievalMaxResults ??
          AI_RETRIEVAL_DEFAULTS.topK,
        systemInstructions:
          dto.systemInstructions !== undefined
            ? dto.systemInstructions?.trim() || null
            : existing?.systemInstructions || null,
        temperature:
          dto.temperature ?? existing?.temperature ?? AI_DEFAULTS.temperature,
        maxOutputTokens:
          dto.maxOutputTokens ??
          existing?.maxOutputTokens ??
          AI_DEFAULTS.maxOutputTokens,
        contextWindow:
          dto.contextWindow ??
          existing?.contextWindow ??
          AI_DEFAULTS.contextWindow,
        requestTimeoutMs:
          dto.requestTimeoutMs ??
          existing?.requestTimeoutMs ??
          AI_DEFAULTS.requestTimeoutMs,
        dailyRequestLimitPerUser:
          dto.dailyRequestLimitPerUser ??
          existing?.dailyRequestLimitPerUser ??
          AI_DEFAULTS.dailyRequestLimitPerUser,
        dailyTokenLimitPerSpace:
          dto.dailyTokenLimitPerSpace ??
          this.finiteNumber(
            existing?.dailyTokenLimitPerSpace,
            AI_DEFAULTS.dailyTokenLimitPerSpace,
          ),
        retentionDays:
          dto.retentionDays ??
          existing?.retentionDays ??
          AI_DEFAULTS.retentionDays,
        visionEnabled: dto.visionEnabled ?? existing?.visionEnabled ?? false,
        reasoningEnabled:
          dto.reasoningEnabled ?? existing?.reasoningEnabled ?? false,
        quickCommands:
          dto.quickCommands !== undefined
            ? (this.normalizeQuickCommands(
                dto.quickCommands,
              ) as unknown as JsonValue)
            : (existing?.quickCommands ?? null),
        updatedById: user.id,
        updatedAt: new Date(),
      };
      this.assertGenerationLimits(values.maxOutputTokens, values.contextWindow);
      return existing
        ? trx
            .updateTable('aiSpaceConfigs')
            .set(values)
            .where('id', '=', existing.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : trx
            .insertInto('aiSpaceConfigs')
            .values({ ...values, createdById: user.id })
            .returningAll()
            .executeTakeFirstOrThrow();
    });

    return this.toPublicConfig(saved);
  }

  async testModel(
    spaceId: string,
    dto: TestAiSpaceConfigDto,
    user: User,
    workspace: Workspace,
  ) {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    const existing = await this.getRawConfig(spaceId, workspace.id);
    this.assertGenerationLimits(
      dto.maxOutputTokens ??
        existing?.maxOutputTokens ??
        AI_DEFAULTS.maxOutputTokens,
      dto.contextWindow ?? existing?.contextWindow ?? AI_DEFAULTS.contextWindow,
    );
    const config = await this.mergeProviderConfig(existing, dto);
    const startedAt = Date.now();
    let models: string[] = [];
    let modelsAvailable = true;
    try {
      models = await this.provider.listModels(config);
    } catch {
      modelsAvailable = false;
    }
    const completion = await this.provider.complete(
      { ...config, maxOutputTokens: Math.min(config.maxOutputTokens, 512) },
      [{ role: 'user', content: 'Reply with OK.' }],
    );

    let vision = false;
    if (dto.visionEnabled ?? existing?.visionEnabled) {
      const result = await this.provider.complete(
        { ...config, maxOutputTokens: Math.min(config.maxOutputTokens, 512) },
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Reply with OK.' },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                  detail: 'low',
                },
              },
            ],
          },
        ],
      );
      vision = Boolean(result.content);
    }

    return {
      ok: Boolean(completion.content),
      models,
      modelsAvailable,
      chatModelAvailable:
        !modelsAvailable ||
        models.length === 0 ||
        models.includes(config.chatModel),
      vision,
      latencyMs: Date.now() - startedAt,
    };
  }

  async testRetrieval(
    spaceId: string,
    dto: TestAiSpaceConfigDto,
    user: User,
    workspace: Workspace,
  ) {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    const existing = await this.getRawConfig(spaceId, workspace.id);
    const config = await this.mergeRetrievalConfig(existing, dto);
    if (config.adapter === 'none') {
      return { ok: true, skipped: true, latencyMs: 0 };
    }
    const page = await this.db
      .selectFrom('pages')
      .select('id')
      .where('workspaceId', '=', workspace.id)
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (!page) {
      throw new BadRequestException(
        'At least one page is required to test retrieval',
      );
    }
    return this.retrievalService.test(config, {
      schemaVersion: 1,
      requestId: uuidv7(),
      workspaceId: workspace.id,
      spaceId,
      pageId: page.id,
      query: 'Docmost retrieval connection test',
      allowedPageIds: [page.id],
      sourceTypes: ['page', 'database_row', 'attachment'],
      limit: Math.min(config.maxResults, 3),
      candidateLimit: AI_RETRIEVAL_DEFAULTS.candidateLimit,
    });
  }

  async getRawConfig(
    spaceId: string,
    workspaceId: string,
  ): Promise<AiSpaceConfigEntity | undefined> {
    const aiDb = this.db as any;
    let query = aiDb
      .selectFrom('aiSpaceConfigs')
      .selectAll()
      .where('spaceId', '=', spaceId);
    query = query.where('workspaceId', '=', workspaceId);
    return query.executeTakeFirst();
  }

  toProviderConfig(config: AiSpaceConfigEntity): AiProviderConfig {
    return {
      baseUrl: config.baseUrl,
      apiKey: this.decryptSecret(config.apiKeyEncrypted),
      chatModel: config.chatModel,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      requestTimeoutMs: config.requestTimeoutMs,
    };
  }

  toRetrievalConfig(config: AiSpaceConfigEntity): AiRetrievalConfig {
    return {
      adapter: config.retrievalAdapter as AiRetrievalAdapter,
      url: config.retrievalUrl,
      apiKey: this.decryptSecret(config.retrievalApiKeyEncrypted),
      openWebUiBaseUrl: config.retrievalOpenWebuiBaseUrl,
      openWebUiKnowledgeId: config.retrievalOpenWebuiKnowledgeId,
      openWebUiApiKey: this.decryptSecret(
        config.retrievalOpenWebuiApiKeyEncrypted,
      ),
      timeoutMs: config.retrievalTimeoutMs,
      maxResults: config.retrievalMaxResults,
    };
  }

  private async mergeProviderConfig(
    existing: AiSpaceConfigEntity | undefined,
    dto: TestAiSpaceConfigDto,
  ): Promise<AiProviderConfig> {
    const baseUrl = dto.baseUrl?.trim() || existing?.baseUrl;
    const chatModel = dto.chatModel?.trim() || existing?.chatModel;
    if (!baseUrl || !chatModel) {
      throw new BadRequestException(
        'baseUrl and chatModel are required for connection test',
      );
    }
    return {
      baseUrl: await this.normalizeUrl(baseUrl),
      apiKey: dto.clearApiKey
        ? null
        : dto.apiKey || this.decryptSecret(existing?.apiKeyEncrypted),
      chatModel,
      temperature:
        dto.temperature ?? existing?.temperature ?? AI_DEFAULTS.temperature,
      maxOutputTokens:
        dto.maxOutputTokens ??
        existing?.maxOutputTokens ??
        AI_DEFAULTS.maxOutputTokens,
      requestTimeoutMs:
        dto.requestTimeoutMs ??
        existing?.requestTimeoutMs ??
        AI_DEFAULTS.requestTimeoutMs,
    };
  }

  private async mergeRetrievalConfig(
    existing: AiSpaceConfigEntity | undefined,
    dto: TestAiSpaceConfigDto,
  ): Promise<AiRetrievalConfig> {
    const adapter =
      dto.retrieval?.adapter ??
      (existing?.retrievalAdapter as AiRetrievalAdapter) ??
      'none';
    const rawUrl =
      dto.retrieval?.url === null
        ? null
        : dto.retrieval?.url?.trim() || existing?.retrievalUrl || null;
    if (adapter === 'http-json-v1' && !rawUrl) {
      throw new BadRequestException('retrieval.url is required');
    }
    const rawOpenWebUiBaseUrl =
      dto.retrieval?.openWebUi?.baseUrl === null
        ? null
        : dto.retrieval?.openWebUi?.baseUrl?.trim() ||
          existing?.retrievalOpenWebuiBaseUrl ||
          null;
    const openWebUiKnowledgeId =
      dto.retrieval?.openWebUi?.knowledgeId === null
        ? null
        : dto.retrieval?.openWebUi?.knowledgeId?.trim() ||
          existing?.retrievalOpenWebuiKnowledgeId ||
          null;
    if (
      adapter === 'open-webui-knowledge-v1' &&
      (!rawOpenWebUiBaseUrl || !openWebUiKnowledgeId)
    ) {
      throw new BadRequestException(
        'retrieval.openWebUi baseUrl and knowledgeId are required',
      );
    }
    return {
      adapter,
      url:
        rawUrl &&
        (adapter === 'http-json-v1' ||
          dto.retrieval?.url !== undefined)
          ? (await this.retrievalUrlPolicy.assertAllowed(rawUrl)).toString()
          : rawUrl,
      apiKey: dto.retrieval?.clearApiKey
        ? null
        : dto.retrieval?.apiKey ||
          this.decryptSecret(existing?.retrievalApiKeyEncrypted),
      openWebUiBaseUrl:
        rawOpenWebUiBaseUrl &&
        (adapter === 'open-webui-knowledge-v1' ||
          dto.retrieval?.openWebUi?.baseUrl !== undefined)
          ? (
              await this.retrievalUrlPolicy.assertBaseAllowed(
                rawOpenWebUiBaseUrl,
              )
            )
              .toString()
              .replace(/\/+$/, '')
          : rawOpenWebUiBaseUrl,
      openWebUiKnowledgeId,
      openWebUiApiKey: dto.retrieval?.openWebUi?.clearApiKey
        ? null
        : dto.retrieval?.openWebUi?.apiKey ||
          this.decryptSecret(existing?.retrievalOpenWebuiApiKeyEncrypted),
      timeoutMs:
        dto.retrieval?.timeoutMs ??
        existing?.retrievalTimeoutMs ??
        AI_RETRIEVAL_DEFAULTS.timeoutMs,
      maxResults:
        dto.retrieval?.maxResults ??
        existing?.retrievalMaxResults ??
        AI_RETRIEVAL_DEFAULTS.topK,
    };
  }

  private async normalizeUrl(value: string): Promise<string> {
    return (await this.urlPolicy.assertAllowed(value))
      .toString()
      .replace(/\/+$/, '');
  }

  private updateEncryptedSecret(params: {
    existing?: string | null;
    next?: string;
    clear?: boolean;
  }): string | null {
    if (params.clear) {
      return null;
    }
    if (!params.next) {
      return params.existing ?? null;
    }
    return encryptProtectedValue(
      params.next,
      this.environmentService.getAppSecret(),
    );
  }

  private decryptSecret(value?: string | null): string | null {
    return value
      ? decryptProtectedValue(value, this.environmentService.getAppSecret())
      : null;
  }

  private finiteNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private isRetrievalConfigured(config: AiRetrievalConfig): boolean {
    if (config.adapter === 'http-json-v1') {
      return Boolean(config.url);
    }
    if (config.adapter === 'open-webui-knowledge-v1') {
      return Boolean(
        config.openWebUiBaseUrl &&
          config.openWebUiKnowledgeId &&
          config.openWebUiApiKey,
      );
    }
    return false;
  }

  private assertGenerationLimits(
    maxOutputTokens: number,
    contextWindow: number,
  ): void {
    if (maxOutputTokens > contextWindow - 1024) {
      throw new BadRequestException(
        'maxOutputTokens must leave at least 1024 tokens for input context',
      );
    }
  }

  private async assertSpaceInWorkspace(
    spaceId: string,
    workspaceId: string,
  ): Promise<void> {
    const space = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!space) {
      throw new NotFoundException('Space not found');
    }
  }

  private normalizeQuickCommands(
    commands: UpdateAiSpaceConfigDto['quickCommands'],
  ): AiQuickCommand[] | null {
    if (!commands) {
      return null;
    }
    const ids = new Set<string>();
    return commands.map((command, index) => {
      const label = command.label.trim();
      const prompt = command.prompt.trim();
      const description = command.description?.trim() || undefined;
      if (!label || !prompt) {
        throw new BadRequestException(
          'Quick command label and prompt cannot be empty',
        );
      }
      if (ids.has(command.id)) {
        throw new BadRequestException('Quick command ids must be unique');
      }
      ids.add(command.id);
      return {
        id: command.id,
        label,
        prompt,
        ...(description ? { description } : {}),
        enabled: command.enabled ?? true,
        position: index,
      };
    });
  }

  private publicQuickCommands(value: unknown): AiQuickCommand[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is AiQuickCommand =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as any).id === 'string' &&
            typeof (item as any).label === 'string' &&
            typeof (item as any).prompt === 'string' &&
            (item as any).enabled === true,
        ),
      )
      .map((item) => ({
        id: item.id,
        label: item.label,
        prompt: item.prompt,
        ...(typeof item.description === 'string' && item.description.trim()
          ? { description: item.description.trim() }
          : {}),
        enabled: true,
        position: Number.isFinite(item.position) ? item.position : 0,
      }))
      .sort((left, right) => left.position - right.position);
  }

  private toPublicConfig(config: AiSpaceConfigEntity): AiSpaceConfig {
    return {
      id: config.id,
      workspaceId: config.workspaceId,
      spaceId: config.spaceId,
      enabled: config.enabled,
      provider: config.provider as 'openai-compatible',
      baseUrl: config.baseUrl,
      chatModel: config.chatModel,
      apiKeyConfigured: Boolean(config.apiKeyEncrypted),
      retrieval: {
        adapter: config.retrievalAdapter as AiRetrievalAdapter,
        url: config.retrievalUrl,
        apiKeyConfigured: Boolean(config.retrievalApiKeyEncrypted),
        timeoutMs: config.retrievalTimeoutMs,
        maxResults: config.retrievalMaxResults,
        openWebUi: {
          baseUrl: config.retrievalOpenWebuiBaseUrl,
          knowledgeId: config.retrievalOpenWebuiKnowledgeId,
          apiKeyConfigured: Boolean(
            config.retrievalOpenWebuiApiKeyEncrypted,
          ),
        },
      },
      systemInstructions: config.systemInstructions,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      contextWindow: config.contextWindow,
      requestTimeoutMs: config.requestTimeoutMs,
      dailyRequestLimitPerUser: config.dailyRequestLimitPerUser,
      dailyTokenLimitPerSpace: Number(config.dailyTokenLimitPerSpace),
      retentionDays: config.retentionDays,
      visionEnabled: config.visionEnabled,
      reasoningEnabled: config.reasoningEnabled,
      quickCommands: config.quickCommands as unknown as AiQuickCommand[] | null,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}
