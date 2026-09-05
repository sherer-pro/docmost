import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { RAG_CONTENT_PROCESSOR_IDS } from '@docmost/api-contract';
import { AI_RETRIEVAL_DEFAULTS } from '../ai.constants';
import {
  AiRetrievalConfig,
  AiRetrievalHit,
  AiRetrievalRequest,
} from '../ai.types';
import { AiRetrievalAdapter } from './ai-retrieval.adapter';
import {
  AiRetrievalHttpClient,
  AiRetrievalHttpError,
} from './ai-retrieval-http-client.service';

type OpenWebUiQueryResponse = {
  documents?: unknown;
  metadatas?: unknown;
  distances?: unknown;
};

type OpenWebUiFileResponse = {
  meta?: unknown;
};

@Injectable()
export class OpenWebUiKnowledgeRetrievalAdapter implements AiRetrievalAdapter {
  readonly kind = 'open-webui-knowledge-v1' as const;
  private readonly logger = new Logger(OpenWebUiKnowledgeRetrievalAdapter.name);

  constructor(private readonly http: AiRetrievalHttpClient) {}

  /**
   * Bounded, low-cardinality failure reason. Only messages produced by the
   * retrieval HTTP client reach this helper, so no remote content is logged.
   */
  private safeReason(error: unknown): string {
    const response = (error as any)?.response;
    const code = typeof response?.code === 'string' ? response.code : undefined;
    const status = Number((error as any)?.status);
    return `${code ?? 'unknown'}${Number.isFinite(status) ? ` (${status})` : ''}`;
  }

  isConfigured(config: AiRetrievalConfig): boolean {
    return Boolean(
      config.adapter === this.kind &&
        config.openWebUiBaseUrl?.trim() &&
        config.openWebUiApiKey?.trim() &&
        config.openWebUiKnowledgeId?.trim(),
    );
  }

  async test(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ) {
    this.assertConfigured(config);
    const startedAt = Date.now();
    let remoteVersion: string | undefined;
    try {
      const version = await this.http.requestJson<{ version?: unknown }>({
        url: this.endpoint(config, 'api/version'),
        apiKey: config.openWebUiApiKey,
        timeoutMs: config.timeoutMs,
        maxRequestBytes: 0,
        maxResponseBytes: 16 * 1024,
        signal,
      });
      if (typeof version.version === 'string') {
        remoteVersion = version.version.slice(0, 64);
      }
    } catch {
      // The query capability is authoritative; version discovery is optional.
    }

    try {
      await this.http.requestJson<unknown>({
        url: this.endpoint(
          config,
          `api/v1/knowledge/${encodeURIComponent(
            config.openWebUiKnowledgeId!,
          )}`,
        ),
        apiKey: config.openWebUiApiKey,
        timeoutMs: config.timeoutMs,
        maxRequestBytes: 0,
        maxResponseBytes: 1024 * 1024,
        signal,
      });
    } catch (error) {
      if (
        error instanceof AiRetrievalHttpError &&
        [401, 403, 404].includes(error.remoteStatus)
      ) {
        throw new BadGatewayException({
          code: 'retrieval_collection_unavailable',
          message: 'Open WebUI knowledge collection is unavailable',
        });
      }
      throw error;
    }

    const result = await this.fetchCandidates(
      config,
      request,
      config.queryMode === 'hybrid_with_vector_fallback',
      signal,
    );
    return {
      ok: true as const,
      latencyMs: Date.now() - startedAt,
      adapter: this.kind,
      ...(remoteVersion ? { remoteVersion } : {}),
      candidateCount: result.candidateCount,
      validCandidateCount: result.hits.length,
      state: result.hits.length > 0 ? ('ready' as const) : ('empty' as const),
    };
  }

  async retrieve(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<AiRetrievalHit[]> {
    if (config.queryMode !== 'hybrid_with_vector_fallback') {
      return (await this.fetchCandidates(config, request, false, signal)).hits;
    }

    const deadlineAt = Math.min(
      request.deadlineAtMs ?? Number.POSITIVE_INFINITY,
      Date.now() + Math.min(config.timeoutMs, 6_000),
    );
    const hybridTimeoutMs = Math.max(
      1,
      Math.min(3_000, deadlineAt - Date.now() - 1_000),
    );
    try {
      return (
        await this.fetchCandidates(
          { ...config, timeoutMs: hybridTimeoutMs },
          request,
          true,
          signal,
        )
      ).hits;
    } catch (error) {
      if (!this.shouldFallbackToVector(error, signal)) throw error;
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs < 1_000) throw error;
      return (
        await this.fetchCandidates(
          { ...config, timeoutMs: remainingMs },
          request,
          false,
          signal,
        )
      ).hits;
    }
  }

