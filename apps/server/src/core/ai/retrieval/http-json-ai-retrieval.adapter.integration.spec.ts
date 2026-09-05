import { BadGatewayException } from '@nestjs/common';
import { once } from 'node:events';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { HttpJsonAiRetrievalAdapter } from './http-json-ai-retrieval.adapter';
import { AiRetrievalHttpClient } from './ai-retrieval-http-client.service';

describe('HttpJsonAiRetrievalAdapter integration', () => {
  const pageId = '0198f2f5-a5a3-7000-8000-000000000004';
  let server: Server;
  let origin: string;
  let adapter: HttpJsonAiRetrievalAdapter;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = request.url ?? '';
      if (path === '/valid') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            items: [
              {
                sourceType: 'page',
                sourceId: pageId,
                pageId,
                text: 'safe text',
                score: 0.9,
              },
            ],
          }),
        );
        return;
      }
      if (path === '/malformed') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{not-json');
        return;
      }
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('remote body must not be exposed');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    adapter = new HttpJsonAiRetrievalAdapter(
      new AiRetrievalHttpClient({
        resolveAllowed: jest.fn(async (value: string) => ({
          url: new URL(value),
          addresses: [{ address: '127.0.0.1', family: 4 }],
        })),
      } as any),
    );
  });

  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });

  const config = (scenario: string) => ({
    adapter: 'http-json-v1' as const,
    url: `${origin}/${scenario}`,
    apiKey: null,
    timeoutMs: 5000,
    maxResults: 8,
    queryMode: 'vector' as const,
    followUpRewriteEnabled: false,
  });

  const request = {
    schemaVersion: 1 as const,
    requestId: '0198f2f5-a5a3-7000-8000-000000000001',
    workspaceId: '0198f2f5-a5a3-7000-8000-000000000002',
    spaceId: '0198f2f5-a5a3-7000-8000-000000000003',
    pageId,
    query: 'query',
    allowedPageIds: [pageId],
    sourceTypes: ['page' as const],
    limit: 8,
    candidateLimit: 40,
  };

  it('reads valid candidates from a real HTTP endpoint', async () => {
    await expect(adapter.retrieve(config('valid'), request)).resolves.toEqual([
      {
        sourceType: 'page',
        sourceId: pageId,
        pageId,
        text: 'safe text',
        score: 0.9,
      },
    ]);
  });

  it('rejects malformed JSON from a real HTTP endpoint', async () => {
    await expect(
      adapter.retrieve(config('malformed'), request),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('maps forbidden responses without exposing their body', async () => {
    const error = await adapter
      .retrieve(config('forbidden'), request)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).toBe('Retrieval provider request failed (403)');
    expect(error.message).not.toContain('remote body');
  });
});
