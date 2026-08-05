export class RemoteHttpError extends Error {
  constructor(
    public readonly status: number,
    message = 'Remote request failed',
  ) {
    super(message);
  }
}

export class BoundedHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async json<T>(
    path: string,
    init: RequestInit = {},
    maxResponseBytes = 2 * 1024 * 1024,
  ): Promise<T> {
    const pending = await this.request(path, init);
    try {
      const bytes = await readBounded(pending.response, maxResponseBytes);
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
      } catch {
        throw new Error('Remote response is not valid JSON');
      }
    } finally {
      pending.release();
    }
  }

  async bytes(
    path: string,
    init: RequestInit = {},
    maxResponseBytes = 25 * 1024 * 1024,
  ): Promise<Uint8Array> {
    const pending = await this.request(path, init);
    try {
      return await readBounded(pending.response, maxResponseBytes);
    } finally {
      pending.release();
    }
  }

  async discard(
    path: string,
    init: RequestInit = {},
    acceptedStatuses: number[] = [],
  ): Promise<void> {
    const pending = await this.request(path, init, acceptedStatuses);
    try {
      await pending.response.body?.cancel();
    } finally {
      pending.release();
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    acceptedStatuses: number[] = [],
  ): Promise<{ response: Response; release: () => void }> {
    const target = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);
    if (target.origin !== this.baseUrl) {
      throw new Error('Remote path escaped its configured origin');
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (init.signal?.aborted) {
        throw init.signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const signal = init.signal
        ? AbortSignal.any([controller.signal, init.signal])
        : controller.signal;
      let returned = false;
      try {
        const response = await fetch(target, {
          ...init,
          redirect: 'manual',
          signal,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${this.apiKey}`,
            ...init.headers,
          },
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new RemoteHttpError(
            response.status,
            'Remote redirects are not allowed',
          );
        }
        if (response.ok || acceptedStatuses.includes(response.status)) {
          returned = true;
          return {
            response,
            release: () => clearTimeout(timeout),
          };
        }
        await response.body?.cancel();
        const error = new RemoteHttpError(response.status);
        if (
          response.status !== 429 &&
          (response.status < 500 || response.status > 599)
        ) {
          throw error;
        }
        lastError = error;
      } catch (error) {
        lastError = error;
        if (init.signal?.aborted) {
          throw init.signal.reason ?? error;
        }
        if (
          error instanceof RemoteHttpError &&
          error.status !== 429 &&
          error.status < 500
        ) {
          throw error;
        }
      } finally {
        if (!returned) clearTimeout(timeout);
      }
      await delay(Math.min(5000, 250 * 2 ** attempt));
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Remote request failed');
  }
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error('Remote response exceeds the configured size limit');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Remote response exceeds the configured size limit');
    }
    chunks.push(chunk.value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException('Aborted', 'AbortError'),
    );
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
