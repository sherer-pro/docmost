import { Dispatcher } from 'undici';
import { AiErrorCode } from '@docmost/api-contract';
import {
  AiResolvedAddress,
} from '../services/ai-outbound-url-policy.service';
import { createAiPinnedDispatcher } from '../services/ai-pinned-http.util';
import { AI_MCP_MAX_WIRE_BYTES } from './ai-mcp.constants';

export class AiMcpTransportError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AiMcpTransportError';
  }
}

export type AiMcpFetchLike = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type AiMcpPinnedFetch = {
  fetch: AiMcpFetchLike;
  /** Total response bytes observed across every request on this connection. */
  wireBytes(): number;
  /** Aborts every in-flight and future request on this connection. */
  abort(): void;
  close(): Promise<void>;
};

type CreateOptions = {
  /** The exact URL the transport is allowed to contact. */
  approvedHref: string;
  addresses: readonly AiResolvedAddress[];
  maxWireBytes?: number;
  /** Injection seam for tests. */
  fetchImpl?: AiMcpFetchLike;
  /** Injection seam for tests: skip building a real undici dispatcher. */
  dispatcher?: Dispatcher | null;
};

function countChunk(chunk: unknown): number {
  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk, 'utf8');
  }
  return 0;
}

/**
 * Bounds a response body by size while it streams.
 *
 * A streaming cap rather than a buffered read, because it has to bound an SSE
 * stream that never ends on its own.
 */
function capResponseBytes(
  response: Response,
  maxBytes: number,
  addBytes: (bytes: number) => void,
): Response {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    throw new AiMcpTransportError(
      'external_mcp_invalid_response',
      'External MCP response exceeds the size limit',
    );
  }

  if (!response.body) {
    return response;
  }

  let total = 0;
  const counting = new TransformStream({
    transform(chunk, controller) {
      const size = countChunk(chunk);
      total += size;
      addBytes(size);
      if (total > maxBytes) {
        controller.error(
          new AiMcpTransportError(
            'external_mcp_invalid_response',
            'External MCP response exceeds the size limit',
          ),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });

  return new Response(response.body.pipeThrough(counting), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Builds the fetch implementation the MCP transport must use.
 *
 * Every transport policy lives here rather than in `requestInit`, because the
 * Streamable HTTP client:
 *
 * - overwrites `requestInit.signal` with its own abort controller on POST and
 *   DELETE (`client/streamableHttp.js`), so an injected signal is only
 *   respected inside this override, and
 * - does not spread `requestInit` at all for the GET SSE stream, so a
 *   `redirect` set there would silently not apply to that request.
 */
export function createAiMcpPinnedFetch(
  options: CreateOptions,
): AiMcpPinnedFetch {
  const maxWireBytes = options.maxWireBytes ?? AI_MCP_MAX_WIRE_BYTES;
  const baseFetch = options.fetchImpl ?? (globalThis.fetch as AiMcpFetchLike);
  const pinned =
    options.dispatcher === undefined
      ? createAiPinnedDispatcher(options.addresses)
      : { dispatcher: options.dispatcher, close: async () => {} };
  const controller = new AbortController();
  let wireBytes = 0;

  const fetchFn: AiMcpFetchLike = async (url, init) => {
    // The transport should only ever contact its own URL. Checking it here makes
    // that an enforced invariant rather than a reading of the SDK's internals.
    const href = typeof url === 'string' ? url : url.toString();
    if (href !== options.approvedHref) {
      throw new AiMcpTransportError(
        'external_mcp_url_rejected',
        'External MCP transport attempted a different URL',
      );
    }

    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;

    const response = await baseFetch(href, {
      ...init,
      signal,
      redirect: 'manual',
      ...(pinned.dispatcher ? { dispatcher: pinned.dispatcher } : {}),
    } as RequestInit);

    // The SDK only checks `response.ok` on POST, so redirects are rejected here
    // for every request the transport makes, including the GET SSE stream.
    if (
      response.type === 'opaqueredirect' ||
      (response.status >= 300 && response.status < 400)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiMcpTransportError(
        'external_mcp_invalid_response',
        'External MCP redirects are not permitted',
      );
    }

    return capResponseBytes(response, maxWireBytes, (bytes) => {
      wireBytes += bytes;
    });
  };

  return {
    fetch: fetchFn,
    wireBytes: () => wireBytes,
    abort: () => controller.abort(),
    close: async () => {
      controller.abort();
      await pinned.close();
    },
  };
}
