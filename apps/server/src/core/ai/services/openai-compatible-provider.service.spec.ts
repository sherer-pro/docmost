import { GatewayTimeoutException } from '@nestjs/common';
import {
  AiProviderRequestCancelledError,
  OpenAiCompatibleProviderService,
} from './openai-compatible-provider.service';

jest.mock('./ai-pinned-http.util', () => ({
  createAiPinnedDispatcher: jest.fn(() => ({
    dispatcher: {},
    close: jest.fn(async () => undefined),
  })),
}));

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
        resolveAllowed: jest.fn(async (value: string) => ({
          url: new URL(value),
          addresses: [{ address: '127.0.0.1', family: 4 }],
        })),
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

  it('streams content and reasoning_content separately', async () => {
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
    const reasoningChunks: string[] = [];

    const usage = await service.stream(
      config,
      [{ role: 'user', content: 'Hi' }],
      {
        onText: (text) => {
          chunks.push(text);
        },
        onReasoning: (text) => {
          reasoningChunks.push(text);
        },
      },
    );

    expect(chunks).toEqual(['Hello']);
    expect(reasoningChunks).toEqual(['hidden']);
    expect(usage).toEqual({ inputTokens: 3, outputTokens: 1 });
  });

  it('supports reasoning and prefers reasoning_content when both are present', async () => {
    const body = [
      'data: {"choices":[{"delta":{"reasoning":"fallback"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"preferred","reasoning":"duplicate"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    global.fetch = jest.fn(async () => new Response(body)) as any;
    const reasoningChunks: string[] = [];

    await service.stream(config, [{ role: 'user', content: 'Hi' }], {
      onText: jest.fn(),
      onReasoning: (text) => {
        reasoningChunks.push(text);
      },
    });

    expect(reasoningChunks).toEqual(['fallback', 'preferred']);
  });

  it('discards reasoning when no reasoning handler is configured', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n' +
            'data: [DONE]\n\n',
        ),
    ) as any;

    await expect(
      service.stream(config, [{ role: 'user', content: 'Hi' }], {
        onText: jest.fn(),
      }),
    ).resolves.toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('ignores structured reasoning payloads', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          'data: {"choices":[{"delta":{"reasoning_content":{"text":"hidden"},"reasoning":["hidden"]}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
            'data: [DONE]\n\n',
        ),
    ) as any;
    const onReasoning = jest.fn();

    await service.stream(config, [{ role: 'user', content: 'Hi' }], {
      onText: jest.fn(),
      onReasoning,
    });

    expect(onReasoning).not.toHaveBeenCalled();
  });

  it('rejects a completed stream without answer or reasoning content', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          'data: {"usage":{"prompt_tokens":16379,"completion_tokens":1},"choices":[]}\n\n' +
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
            'data: [DONE]\n\n',
        ),
    ) as any;

    await expect(
      service.stream(config, [{ role: 'user', content: 'Hi' }], {
        onText: jest.fn(),
        onReasoning: jest.fn(),
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'AI provider returned no content',
    });
  });

  it('applies the combined stream text limit to reasoning', async () => {
    const reasoning = 'r'.repeat(220_000);
    const frame = `data: ${JSON.stringify({
      choices: [{ delta: { reasoning_content: reasoning } }],
    })}\n\n`;
    global.fetch = jest.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              for (let index = 0; index < 39; index += 1) {
                controller.enqueue(encoder.encode(frame));
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            },
          }),
        ),
    ) as any;

    await expect(
      service.stream(config, [{ role: 'user', content: 'Hi' }], {
        onText: jest.fn(),
        onReasoning: jest.fn(),
      }),
    ).rejects.toMatchObject({
      status: 502,
      aiErrorCode: 'provider_invalid_response',
      message: 'AI provider stream exceeded the text limit',
    });
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

  it('parses bounded OpenAI-compatible tool calls', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'getTree',
                        arguments: '{}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
        ),
    ) as any;

    const response = await service.completeWithTools(
      config,
      [{ role: 'user', content: 'Inspect the space' }],
      [
        {
          type: 'function',
          function: {
            name: 'getTree',
            description: 'List pages',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    );

    expect(response).toEqual({
      content: '',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'getTree', arguments: '{}' },
        },
      ],
      usage: { inputTokens: 10, outputTokens: 2 },
    });
  });

  it('fails closed on malformed provider tool calls', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'getTree', arguments: {} },
                    },
                  ],
                },
              },
            ],
          }),
        ),
    ) as any;

    await expect(
      service.completeWithTools(config, [{ role: 'user', content: 'Hi' }], []),
    ).rejects.toMatchObject({
      status: 502,
      aiErrorCode: 'provider_invalid_response',
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
    idleTimeoutMs = 100;
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
              40,
            ),
            setTimeout(
              () =>
                controller.enqueue(
                  encoder.encode(
                    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
                  ),
                ),
              60,
            ),
            setTimeout(() => {
              if (onAbort) {
                init?.signal?.removeEventListener('abort', onAbort);
              }
              controller.close();
            }, 70),
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
        { ...config, requestTimeoutMs: 1_000 },
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
      service.complete({ ...config, requestTimeoutMs: 25 }, [
        { role: 'user', content: 'Hi' },
      ]),
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
        resolveAllowed: jest.fn(
          () => new Promise<never>(() => undefined),
        ),
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

  it('cancels a non-streaming tool request while URL resolution is pending', async () => {
    const delayedService = new OpenAiCompatibleProviderService(
      {
        resolveAllowed: jest.fn(
          () => new Promise<never>(() => undefined),
        ),
      } as any,
      {
        getAiStreamIdleTimeoutMs: () => 1000,
      } as any,
    );
    global.fetch = jest.fn() as any;

    await expect(
      delayedService.completeWithTools(
        config,
        [{ role: 'user', content: 'Hi' }],
        [],
        'auto',
        jest.fn(async () => true),
      ),
    ).rejects.toBeInstanceOf(AiProviderRequestCancelledError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('includes provider URL resolution in the whole-request timeout', async () => {
    const delayedService = new OpenAiCompatibleProviderService(
      {
        resolveAllowed: jest.fn(
          () => new Promise<never>(() => undefined),
        ),
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
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
                'data: [DONE]\n\n',
            ),
          );
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
