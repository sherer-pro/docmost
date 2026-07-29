import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { AI_RETRIEVAL_DEFAULTS } from '../ai.constants';
import {
  AiRetrievalConfig,
  AiRetrievalHit,
  AiRetrievalRequest,
} from '../ai.types';
import { AiRetrievalUrlPolicyService } from '../services/ai-retrieval-url-policy.service';
import { AiRetrievalAdapter } from './ai-retrieval.adapter';

@Injectable()
export class HttpJsonAiRetrievalAdapter implements AiRetrievalAdapter {
  readonly kind = 'http-json-v1' as const;

  constructor(private readonly urlPolicy: AiRetrievalUrlPolicyService) {}

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
    const body = JSON.stringify(request);
    if (
      Buffer.byteLength(body, 'utf8') >
      AI_RETRIEVAL_DEFAULTS.maxRequestChars
    ) {
      throw new PayloadTooLargeException(
        'Retrieval request exceeds the allowed size',
      );
    }
    const outbound = await this.request(
      config,
      {
        method: 'POST',
        body,
      },
      signal,
    );
    let raw: string;
    try {
      raw = await this.readBoundedBody(outbound.response);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw new GatewayTimeoutException(
          'Retrieval provider request timed out',
        );
      }
      throw error;
    } finally {
      outbound.cleanup();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new BadGatewayException('Retrieval provider returned invalid JSON');
    }

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

  private async request(
    config: AiRetrievalConfig,
    init: RequestInit,
    parentSignal?: AbortSignal,
  ): Promise<{ response: Response; cleanup: () => void }> {
    if (!this.isConfigured(config) || !config.url) {
      throw new BadGatewayException('Retrieval provider is not configured');
    }

    const controller = new AbortController();
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const onParentAbort = () => {
      controller.abort();
      rejectDeadline?.(new DOMException('Aborted', 'AbortError'));
    };
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    const timeout = setTimeout(() => {
      controller.abort();
      rejectDeadline?.(
        new GatewayTimeoutException('Retrieval provider request timed out'),
      );
    }, config.timeoutMs);

    try {
      const target = await Promise.race([
        this.urlPolicy.assertAllowed(config.url),
        deadline,
      ]);
      const response = await fetch(target, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(config.apiKey
            ? { authorization: `Bearer ${config.apiKey}` }
            : {}),
          ...(init.headers ?? {}),
        },
      });
      if (response.status >= 300 && response.status < 400) {
        throw new BadGatewayException(
          'Retrieval provider redirects are not permitted',
        );
      }
      if (!response.ok) {
        throw new BadGatewayException(
          `Retrieval provider request failed (${response.status})`,
        );
      }
      return {
        response,
        cleanup: () => {
          clearTimeout(timeout);
          parentSignal?.removeEventListener('abort', onParentAbort);
        },
      };
    } catch (error) {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', onParentAbort);
      if ((error as Error)?.name === 'AbortError') {
        throw new GatewayTimeoutException(
          'Retrieval provider request timed out',
        );
      }
      throw error;
    }
  }

  private async readBoundedBody(response: Response): Promise<string> {
    if (!response.body) {
      return '';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = '';
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > AI_RETRIEVAL_DEFAULTS.maxResponseChars) {
        await reader.cancel();
        throw new BadGatewayException(
          'Retrieval provider response exceeds the allowed size',
        );
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  }
}