  private async fetchCandidates(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    hybrid = config.queryMode === 'hybrid_with_vector_fallback',
    signal?: AbortSignal,
  ): Promise<{ hits: AiRetrievalHit[]; candidateCount: number }> {
    this.assertConfigured(config);
    const payload = await this.http.requestJson<OpenWebUiQueryResponse>({
      url: this.endpoint(config, 'api/v1/retrieval/query/collection'),
      apiKey: config.openWebUiApiKey,
      timeoutMs: config.timeoutMs,
      method: 'POST',
      body: JSON.stringify({
        collection_names: [config.openWebUiKnowledgeId],
        query: request.query,
        k: Math.min(
          AI_RETRIEVAL_DEFAULTS.candidateLimit,
          request.candidateLimit,
        ),
        hybrid,
      }),
      maxRequestBytes: AI_RETRIEVAL_DEFAULTS.maxRequestChars,
      maxResponseBytes: AI_RETRIEVAL_DEFAULTS.maxResponseChars,
      signal,
    });

    const documents = this.firstArray(payload.documents);
    const metadatas = this.firstArray(payload.metadatas);
    const distances = this.firstArray(payload.distances);
    const candidateCount = Math.min(
      documents.length,
      AI_RETRIEVAL_DEFAULTS.candidateLimit,
    );
    if (candidateCount === 0) {
      return { hits: [], candidateCount: 0 };
    }

    const hydratedMetadatas = await this.hydrateFileMetadata(
      config,
      metadatas.slice(0, candidateCount),
      signal,
    );
    const hits: AiRetrievalHit[] = [];
    for (let index = 0; index < candidateCount; index += 1) {
      const parsed = this.parseCandidate(
        documents[index],
        hydratedMetadatas[index],
        distances[index],
        request,
      );
      if (parsed) hits.push(parsed);
    }
    if (hits.length === 0) {
      throw new BadGatewayException({
        code: 'retrieval_incompatible_metadata',
        message: 'Open WebUI returned no compatible Docmost metadata',
      });
    }

    const deduplicated = new Map<string, AiRetrievalHit>();
    const partsPerSource = new Map<string, number>();
    for (const hit of hits) {
      const logicalKey = `${hit.sourceType}:${hit.sourceId}:${hit.pageId}`;
      const key = `${logicalKey}:${hit.partKey ?? 'main'}`;
      if (deduplicated.has(key)) continue;
      const partCount = partsPerSource.get(logicalKey) ?? 0;
      if (partCount >= 2) continue;
      deduplicated.set(key, hit);
      partsPerSource.set(logicalKey, partCount + 1);
    }
    return { hits: [...deduplicated.values()], candidateCount };
  }

  private async hydrateFileMetadata(
    config: AiRetrievalConfig,
    metadatas: unknown[],
    signal?: AbortSignal,
  ): Promise<unknown[]> {
    const requests = new Map<string, Promise<unknown>>();
    return Promise.all(
      metadatas.map(async (metadataValue) => {
        if (this.getDocmostMetadata(metadataValue)) return metadataValue;
        if (!metadataValue || typeof metadataValue !== 'object') {
          return metadataValue;
        }
        const fileId = (metadataValue as Record<string, unknown>).file_id;
        if (typeof fileId !== 'string' || !isUuid(fileId)) {
          return metadataValue;
        }
        let request = requests.get(fileId);
        if (!request) {
          // An unreadable or oversized file record must reject only its own
          // candidates instead of failing the whole retrieval request.
          request = this.fetchFileDocmostMetadata(config, fileId, signal).catch(
            (error) => {
              this.logger.warn(
                `Open WebUI file metadata is unavailable: ${this.safeReason(error)}`,
              );
              return undefined;
            },
          );
          requests.set(fileId, request);
        }
        const docmost = await request;
        if (!docmost) return metadataValue;
        return {
          ...(metadataValue as Record<string, unknown>),
          docmost,
        };
      }),
    );
  }

  private async fetchFileDocmostMetadata(
    config: AiRetrievalConfig,
    fileId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const file = await this.http.requestJson<OpenWebUiFileResponse>({
      url: this.endpoint(config, `api/v1/files/${encodeURIComponent(fileId)}`),
      apiKey: config.openWebUiApiKey,
      timeoutMs: config.timeoutMs,
      maxRequestBytes: 0,
      maxResponseBytes: 256 * 1024,
      signal,
    });
    return this.getDocmostMetadata(file.meta);
  }

  private getDocmostMetadata(metadataValue: unknown): unknown {
    if (!metadataValue || typeof metadataValue !== 'object') return undefined;
    const metadata = metadataValue as Record<string, unknown>;
    const nestedData =
      metadata.data && typeof metadata.data === 'object'
        ? (metadata.data as Record<string, unknown>)
        : undefined;
    const docmost = nestedData?.docmost ?? metadata.docmost;
    return docmost && typeof docmost === 'object' ? docmost : undefined;
  }

