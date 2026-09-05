import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AiRetrievalUrlPolicyService } from '../services/ai-retrieval-url-policy.service';
import {
  AiPinnedDispatcher,
  createAiPinnedDispatcher,
} from '../services/ai-pinned-http.util';
import type { Dispatcher } from 'undici';

export class AiRetrievalHttpError extends BadGatewayException {
  constructor(
    public readonly remoteStatus: number,
    message = 'Retrieval provider request failed',
  ) {
    super(message);
  }
}

type RetrievalRequestOptions = {
  url: string;
  apiKey?: string | null;
  timeoutMs: number;
  method?: 'GET' | 'POST';
  body?: string;
  maxRequestBytes: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
  invalidResponseCode?: string;
};

@Injectable()
export class AiRetrievalHttpClient {
  constructor(private readonly urlPolicy: AiRetrievalUrlPolicyService) {}

  async requestJson<T>(options: RetrievalRequestOptions): Promise<T> {
    const requestBytes = Buffer.byteLength(options.body ?? '', 'utf8');
    if (requestBytes > options.maxRequestBytes) {
      throw new PayloadTooLargeException(
        'Retrieval request exceeds the allowed size',
      );
    }

    const controller = new AbortController();
    let abortReason: unknown;
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const abort = (reason: unknown) => {
      abortReason ??= reason;
      controller.abort();
      rejectDeadline?.(reason);
    };
    const onParentAbort = () =>
      abort(new DOMException('Aborted', 'AbortError'));
    options.signal?.addEventListener('abort', onParentAbort, { once: true });
    if (options.signal?.aborted) {
      onParentAbort();
    }
    const timeout = setTimeout(
      () =>
        abort(
          new GatewayTimeoutException('Retrieval provider request timed out'),
        ),
      options.timeoutMs,
    );
    let pinnedDispatcher: AiPinnedDispatcher | undefined;

    try {
      const resolvedTarget = await Promise.race([
        this.urlPolicy.resolveAllowed(options.url),
        deadline,
      ]);
      pinnedDispatcher = createAiPinnedDispatcher(resolvedTarget.addresses);
      const response = await Promise.race([
        fetch(resolvedTarget.url, {
          method: options.method ?? 'GET',
          body: options.body,
          redirect: 'manual',
          signal: controller.signal,
          dispatcher: pinnedDispatcher.dispatcher,
          headers: {
            accept: 'application/json',
            ...(options.body ? { 'content-type': 'application/json' } : {}),
            ...(options.apiKey
              ? { authorization: `Bearer ${options.apiKey}` }
              : {}),
          },
        } as RequestInit & { dispatcher: Dispatcher }),
        deadline,
      ]);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new BadGatewayException(
          'Retrieval provider redirects are not permitted',
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new AiRetrievalHttpError(
          response.status,
          `Retrieval provider request failed (${response.status})`,
        );
      }

      const raw = await Promise.race([
        this.readBoundedBody(response, options.maxResponseBytes),
        deadline,
      ]);
      try {
        return JSON.parse(raw) as T;
      } catch {
        throw new BadGatewayException({
          code: options.invalidResponseCode ?? 'retrieval_invalid_response',
          message: 'Retrieval provider returned invalid JSON',
        });
      }
    } catch (error) {
      if (abortReason) {
        if (abortReason instanceof GatewayTimeoutException) {
          throw abortReason;
        }
        throw abortReason;
      }
      if ((error as Error)?.name === 'AbortError') {
        if (options.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        throw new GatewayTimeoutException(
          'Retrieval provider request timed out',
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onParentAbort);
      await pinnedDispatcher?.close();
    }
  }

  private async readBoundedBody(
    response: Response,
    maxBytes: number,
  ): Promise<string> {
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
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new BadGatewayException({
          code: 'retrieval_response_too_large',
          message: 'Retrieval provider response exceeds the allowed size',
        });
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  }
}
