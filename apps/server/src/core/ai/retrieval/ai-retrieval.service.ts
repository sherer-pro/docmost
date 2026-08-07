import { Injectable, Logger, Optional } from '@nestjs/common';
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

export type AiRetrievalOutcome = {
  status: 'not_requested' | 'disabled' | 'used' | 'empty' | 'failed';
  errorCode?: string;
  sources: AiSafeRetrievalSource[];
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
  ) {}

  async assertSourcesAccessible(params: {
    sources: AiSourceAccessReference[];
    user: User;
    workspaceId: string;
    spaceId: string;
  }): Promise<void> {
    if (this.sourceAccess) {
      await this.sourceAccess.assertAccessible(params.sources, params);
      return;
    }
    const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      params.user,
      params.spaceId,
    );
    const excluded = this.contentPolicy
      ? await this.contentPolicy.getExcludedPageIds(
          params.spaceId,
          params.workspaceId,
        )
      : new Set<string>();
    if (
      params.sources.some(
        (source) =>
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
    const result = await adapter.test(config, request);
    const allowedPageIds = [
      ...(await this.currentAllowedPageIds(
        user,
        request.workspaceId,
        request.spaceId,
      )),
    ];
    const hits = await adapter.retrieve(config, {
      ...request,
      allowedPageIds,
    });
    const sources = await this.resolveSafeSources(
      hits,
      new Set(allowedPageIds),
      request.workspaceId,
      request.spaceId,
      config.maxResults,
    );

    return {
      ...result,
      validCandidateCount: sources.length,
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
    if (!adapter.isConfigured(params.config)) {
      return this.outcome({ status: 'disabled', sources: [] });
    }

    try {
      const retrievalStartedAt = Date.now();
      const allowedPageIds = [
        ...(await this.currentAllowedPageIds(
          params.user,
          params.request.workspaceId,
          params.request.spaceId,
        )),
      ];
      const hits = await adapter.retrieve(
        params.config,
        {
          ...params.request,
          allowedPageIds,
        },
        params.signal,
      );
      let sources = await this.resolveSafeSources(
        hits,
        await this.currentAllowedPageIds(
          params.user,
          params.request.workspaceId,
          params.request.spaceId,
        ),
        params.request.workspaceId,
        params.request.spaceId,
        params.config.maxResults,
      );
      if (this.sourceAccess) {
        sources = await this.sourceAccess.filterAccessible(sources, {
          user: params.user,
          workspaceId: params.request.workspaceId,
          spaceId: params.request.spaceId,
        });
      }
      this.metrics.observeRetrievalQuery(
        Date.now() - retrievalStartedAt,
        hits.length,
        sources.length,
      );
      return this.outcome({
        status: sources.length > 0 ? 'used' : 'empty',
        sources,
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
      });
    }
    const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      spaceId,
    );
    const excluded = this.contentPolicy
      ? await this.contentPolicy.getExcludedPageIds(spaceId, workspaceId)
      : new Set<string>();
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
    const [rows, attachments] = await Promise.all([
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
              'deletedAt',
            ])
            .where('id', 'in', attachmentIds)
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
        'spaces.slug as spaceSlug',
      ])
      .where('pages.id', 'in', pageIds)
      .execute();
    const pagesById = new Map<string, any>(
      pages.map((page: any) => [page.id, page]),
    );

    const rowsById = new Map<string, any>(
      rows.map((row: any) => [row.id, row]),
    );
    const attachmentsById = new Map<string, any>(
      attachments.map((file: any) => [file.id, file]),
    );

    const safe: AiSafeRetrievalSource[] = [];
    for (const hit of hits) {
      const row =
        hit.sourceType === 'database_row'
          ? rowsById.get(hit.sourceId)
          : undefined;
      const file =
        hit.sourceType === 'attachment'
          ? attachmentsById.get(hit.sourceId)
          : undefined;
      const resolvedPageId = hit.pageId;
      const page = pagesById.get(resolvedPageId);
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
          file.spaceId !== spaceId
        ) {
          continue;
        }
        title = file.fileName;
      }

      const section =
        hit.sourceType === 'attachment'
          ? null
          : this.matchPageSection(page.content, hit.text);
      const pageUrl = `/s/${encodeURIComponent(page.spaceSlug)}/p/${encodeURIComponent(page.slugId)}`;
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
        excerpt: this.sanitizeExcerpt(hit.text),
        relevanceScore: Number.isFinite(hit.score) ? Number(hit.score) : null,
        sectionId: section?.id ?? null,
        sectionTitle: section?.title ?? null,
      });
      if (safe.length >= topK) {
        break;
      }
    }

    return safe;
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
