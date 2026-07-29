import { GatewayTimeoutException } from '@nestjs/common';
import {
  AiProviderRequestCancelledError,
  OpenAiCompatibleProviderService,
} from './openai-compatible-provider.service';

describe('OpenAiCompatibleProviderService', () => {
  const config = {
    baseUrl: 'http://127.0.0.1:56254/v1',
    apiKey: null,
    chatModel: 'test-model',
    temperature: 0.2,
    maxOutputTokens: 100,
    requestTimeoutMs: 1000,
  };
  let service: OpenAiCompatibleProviderService;
  let originalFetch: typeof fetch;
  let idleTimeoutMs: number;

  beforeEach(() => {
    originalFetch = global.fetch;
    idleTimeoutMs = 1000;
    service = new OpenAiCompatibleProviderService(
      {
        assertAllowed: jest.fn(async (value: string) => new URL(value)),
      } as any,
      {
        getAiStreamIdleTimeoutMs: () => idleTimeoutMs,
      } as any,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('streams content and ignores reasoning_content', async () => {
    const body = [
      'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":3,"completion_tokens":1},"choices":[]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    global.fetch = jest.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    ) as any;
    const chunks: string[] = [];

    const usage = await service.stream(
      config,
      [{ role: 'user', content: 'Hi' }],
      {
        onText: (text) => {
          chunks.push(text);
        },
      },
    );

    expect(chunks).toEqual(['Hello']);
    expect(usage).toEqual({ inputTokens: 3, outputTokens: 1 });
  });

  it('rejects malformed SSE data', async () => {
    global.fetch = jest.fn(async () => new Response('data: {oops}\n\n')) as any;
    await expect(
      service.stream(config, [{ role: 'user', content: 'Hi' }], {
        onText: jest.fn(),
      }),
    ).rejects.toMatchObject({
      status: 502,
      aiErrorCode: 'provider_invalid_response',
    });
  });

  it('does not expose a remote error body', async () => {
    global.fetch = jest.fn(
      async () => new Response('secret upstream stack trace', { status: 500 }),
    ) as any;
    await expect(
      service.complete(config, [{ role: 'user', content: 'Hi' }]),
    ).rejects.toMatchObject({
      message: 'AI provider request failed (500)',
    });
  });

  it('maps network failures to a stable gateway error', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:56254');
    }) as any;

    await expect(
      service.complete(config, [{ role: 'user', content: 'Hi' }]),
    ).rejects.toMatchObject({
      status: 502,
      message: 'AI provider is unreachable',
    });
  });

  it('times out before the first SSE chunk at the configured idle timeout', async () => {
    idleTimeoutMs = 20;
    global.fetch = jest.fn(async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { status: 200 });
    }) as any;

    await expect(
      service.stream(
        { ...config, requestTimeoutMs: 200 },
        [{ role: 'user', content: 'Hi' }],
        { onText: jest.fn() },
      ),
    ).rejects.toMatchObject({
      status: 504,
      message: 'AI provider stream idle timeout exceeded',
    });
  });

  it('resets the idle timeout for every SSE chunk', async () => {
    idleTimeoutMs = 30;
    global.fetch = jest.fn(async (_url, init) => {
      const encoder = new TextEncoder();
      const timers: NodeJS.Timeout[] = [];
      let onAbort: (() => void) | undefined;
      const body = new ReadableStream({
        start(controller) {
          onAbort = () => {
            timers.forEach(clearTimeout);
            controller.error(new DOMException('Aborted', 'AbortError'));
          };
          init?.signal?.addEventListener('abort', onAbort, { once: true });
          timers.push(
            setTimeout(
              () =>
                controller.enqueue(
                  encoder.encode(
                    'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n',
                  ),
                ),
              20,
            ),
            setTimeout(
              () => controller.enqueue(encoder.encode(': keep-alive\n\n')),
              45,
            ),
            setTimeout(
              () =>
                controller.enqueue(
                  encoder.encode(
                    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
                  ),
                ),
              70,
            ),
            setTimeout(() => {
              if (onAbort) {
                init?.signal?.removeEventListener('abort', onAbort);
              }
              controller.close();
            }, 80),
          );
        },
        cancel() {
          timers.forEach(clearTimeout);
          if (onAbort) {
            init?.signal?.removeEventListener('abort', onAbort);
          }
        },
      });
      return new Response(body, { status: 200 });
    }) as any;
    const onText = jest.fn();

    await expect(
      service.stream(
        { ...config, requestTimeoutMs: 250 },
        [{ role: 'user', content: 'Hi' }],
        { onText },
      ),
    ).resolves.toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(onText).toHaveBeenCalledWith('Hello');
  });

  it('keeps the whole-request timeout active while streaming', async () => {
    idleTimeoutMs = 200;
    global.fetch = jest.fn(async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { status: 200 });
    }) as any;

    await expect(
      service.stream(
        { ...config, requestTimeoutMs: 25 },
        [{ role: 'user', content: 'Hi' }],
        { onText: jest.fn() },
      ),
    ).rejects.toMatchObject({
      status: 504,
      message: 'AI provider request timed out',
    });
  });

  it('keeps the whole-request timeout active while reading JSON', async () => {
    global.fetch = jest.fn(async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { status: 200 });
    }) as any;

    await expect(
      service.complete(
        { ...config, requestTimeoutMs: 25 },
        [{ role: 'user', content: 'Hi' }],
      ),
    ).rejects.toMatchObject({
      status: 504,
      message: 'AI provider request timed out',
    });
  });

  it('does not map an explicit cancellation to a provider timeout', async () => {
    idleTimeoutMs = 2000;
    global.fetch = jest.fn(async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { status: 200 });
    }) as any;

    const result = service.stream(
      { ...config, requestTimeoutMs: 2000 },
      [{ role: 'user', content: 'Hi' }],
      {
        onText: jest.fn(),
        isCancelled: jest.fn(async () => true),
      },
    );

    await expect(result).rejects.toBeInstanceOf(
      AiProviderRequestCancelledError,
    );
    await expect(result).rejects.not.toBeInstanceOf(GatewayTimeoutException);
  });

  it('cancels while provider URL resolution or response headers are pending', async () => {
    const delayedService = new OpenAiCompatibleProviderService(
      {
        assertAllowed: jest.fn(() => new Promise<URL>(() => undefined)),
      } as any,
      {
        getAiStreamIdleTimeoutMs: () => 1000,
      } as any,
    );
    global.fetch = jest.fn() as any;

    await expect(
      delayedService.stream(config, [{ role: 'user', content: 'Hi' }], {
        onText: jest.fn(),
        isCancelled: jest.fn(async () => true),
      }),
    ).rejects.toBeInstanceOf(AiProviderRequestCancelledError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('includes provider URL resolution in the whole-request timeout', async () => {
    const delayedService = new OpenAiCompatibleProviderService(
      {
        assertAllowed: jest.fn(() => new Promise<URL>(() => undefined)),
      } as any,
      {
        getAiStreamIdleTimeoutMs: () => 1000,
      } as any,
    );

    await expect(
      delayedService.stream(
        { ...config, requestTimeoutMs: 20 },
        [{ role: 'user', content: 'Hi' }],
        { onText: jest.fn() },
      ),
    ).rejects.toMatchObject({
      status: 504,
      message: 'AI provider request timed out',
    });
  });

  it('cleans up timers and cancels an unfinished response body', async () => {
    jest.useFakeTimers();
    idleTimeoutMs = 1000;
    const cancel = jest.fn();
    global.fetch = jest.fn(async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        },
        cancel,
      });
      return new Response(body, { status: 200 });
    }) as any;

    await service.stream(config, [{ role: 'user', content: 'Hi' }], {
      onText: jest.fn(),
      isCancelled: jest.fn(async () => false),
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
