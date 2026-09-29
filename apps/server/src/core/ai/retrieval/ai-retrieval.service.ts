import {
  GatewayTimeoutException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page-access/page-access.service';
import {
  AiRetrievalConfig,
  AiRetrievalHit,
  AiRetrievalRequest,
  AiSafeRetrievalSource,
} from '../ai.types';
import { HttpJsonAiRetrievalAdapter } from './http-json-ai-retrieval.adapter';
import { NoopAiRetrievalAdapter } from './noop-ai-retrieval.adapter';
import { OpenWebUiKnowledgeRetrievalAdapter } from './open-webui-knowledge-retrieval.adapter';
import { AiOperationalMetricsService } from '../services/ai-operational-metrics.service';
import { AiContentPolicyService } from '../../ai-content-policy/ai-content-policy.service';
import {
  AiSourceAccessReference,
  AiSourceAccessService,
} from '../services/ai-source-access.service';
import { KnowledgeProjectionService } from '../../rag/knowledge-projection.service';
import { RagContentProjectorService } from '../../rag/rag-content-projector.service';
import { AiCanonicalEvidenceService } from './ai-canonical-evidence.service';
import { SearchService } from '../../search/search.service';
import { DictionarySearchService } from '../../dictionary/dictionary-search.service';
import { evidenceHash, normalizeEvidence } from '../../rag/rag-evidence.util';
import { resolveCurrentEvidence } from '../../rag/structured-knowledge.util';

export type AiRetrievalOutcome = {
  status: 'not_requested' | 'disabled' | 'used' | 'empty' | 'failed';
  errorCode?: string;
  sources: AiSafeRetrievalSource[];
  diagnostics?: {
    profile: string;
    mode: string;
    received: number;
    rejected: number;
    rejectedAcl: number;
    stale: number;
    refreshed: number;
    merged: number;
    admitted: number;
    latencyMs: number;
    degradation?: string;
    effectiveProfile?: AiRetrievalHit['effectiveProfile'];
  };
};

@Injectable()
export class AiRetrievalService {
  private readonly logger = new Logger(AiRetrievalService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageAccessService: PageAccessService,
    private readonly httpAdapter: HttpJsonAiRetrievalAdapter,
    private readonly noopAdapter: NoopAiRetrievalAdapter,
    private readonly metrics: AiOperationalMetricsService,
    private readonly openWebUiAdapter?: OpenWebUiKnowledgeRetrievalAdapter,
    @Optional()
    private readonly contentPolicy?: AiContentPolicyService,
    @Optional()
    private readonly sourceAccess?: AiSourceAccessService,
    @Optional()
    private readonly knowledgeProjection?: KnowledgeProjectionService,
    @Optional()
    private readonly contentProjectors?: RagContentProjectorService,
    @Optional() private readonly canonical?: AiCanonicalEvidenceService,
    @Optional() private readonly localSearch?: SearchService,
    @Optional() private readonly dictionarySearch?: DictionarySearchService,
  ) {}

  async assertSourcesAccessible(params: {
    sources: AiSourceAccessReference[];
    user: User;
    workspaceId: string;
    spaceId: string;
    mode?: 'default' | 'rag-search';
  }): Promise<void> {
    const mode = params.mode ?? 'rag-search';
    if (this.sourceAccess) {
      await this.sourceAccess.assertAccessible(params.sources, {
        ...params,
        mode,
      });
      return;
    }
    const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      params.user,
      params.spaceId,
    );
    const policy = this.contentPolicy
      ? mode === 'rag-search'
        ? await this.contentPolicy.getRagSearchPolicy(
            params.spaceId,
            params.workspaceId,
          )
        : {
            excludedPageIds: [
              ...(await this.contentPolicy.getExcludedPageIds(
                params.spaceId,
                params.workspaceId,
              )),
            ],
            statusBlockedPageIds: [],
          }
      : null;
    const excluded = new Set([
      ...(policy?.excludedPageIds ?? []),
      ...(policy?.statusBlockedPageIds ?? []),
    ]);
    if (
      params.sources.some(
        (source) =>
          !source.pageId ||
          !snapshot.readablePageIds.has(source.pageId) ||
          excluded.has(source.pageId),
      )
    ) {
      throw Object.assign(new Error('Source access changed'), {
        aiErrorCode: 'source_access_changed',
      });
    }
  }

  async test(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    user: User,
  ) {
    const adapter = this.getAdapter(config);
    const safeRequest = await this.withDictionarySourceType(request);
    const result = await adapter.test(config, safeRequest);
    const allowedPageIds = [
      ...(await this.currentAllowedPageIds(
        user,
        request.workspaceId,
        request.spaceId,
      )),
    ];
    const hits = await adapter.retrieve(config, {
      ...safeRequest,
      allowedPageIds,
    });
    const sources = await this.resolveSafeSources(
      hits,
      new Set(allowedPageIds),
      request.workspaceId,
      request.spaceId,
      config.maxResults,
      user,
    );

    return {
      ...result,
      validCandidateCount: sources.length,
      canary: request.canary
        ? sources.some(
            (source) =>
              source.sourceId === request.canary!.sourceId &&
              normalizeEvidence(source.excerpt).includes(
                normalizeEvidence(request.canary!.expectedText),
              ),
          )
          ? ('passed' as const)
          : ('failed' as const)
        : ('not_requested' as const),
      state: sources.length > 0 ? ('ready' as const) : ('empty' as const),
    };
  }

  async retrieveSafe(params: {
    config: AiRetrievalConfig;
    user: User;
    request: AiRetrievalRequest;
    requested: boolean;
    signal?: AbortSignal;
  }): Promise<AiRetrievalOutcome> {
    if (!params.requested) {
      return this.outcome({ status: 'not_requested', sources: [] });
    }
    const adapter = this.getAdapter(params.config);
    if (!adapter.isConfigured(params.config) && !this.localSearch) {
      return this.outcome({ status: 'disabled', sources: [] });
    }

    try {
      const retrievalStartedAt = Date.now();
      const deadlineAtMs = params.request.deadlineAtMs ?? Date.now() + 10_000;
      const signal = AbortSignal.any([
        ...(params.signal ? [params.signal] : []),
        AbortSignal.timeout(Math.max(1, deadlineAtMs - Date.now())),
      ]);
      const preparation = Promise.all([
        this.currentAllowedPageIds(
          params.user,
          params.request.workspaceId,
          params.request.spaceId,
        ),
        this.withDictionarySourceType(params.request),
      ]);
      const [allowedPageIdSet, safeRequest] = params.request.deadlineAtMs
        ? await this.withTimeout(
            preparation,
            Math.max(
              1,
              Math.min(500, params.request.deadlineAtMs - Date.now()),
            ),
          )
        : await preparation;
      const allowedPageIds = [...allowedPageIdSet];
      let degradation: string | undefined;
      const externalDeadline = Math.min(deadlineAtMs, Date.now() + 6_000);
      const queries = [
        ...new Set([
          safeRequest.query,
          ...(safeRequest.additionalQueries ?? []).slice(0, 2),
        ]),
      ];
      const rankings = await Promise.all(
        queries.map(async (query) => {
          if (!adapter.isConfigured(params.config)) {
            degradation = 'retrieval_disabled';
            return [];
          }
          try {
            return await this.withTimeout(
              adapter.retrieve(
                {
                  ...params.config,
                  timeoutMs: Math.max(1, externalDeadline - Date.now()),
                },
                {
                  ...safeRequest,
                  query,
                  allowedPageIds,
                  deadlineAtMs: externalDeadline,
                },
                AbortSignal.any([
                  signal,
                  AbortSignal.timeout(
                    Math.max(1, externalDeadline - Date.now()),
                  ),
                ]),
              ),
              Math.max(1, externalDeadline - Date.now()),
            );
          } catch (error) {
            degradation = this.toErrorCode(error);
            return [];
          }
        }),
      );
      let hits = this.fuseRanks(rankings);
      const counts = { rejectedAcl: 0, stale: 0, refreshed: 0, merged: 0 };
      const resolveSources = async () => {
        Object.assign(counts, {
          rejectedAcl: 0,
          stale: 0,
          refreshed: 0,
          merged: 0,
        });
        let sources = await this.resolveSafeSources(
          hits,
          await this.currentAllowedPageIds(
            params.user,
            params.request.workspaceId,
            params.request.spaceId,
          ),
          params.request.workspaceId,
          params.request.spaceId,
          40,
          params.user,
          counts,
          signal,
        );
        if (this.sourceAccess) {
          const before = sources.length;
          sources = await this.sourceAccess.filterAccessible(sources, {
            user: params.user,
            workspaceId: params.request.workspaceId,
            spaceId: params.request.spaceId,
            mode: 'rag-search',
          });
          counts.rejectedAcl += before - sources.length;
        }
        // Canonicalization can merge several remote chunks into one parent.
        const unique = new Map(
          sources.map((source) => [
            `${source.sourceType}:${source.sourceId}:${source.contentHash}`,
            source,
          ]),
        );
        counts.merged = sources.length - unique.size;
        return [...unique.values()].slice(0, params.config.maxResults);
      };
      let sources = params.request.deadlineAtMs
        ? await this.withTimeout(
            resolveSources(),
            Math.max(1, params.request.deadlineAtMs - Date.now()),
          )
        : await resolveSources();
      if (
        (params.config.qualityProfile === 'evidence-v1' ||
          sources.length === 0) &&
        this.localSearch &&
        !signal.aborted
      ) {
        const local = await this.withTimeout(
          this.localCandidates(params.request, params.user),
          Math.max(1, deadlineAtMs - Date.now()),
        ).catch(() => []);
        if (local.length && !signal.aborted) {
          const externalHits = hits;
          const externalCounts = { ...counts };
          hits = this.fuseRanks([hits, local]);
          try {
            sources = await this.withTimeout(
              resolveSources(),
              Math.max(1, deadlineAtMs - Date.now()),
            );
          } catch {
            hits = externalHits;
            Object.assign(counts, externalCounts);
            degradation ??= 'retrieval_timeout';
          }
        }
      }
      this.metrics.observeRetrievalQuery(
        Date.now() - retrievalStartedAt,
        hits.length,
        sources.length,
      );
      return this.outcome({
        status: sources.length > 0 ? 'used' : degradation ? 'failed' : 'empty',
        sources,
        ...(degradation ? { errorCode: degradation } : {}),
        diagnostics: {
          profile: params.config.qualityProfile ?? 'legacy-v1',
          mode: hits.some((hit) => hit.local)
            ? rankings.some((rank) => rank.length)
              ? 'external_and_local'
              : 'local_fallback'
            : (hits[0]?.retrievalMode ?? 'unverified'),
          received: hits.length,
          rejected: counts.rejectedAcl + counts.stale,
          ...counts,
          admitted: sources.length,
          latencyMs: Date.now() - retrievalStartedAt,
          degradation,
          effectiveProfile: rankings.flat().find((hit) => hit.effectiveProfile)
            ?.effectiveProfile,
        },
      });
    } catch (error) {
      const errorCode = this.toErrorCode(error);
      const status = Number((error as any)?.status);
      this.logger.warn(
        `External AI retrieval failed: ${errorCode}${
          Number.isFinite(status) ? ` (${status})` : ''
        }`,
      );
      return this.outcome({ status: 'failed', errorCode, sources: [] });
    }
  }

  private outcome(value: AiRetrievalOutcome): AiRetrievalOutcome {
    this.metrics.observeRetrieval(value.status);
    return value;
  }

  private fuseRanks(rankings: AiRetrievalHit[][]): AiRetrievalHit[] {
    const fused = new Map<string, { hit: AiRetrievalHit; rank: number }>();
    for (const ranking of rankings) {
      const seen = new Set<string>();
      ranking.forEach((hit, index) => {
        const key = `${hit.sourceType}:${hit.sourceId}:${evidenceHash(normalizeEvidence(hit.text))}`;
        if (seen.has(key)) return;
        seen.add(key);
        const previous = fused.get(key);
        fused.set(key, {
          hit: previous?.hit ?? hit,
          rank: (previous?.rank ?? 0) + 1 / (60 + index + 1),
        });
      });
    }
    return [...fused.values()]
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 40)
      .map((item) => item.hit);
  }

  private async localCandidates(
    request: AiRetrievalRequest,
    user: User,
  ): Promise<AiRetrievalHit[]> {
    const [pages, dictionary] = await Promise.all([
      this.localSearch!.searchPage(
        { query: request.query, spaceId: request.spaceId, limit: 40 } as any,
        { userId: user.id, workspaceId: request.workspaceId },
      ),
      this.dictionarySearch?.search(
        { query: request.query, spaceId: request.spaceId, limit: 8 } as any,
        { userId: user.id, workspaceId: request.workspaceId },
      ) ?? { items: [] },
    ]);
    return [
      ...dictionary.items.map((item) => ({
        sourceType: 'dictionary_term' as const,
        sourceId: item.id,
        pageId: null,
        text: request.query,
        local: true,
        retrievalMode: 'local' as const,
        scoreKind: 'local_rank' as const,
      })),
      ...pages.items.map((item) => ({
        sourceType: 'page' as const,
        sourceId: item.id,
        pageId: item.id,
        text: request.query,
        local: true,
        retrievalMode: 'local' as const,
        scoreKind: 'local_rank' as const,
      })),
    ];
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new GatewayTimeoutException('RAG retrieval deadline exceeded'),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async currentAllowedPageIds(
    user: User,
    workspaceId: string,
    spaceId: string,
  ): Promise<Set<string>> {
    if (this.sourceAccess) {
      return this.sourceAccess.getAllowedPageIds({
        user,
        workspaceId,
        spaceId,
        mode: 'rag-search',
      });
    }
    const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      spaceId,
    );
    const policy = this.contentPolicy
      ? await this.contentPolicy.getRagSearchPolicy(spaceId, workspaceId)
      : null;
    const excluded = new Set([
      ...(policy?.excludedPageIds ?? []),
      ...(policy?.statusBlockedPageIds ?? []),
    ]);
    return new Set(
      [...snapshot.readablePageIds].filter((id) => !excluded.has(id)),
    );
  }

  private getAdapter(config: AiRetrievalConfig) {
    switch (config.adapter) {
      case this.httpAdapter.kind:
        return this.httpAdapter;
      case this.openWebUiAdapter?.kind:
        return this.openWebUiAdapter;
      default:
        return this.noopAdapter;
    }
  }

  private async resolveSafeSources(
    hits: AiRetrievalHit[],
    allowedPageIds: Set<string>,
    workspaceId: string,
    spaceId: string,
    topK: number,
    user?: User,
    counts = { rejectedAcl: 0, stale: 0, refreshed: 0, merged: 0 },
    signal?: AbortSignal,
  ): Promise<AiSafeRetrievalSource[]> {
    if (hits.length === 0) {
      return [];
    }

    const db = this.db as any;
    const pageSourceIds = hits
      .filter((hit) => hit.sourceType === 'page')
      .map((hit) => hit.sourceId);
    const rowIds = hits
      .filter((hit) => hit.sourceType === 'database_row')
      .map((hit) => hit.sourceId);
    const attachmentIds = hits
      .filter((hit) => hit.sourceType === 'attachment')
      .map((hit) => hit.sourceId);
    const dictionaryIds = hits
      .filter((hit) => hit.sourceType === 'dictionary_term')
      .map((hit) => hit.sourceId);
    const [rows, attachments, dictionaryTerms] = await Promise.all([
      rowIds.length
        ? db
            .selectFrom('databaseRows')
            .select(['id', 'pageId', 'workspaceId'])
            .where('id', 'in', rowIds)
            .execute()
        : [],
      attachmentIds.length
        ? db
            .selectFrom('attachments')
            .select([
              'id',
              'pageId',
              'workspaceId',
              'spaceId',
              'fileName',
              'fileExt',
              'mimeType',
              'deletedAt',
            ])
            .where('id', 'in', attachmentIds)
            .execute()
        : [],
      dictionaryIds.length
        ? db
            .selectFrom('dictionaryTerms as term')
            .innerJoin('spaces', 'spaces.id', 'term.spaceId')
            .select([
              'term.id as id',
              'term.term as term',
              'term.workspaceId as workspaceId',
              'term.spaceId as spaceId',
              'term.deletedAt as deletedAt',
              'spaces.slug as spaceSlug',
              'spaces.settings as spaceSettings',
            ])
            .where('term.id', 'in', dictionaryIds)
            .execute()
        : [],
    ]);
    const rowPageIds = rows.map((row: any) => row.pageId);
    const attachmentPageIds = attachments
      .map((file: any) => file.pageId)
      .filter(Boolean);
    const pageIds = [
      ...new Set([...pageSourceIds, ...rowPageIds, ...attachmentPageIds]),
    ];
    const pages = await db
      .selectFrom('pages')
      .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select([
        'pages.id as id',
        'pages.slugId as slugId',
        'pages.title as title',
        'pages.workspaceId as workspaceId',
        'pages.spaceId as spaceId',
        'pages.deletedAt as deletedAt',
        'pages.content as content',
        'pages.settings as settings',
        'spaces.slug as spaceSlug',
        'spaces.settings as spaceSettings',
      ])
      .where('pages.id', 'in', pageIds)
      .execute();
    const pagesById = new Map<string, any>(
      pages.map((page: any) => [page.id, page]),
    );
    const pageCustomFields = new Map<string, any>();
    if (this.knowledgeProjection) {
      for (const page of pages) {
        const config = this.knowledgeProjection.getDocumentFieldsConfig({
          settings: page.spaceSettings,
        } as any);
        pageCustomFields.set(
          page.id,
          this.knowledgeProjection.buildCustomFields(page.settings, config),
        );
      }
    }
    const projectedMembers = this.knowledgeProjection
      ? await this.knowledgeProjection.resolveMembers(workspaceId, [
          ...pageCustomFields.values(),
        ])
      : new Map();
    const projectedMemberNames =
      this.knowledgeProjection?.memberNames(projectedMembers);

    const rowsById = new Map<string, any>(
      rows.map((row: any) => [row.id, row]),
    );
    const attachmentsById = new Map<string, any>(
      attachments.map((file: any) => [file.id, file]),
    );
    const dictionaryTermsById = new Map<string, any>(
      dictionaryTerms.map((term: any) => [term.id, term]),
    );

    const safe: AiSafeRetrievalSource[] = [];
    const documents = new Map<
      string,
      ReturnType<AiCanonicalEvidenceService['load']>
    >();
    const current = async (hit: AiRetrievalHit) => {
      if (!this.canonical || !user) return null;
      const key = `${hit.sourceType}:${hit.sourceId}`;
      if (!documents.has(key))
        documents.set(
          key,
          this.canonical
            .load(hit, user, workspaceId, spaceId, signal)
            .catch(() => null),
        );
      const document = await documents.get(key);
      if (!document) {
        counts.stale += 1;
        return null;
      }
      const evidence = resolveCurrentEvidence(
        document.markdown,
        hit,
        document.headings,
      );
      if (!evidence) counts.stale += 1;
      else if (evidence.refreshed) counts.refreshed += 1;
      return evidence
        ? {
            ...evidence,
            sourceVersion: document.version,
            contentHash: evidenceHash(evidence.excerpt),
          }
        : null;
    };
    for (const hit of hits) {
      if (signal?.aborted) break;
      if (hit.sourceType === 'dictionary_term') {
        const term = dictionaryTermsById.get(hit.sourceId);
        const dictionaryEnabled = Boolean(
          term?.spaceSettings &&
            typeof term.spaceSettings === 'object' &&
            !Array.isArray(term.spaceSettings) &&
            term.spaceSettings.dictionary?.enabled,
        );
        if (
          hit.pageId !== null ||
          !term ||
          term.deletedAt ||
          term.workspaceId !== workspaceId ||
          term.spaceId !== spaceId ||
          !dictionaryEnabled
        ) {
          continue;
        }
        const evidence = await current(hit);
        if (!evidence) continue;
        safe.push({
          sourceType: 'dictionary_term',
          sourceId: hit.sourceId,
          pageId: null,
          sourceTitle: term.term,
          sourceUrl: `/s/${encodeURIComponent(term.spaceSlug)}/dictionary?term=${encodeURIComponent(term.id)}`,
          excerpt: evidence.excerpt,
          sourceVersion: evidence.sourceVersion,
          contentHash: evidence.contentHash,
          scoreKind: hit.scoreKind ?? 'unknown',
          relevanceScore: Number.isFinite(hit.score) ? Number(hit.score) : null,
          ...(hit.partKey ? { partKey: hit.partKey } : {}),
          sectionId: null,
          sectionTitle: null,
        });
        if (safe.length >= topK) break;
        continue;
      }
      const row =
        hit.sourceType === 'database_row'
          ? rowsById.get(hit.sourceId)
          : undefined;
      const file =
        hit.sourceType === 'attachment'
          ? attachmentsById.get(hit.sourceId)
          : undefined;
      const resolvedPageId = hit.pageId;
      if (!resolvedPageId) continue;
      const page = pagesById.get(resolvedPageId);
      if (page && !allowedPageIds.has(page.id)) counts.rejectedAcl += 1;
      if (
        !page ||
        page.deletedAt ||
        page.workspaceId !== workspaceId ||
        page.spaceId !== spaceId ||
        !allowedPageIds.has(page.id)
      ) {
        continue;
      }

      let title = page.title || 'Untitled';
      if (hit.sourceType === 'page') {
        if (hit.sourceId !== page.id) {
          continue;
        }
      } else if (hit.sourceType === 'database_row') {
        if (!row || row.pageId !== page.id || row.workspaceId !== workspaceId) {
          continue;
        }
      } else {
        if (
          !file ||
          file.deletedAt ||
          file.pageId !== page.id ||
          file.workspaceId !== workspaceId ||
          file.spaceId !== spaceId ||
          !this.isSupportedRagAttachment(file)
        ) {
          continue;
        }
        title = file.fileName;
      }

      const evidence = await current(hit);
      if (!evidence) continue;
      const section =
        hit.sourceType === 'attachment'
          ? null
          : this.matchPageSection(page.content, evidence.excerpt);
      const pageUrl = `/s/${encodeURIComponent(page.spaceSlug)}/p/${encodeURIComponent(page.slugId)}`;
      const customFields = pageCustomFields.get(page.id);
      const documentFieldsMarkdown = this.knowledgeProjection
        ? this.knowledgeProjection.renderDocumentFields(
            customFields,
            projectedMemberNames ?? new Map(),
          )
        : '';
      safe.push({
        sourceType: hit.sourceType,
        sourceId: hit.sourceId,
        pageId: page.id,
        sourceTitle: title,
        sourceUrl:
          hit.sourceType === 'attachment'
            ? `/api/attachments/files/${encodeURIComponent(file.id)}/${encodeURIComponent(file.fileName)}`
            : section
              ? `${pageUrl}#${encodeURIComponent(section.id)}`
              : pageUrl,
        excerpt: [documentFieldsMarkdown, evidence.excerpt]
          .filter(Boolean)
          .join('\n\n'),
        relevanceScore: Number.isFinite(hit.score) ? Number(hit.score) : null,
        ...(hit.partKey ? { partKey: hit.partKey } : {}),
        customFields,
        sectionId: section?.id ?? null,
        sectionTitle: section?.title ?? null,
        sourceVersion: evidence.sourceVersion,
        contentHash: evidence.contentHash,
        headingPath: evidence.headingPath,
        scoreKind: hit.scoreKind ?? 'unknown',
      });
      if (safe.length >= topK) {
        break;
      }
    }

    return safe;
  }

  private async withDictionarySourceType(
    request: AiRetrievalRequest,
  ): Promise<AiRetrievalRequest> {
    const space = await this.db
      .selectFrom('spaces')
      .select('settings')
      .where('id', '=', request.spaceId)
      .where('workspaceId', '=', request.workspaceId)
      .executeTakeFirst();
    const dictionaryEnabled = Boolean(
      space?.settings &&
        typeof space.settings === 'object' &&
        !Array.isArray(space.settings) &&
        (space.settings as any).dictionary?.enabled,
    );
    const sourceTypes: AiRetrievalRequest['sourceTypes'] =
      request.sourceTypes.filter(
        (sourceType) => sourceType !== 'dictionary_term',
      );
    if (dictionaryEnabled) sourceTypes.push('dictionary_term');
    return { ...request, sourceTypes };
  }

  private isSupportedRagAttachment(file: {
    fileName: string;
    fileExt: string;
    mimeType: string | null;
  }): boolean {
    if (this.contentProjectors) {
      return this.contentProjectors.isAttachmentSupported(file);
    }
    const extension = (file.fileExt || file.fileName)
      .toLowerCase()
      .match(/\.[a-z0-9]+$/u)?.[0];
    return (
      Boolean(extension && ['.md', '.txt'].includes(extension)) &&
      Boolean(
        file.mimeType &&
          [
            'application/octet-stream',
            'text/markdown',
            'text/plain',
            'text/x-markdown',
          ].includes(file.mimeType.toLowerCase()),
      )
    );
  }

  private sanitizeExcerpt(value: string): string {
    return Array.from(value)
      .filter((character) => {
        const code = character.charCodeAt(0);
        return (
          code === 9 ||
          code === 10 ||
          code === 13 ||
          (code >= 32 && code !== 127)
        );
      })
      .join('')
      .slice(0, 16000);
  }

  private matchPageSection(
    content: unknown,
    excerpt: string,
  ): { id: string; title: string } | null {
    if (!content || typeof content !== 'object') return null;
    const document = content as { content?: unknown[] };
    const sections: Array<{ id: string; title: string; text: string }> = [];
    let current: { id: string; title: string; text: string } | null = null;
    for (const value of document.content ?? []) {
      if (!value || typeof value !== 'object') continue;
      const node = value as {
        type?: string;
        attrs?: Record<string, unknown>;
      };
      if (node.type === 'heading') {
        const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
        if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
          current = { id, title: this.nodeText(node).slice(0, 500), text: '' };
          sections.push(current);
        } else {
          current = null;
        }
      }
      if (current) current.text += ` ${this.nodeText(node)}`;
    }
    const needle = this.normalizeSectionText(excerpt);
    if (needle.length < 16) return null;
    const idCounts = new Map<string, number>();
    sections.forEach((section) =>
      idCounts.set(section.id, (idCounts.get(section.id) ?? 0) + 1),
    );
    const matches = sections.filter((section) => {
      if (idCounts.get(section.id) !== 1) return false;
      const haystack = this.normalizeSectionText(section.text);
      if (!haystack) return false;
      return haystack.includes(needle) || needle.includes(haystack);
    });
    return matches.length === 1
      ? { id: matches[0].id, title: matches[0].title }
      : null;
  }

  private nodeText(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const node = value as { text?: string; content?: unknown[] };
    return [
      node.text ?? '',
      ...(node.content?.map((item) => this.nodeText(item)) ?? []),
    ].join('');
  }

  private normalizeSectionText(value: string): string {
    return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  }

  private toErrorCode(error: unknown): string {
    const responseCode = String((error as any)?.response?.code ?? '');
    if (
      [
        'retrieval_invalid_response',
        'retrieval_incompatible_metadata',
        'retrieval_response_too_large',
        'retrieval_collection_unavailable',
      ].includes(responseCode)
    ) {
      return responseCode;
    }
    const status = Number((error as any)?.status);
    if (status === 504) {
      return 'retrieval_timeout';
    }
    if (status === 400) {
      return 'retrieval_url_rejected';
    }
    if (status === 413) {
      return 'retrieval_request_too_large';
    }
    return 'retrieval_unavailable';
  }
}