  private parseCandidate(
    document: unknown,
    metadataValue: unknown,
    distance: unknown,
    request: AiRetrievalRequest,
  ): AiRetrievalHit | null {
    if (
      typeof document !== 'string' ||
      document.length === 0 ||
      Buffer.byteLength(document, 'utf8') > AI_RETRIEVAL_DEFAULTS.maxHitChars ||
      !metadataValue ||
      typeof metadataValue !== 'object'
    ) {
      return null;
    }
    const docmostValue = this.getDocmostMetadata(metadataValue);
    if (!docmostValue || typeof docmostValue !== 'object') {
      return null;
    }
    const docmost = docmostValue as Record<string, unknown>;
    if (
      ![1, 2, 3].includes(Number(docmost.schemaVersion)) ||
      docmost.workspaceId !== request.workspaceId ||
      docmost.spaceId !== request.spaceId ||
      !['page', 'database_row', 'attachment', 'dictionary_term'].includes(
        String(docmost.sourceType),
      ) ||
      !request.sourceTypes.includes(docmost.sourceType as never) ||
      typeof docmost.sourceId !== 'string' ||
      !isUuid(docmost.sourceId) ||
      (docmost.sourceType === 'dictionary_term'
        ? docmost.pageId !== null
        : typeof docmost.pageId !== 'string' || !isUuid(docmost.pageId))
    ) {
      return null;
    }
    const partKey = this.v3PartKey(docmost);
    if (docmost.schemaVersion === 3 && !partKey) return null;
    return {
      sourceType: docmost.sourceType as AiRetrievalHit['sourceType'],
      sourceId: docmost.sourceId,
      pageId: docmost.pageId as string | null,
      text: document,
      ...(partKey ? { partKey } : {}),
      ...(Number.isFinite(distance)
        ? { score: this.distanceToScore(Number(distance)) }
        : {}),
    };
  }

  private v3PartKey(docmost: Record<string, unknown>): string | null {
    if (docmost.schemaVersion !== 3) return null;
    if (
      !RAG_CONTENT_PROCESSOR_IDS.includes(docmost.projectorId as never) ||
      (docmost.sourceType === 'attachment'
        ? docmost.projectorId !== 'attachment-text-v1'
        : docmost.projectorId !== 'structured-knowledge-v2') ||
      typeof docmost.partId !== 'string' ||
      !docmost.partId ||
      docmost.partId.length > 128 ||
      !Number.isSafeInteger(docmost.partIndex) ||
      Number(docmost.partIndex) < 0 ||
      !Number.isSafeInteger(docmost.partCount) ||
      Number(docmost.partCount) < 1 ||
      Number(docmost.partIndex) >= Number(docmost.partCount)
    ) {
      return null;
    }
    return `${docmost.projectorId}:${docmost.partId}`;
  }

  private distanceToScore(distance: number): number {
    return 1 / (1 + Math.max(0, distance));
  }

  private shouldFallbackToVector(
    error: unknown,
    signal?: AbortSignal,
  ): boolean {
    if (signal?.aborted || (error as Error)?.name === 'AbortError') {
      return false;
    }
    if (error instanceof GatewayTimeoutException) return true;
    if (error instanceof AiRetrievalHttpError) {
      return error.remoteStatus === 429 || error.remoteStatus >= 500;
    }
    const code = (error as any)?.response?.code;
    if (code === 'retrieval_incompatible_metadata') return false;
    if (code === 'retrieval_invalid_response') return true;
    return error instanceof TypeError;
  }

  private firstArray(value: unknown): unknown[] {
    return Array.isArray(value) && Array.isArray(value[0]) ? value[0] : [];
  }

  private endpoint(config: AiRetrievalConfig, path: string): string {
    this.assertConfigured(config);
    let base: URL;
    try {
      base = new URL(config.openWebUiBaseUrl!);
    } catch {
      throw new BadGatewayException({
        code: 'retrieval_url_rejected',
        message: 'Open WebUI Base URL is invalid',
      });
    }
    if (
      base.username ||
      base.password ||
      base.hash ||
      base.search ||
      base.pathname !== '/' ||
      !['http:', 'https:'].includes(base.protocol)
    ) {
      throw new BadGatewayException({
        code: 'retrieval_url_rejected',
        message: 'Open WebUI Base URL is invalid',
      });
    }
    const normalized = base.toString().replace(/\/+$/, '') + '/';
    return new URL(path.replace(/^\/+/, ''), normalized).toString();
  }

  private assertConfigured(config: AiRetrievalConfig): void {
    if (!this.isConfigured(config)) {
      throw new BadGatewayException('Open WebUI retrieval is not configured');
    }
  }
}
