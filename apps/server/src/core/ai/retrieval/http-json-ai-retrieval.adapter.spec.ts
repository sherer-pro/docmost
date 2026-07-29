import {
  BadGatewayException,
  GatewayTimeoutException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { HttpJsonAiRetrievalAdapter } from './http-json-ai-retrieval.adapter';
import { AiRetrievalHttpClient } from './ai-retrieval-http-client.service';

describe('HttpJsonAiRetrievalAdapter', () => {
  const config = {
    adapter: 'http-json-v1' as const,
    url: 'https://retrieval.example.test/custom-query',
    apiKey: 'key',
    timeoutMs: 1000,
    maxResults: 8,
  };
  const request = {
    schemaVersion: 1 as const,
    requestId: '0198f2f5-a5a3-7000-8000-000000000001',
    workspaceId: '0198f2f5-a5a3-7000-8000-000000000002',
    spaceId: '0198f2f5-a5a3-7000-8000-000000000003',
    pageId: '0198f2f5-a5a3-7000-8000-000000000004',
    query: 'query',
    allowedPageIds: ['0198f2f5-a5a3-7000-8000-000000000004'],
    sourceTypes: ['page' as const],
    limit: 8,
    candidateLimit: 40,
  };
  let adapter: HttpJsonAiRetrievalAdapter;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    adapter = new HttpJsonAiRetrievalAdapter(
      new AiRetrievalHttpClient({
        assertAllowed: jest.fn(async (value: string) => new URL(value)),
      } as any),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the versioned contract to the exact configured endpoint', async () => {
    let calledUrl = '';
    let calledInit: RequestInit | undefined;
    global.fetch = jest.fn(async (url, init) => {
      calledUrl = String(url);
      calledInit = init;
      return new Response(
        JSON.stringify({
          items: [
            {
              sourceType: 'page',
              sourceId: request.pageId,
              pageId: request.pageId,
              text: 'safe text',
              score: 0.9,
            },
          ],
        }),
      );
    }) as any;

    const result = await adapter.retrieve(config, request);

    expect(calledUrl).toBe(config.url);
    expect(calledInit?.method).toBe('POST');
    expect(JSON.parse(String(calledInit?.body))).toEqual(request);
    expect(result[0]).toMatchObject({ text: 'safe text', pageId: request.pageId });
  });

  it('rejects a response body over the byte limit', async () => {
    global.fetch = jest.fn(async () =>
      new Response('x'.repeat(256 * 1024 + 1)),
    ) as any;
    await expect(adapter.retrieve(config, request)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('drops candidates whose text exceeds the per-candidate byte limit', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              sourceType: 'page',
              sourceId: request.pageId,
              pageId: request.pageId,
              text: 'я'.repeat(9000),
            },
          ],
        }),
      ),
    ) as any;
    await expect(adapter.retrieve(config, request)).resolves.toEqual([]);
  });

  it('keeps valid candidates and deduplicates by the highest score', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            { sourceType: 'page', sourceId: 'invalid', pageId: 'invalid' },
            {
              sourceType: 'page',
              sourceId: request.pageId,
              pageId: request.pageId,
              text: 'lower score',
              score: 0.2,
            },
            {
              sourceType: 'page',
              sourceId: request.pageId,
              pageId: request.pageId,
              text: 'higher score',
              score: 0.9,
            },
          ],
        }),
      ),
    ) as any;

    await expect(adapter.retrieve(config, request)).resolves.toEqual([
      expect.objectContaining({ text: 'higher score', score: 0.9 }),
    ]);
  });

  it('rejects an oversized serialized retrieval request before fetch', async () => {
    global.fetch = jest.fn() as any;
    await expect(
      adapter.retrieve(config, {
        ...request,
        query: 'x'.repeat(1024 * 1024),
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('includes URL policy resolution in the retrieval timeout', async () => {
    adapter = new HttpJsonAiRetrievalAdapter(
      new AiRetrievalHttpClient({
        assertAllowed: jest.fn(() => new Promise<URL>(() => undefined)),
      } as any),
    );

    await expect(
      adapter.retrieve({ ...config, timeoutMs: 20 }, request),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });
});
