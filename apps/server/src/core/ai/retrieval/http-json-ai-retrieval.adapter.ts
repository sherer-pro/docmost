import {
  BadGatewayException,
  Injectable,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { AI_RETRIEVAL_DEFAULTS } from '../ai.constants';
import {
  AiRetrievalConfig,
  AiRetrievalHit,
  AiRetrievalRequest,
} from '../ai.types';
import { AiRetrievalAdapter } from './ai-retrieval.adapter';
import { AiRetrievalHttpClient } from './ai-retrieval-http-client.service';

@Injectable()
export class HttpJsonAiRetrievalAdapter implements AiRetrievalAdapter {
  readonly kind = 'http-json-v1' as const;

  constructor(private readonly http: AiRetrievalHttpClient) {}

  isConfigured(config: AiRetrievalConfig): boolean {
    return Boolean(
      config.adapter === this.kind &&
        config.url?.trim(),
    );
  }

  async test(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<{ ok: true; latencyMs: number }> {
    const startedAt = Date.now();
    await this.fetchCandidates(config, request, signal);
    return { ok: true, latencyMs: Date.now() - startedAt };
  }

  async retrieve(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<AiRetrievalHit[]> {
    return this.fetchCandidates(config, request, signal);
  }

  private async fetchCandidates(
    config: AiRetrievalConfig,
    request: AiRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<AiRetrievalHit[]> {
    if (!this.isConfigured(config) || !config.url) {
      throw new BadGatewayException('Retrieval provider is not configured');
    }
    const payload = await this.http.requestJson<unknown>({
      url: config.url,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      method: 'POST',
      body: JSON.stringify(request),
      maxRequestBytes: AI_RETRIEVAL_DEFAULTS.maxRequestChars,
      maxResponseBytes: AI_RETRIEVAL_DEFAULTS.maxResponseChars,
      signal,
    });

    const hits = (payload as { items?: unknown })?.items;
    if (!Array.isArray(hits)) {
      throw new BadGatewayException(
        'Retrieval provider returned an invalid response',
      );
    }

    const parsed = hits
      .slice(0, AI_RETRIEVAL_DEFAULTS.candidateLimit)
      .map((hit) => this.parseHit(hit))
      .filter((hit): hit is AiRetrievalHit => Boolean(hit));
    const deduplicated = new Map<string, AiRetrievalHit>();
    for (const hit of parsed) {
      const key = `${hit.sourceType}:${hit.sourceId}:${hit.pageId}`;
      const previous = deduplicated.get(key);
      if (
        !previous ||
        Number(hit.score ?? Number.NEGATIVE_INFINITY) >
          Number(previous.score ?? Number.NEGATIVE_INFINITY)
      ) {
        deduplicated.set(key, hit);
      }
    }
    return [...deduplicated.values()];
  }

  private parseHit(value: unknown): AiRetrievalHit | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const hit = value as Record<string, unknown>;
    if (
      !['page', 'database_row', 'attachment'].includes(
        String(hit.sourceType),
      ) ||
      typeof hit.sourceId !== 'string' ||
      typeof hit.pageId !== 'string' ||
      !isUuid(hit.sourceId) ||
      !isUuid(hit.pageId) ||
      typeof hit.text !== 'string' ||
      hit.text.length === 0 ||
      Buffer.byteLength(hit.text, 'utf8') >
        AI_RETRIEVAL_DEFAULTS.maxHitChars
    ) {
      return null;
    }

    return {
      sourceType: hit.sourceType as AiRetrievalHit['sourceType'],
      sourceId: hit.sourceId,
      pageId: hit.pageId,
      text: hit.text,
      ...(Number.isFinite(hit.score)
        ? { score: Number(hit.score) }
        : {}),
    };
  }

}
