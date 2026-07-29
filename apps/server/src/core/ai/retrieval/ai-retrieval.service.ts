import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page-access/page-access.service';
import {
  AiRetrievalConfig,
  AiRetrievalRequest,
  AiSafeRetrievalSource,
} from '../ai.types';
import { HttpJsonAiRetrievalAdapter } from './http-json-ai-retrieval.adapter';
import { NoopAiRetrievalAdapter } from './noop-ai-retrieval.adapter';
import { AiOperationalMetricsService } from '../services/ai-operational-metrics.service';

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
  ) {}

  async test(config: AiRetrievalConfig, request: AiRetrievalRequest) {
    return this.getAdapter(config).test(config, request);
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
      const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
        params.user,
        params.request.spaceId,
      );
      const allowedPageIds = [...snapshot.readablePageIds];
      const hits = await adapter.retrieve(
        params.config,
        {
          ...params.request,
          allowedPageIds,
        },
        params.signal,
      );
      const sources = await this.resolveSafeSources(
        hits,
        new Set(allowedPageIds),
        params.request.workspaceId,
        params.request.spaceId,
        params.config.maxResults,
      );
      return this.outcome({
        status: sources.length > 0 ? 'used' : 'empty',
        sources,
      });
    } catch (error) {
      const errorCode = this.toErrorCode(error);
      this.logger.warn(`External AI retrieval failed: ${errorCode}`);
      return this.outcome({ status: 'failed', errorCode, sources: [] });
    }
  }

  private outcome(value: AiRetrievalOutcome): AiRetrievalOutcome {
    this.metrics.observeRetrieval(value.status);
    return value;
  }

  private getAdapter(config: AiRetrievalConfig) {
    return config.adapter === this.httpAdapter.kind
      ? this.httpAdapter
      : this.noopAdapter;
  }

  private async resolveSafeSources(
    hits: Awaited<ReturnType<HttpJsonAiRetrievalAdapter['retrieve']>>,
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
        if (
          !row ||
          row.pageId !== page.id ||
          row.workspaceId !== workspaceId
        ) {
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

      safe.push({
        sourceType: hit.sourceType,
        sourceId: hit.sourceId,
        pageId: page.id,
        sourceTitle: title,
        sourceUrl: `/s/${encodeURIComponent(page.spaceSlug)}/p/${encodeURIComponent(page.slugId)}`,
        excerpt: this.sanitizeExcerpt(hit.text),
        relevanceScore: Number.isFinite(hit.score)
          ? Number(hit.score)
          : null,
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
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .slice(0, 16000);
  }

  private toErrorCode(error: unknown): string {
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
