import { BadGatewayException } from '@nestjs/common';
import { once } from 'node:events';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  AiProviderRequestCancelledError,
  OpenAiCompatibleProviderService,
} from './openai-compatible-provider.service';

describe('OpenAiCompatibleProviderService SSE integration', () => {
  let server: Server;
  let origin: string;
  let service: OpenAiCompatibleProviderService;
  let idleTimeoutMs: number;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = request.url ?? '';
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      response.flushHeaders();

      if (path.includes('/no-first-chunk/')) {
        return;
      }

      if (path.includes('/periodic/')) {
        const timers = [
          setTimeout(
            () =>
              response.write(
                'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n',
              ),
            100,
          ),
          setTimeout(() => response.write(': keep-alive\n\n'), 300),
          setTimeout(
            () =>
              response.write(
                'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
              ),
            500,
          ),
          setTimeout(
            () =>
              response.write(
                'data: {"usage":{"prompt_tokens":3,"completion_tokens":1},"choices":[]}\n\n',
              ),
            700,
          ),
          setTimeout(() => response.end('data: [DONE]\n\n'), 900),
        ];
        response.on('close', () => timers.forEach(clearTimeout));
        return;
      }

      if (path.includes('/malformed/')) {
        response.end('data: {not-json}\n\n');
        return;
      }

      if (path.includes('/disconnect/')) {
        response.write(
          'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        );
        setTimeout(() => response.destroy(), 10);
        return;
      }

      if (path.includes('/reasoning-only/')) {
        response.end(
          'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n' +
            'data: [DONE]\n\n',
        );
        return;
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
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

  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });

  const config = (scenario: string, requestTimeoutMs = 1000) => ({
    baseUrl: `${origin}/${scenario}/v1`,
    apiKey: null,
    chatModel: 'test-model',
    temperature: 0.2,
    maxOutputTokens: 100,
    requestTimeoutMs,
  });

  it('times out when the server sends no first chunk', async () => {
    idleTimeoutMs = 30;

    await expect(
      service.stream(
        config('no-first-chunk', 500),
        [{ role: 'user', content: 'Hi' }],
        { onText: jest.fn() },
      ),
    ).rejects.toMatchObject({
      status: 504,
      message: 'AI provider stream idle timeout exceeded',
    });
  });

  it('keeps a periodic SSE stream alive and returns usage', async () => {
    idleTimeoutMs = 500;
    const onText = jest.fn();

    await expect(
      service.stream(
        config('periodic', 2500),
        [{ role: 'user', content: 'Hi' }],
        { onText },
      ),
    ).resolves.toEqual({ inputTokens: 3, outputTokens: 1 });
    expect(onText).toHaveBeenCalledWith('Hello');
  });

  it('rejects malformed SSE from the fake provider', async () => {
    await expect(
      service.stream(config('malformed'), [{ role: 'user', content: 'Hi' }], {
        onText: jest.fn(),
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('maps a disconnected provider stream to a stable gateway error', async () => {
    await expect(
      service.stream(config('disconnect'), [{ role: 'user', content: 'Hi' }], {
        onText: jest.fn(),
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'AI provider stream disconnected',
    });
  });

  it('ignores reasoning-only frames', async () => {
    const onText = jest.fn();

    await expect(
      service.stream(
        config('reasoning-only'),
        [{ role: 'user', content: 'Hi' }],
        { onText },
      ),
    ).resolves.toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(onText).not.toHaveBeenCalled();
  });

  it('cancels an active fake-provider request without a timeout error', async () => {
    idleTimeoutMs = 2000;

    await expect(
      service.stream(
        config('no-first-chunk', 2000),
        [{ role: 'user', content: 'Hi' }],
        {
          onText: jest.fn(),
          isCancelled: jest.fn(async () => true),
        },
      ),
    ).rejects.toBeInstanceOf(AiProviderRequestCancelledError);
  });
});
