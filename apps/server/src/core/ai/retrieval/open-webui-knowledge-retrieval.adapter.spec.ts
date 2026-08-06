import { BadGatewayException } from '@nestjs/common';
import { OpenWebUiKnowledgeRetrievalAdapter } from './open-webui-knowledge-retrieval.adapter';
import { AiRetrievalHttpClient } from './ai-retrieval-http-client.service';

describe('OpenWebUiKnowledgeRetrievalAdapter', () => {
  const workspaceId = '0198f2f5-a5a3-7000-8000-000000000001';
  const spaceId = '0198f2f5-a5a3-7000-8000-000000000002';
  const pageId = '0198f2f5-a5a3-7000-8000-000000000003';
  const secondPageId = '0198f2f5-a5a3-7000-8000-000000000004';
  const fileId = '0198f2f5-a5a3-7000-8000-000000000006';
  const config = {
    adapter: 'open-webui-knowledge-v1' as const,
    url: null,
    apiKey: null,
    timeoutMs: 1000,
    maxResults: 8,
    openWebUiBaseUrl: 'https://open-webui.example.test',
    openWebUiApiKey: 'query-key',
    openWebUiKnowledgeId: 'knowledge-1',
  };
  const request = {
    schemaVersion: 1 as const,
    requestId: '0198f2f5-a5a3-7000-8000-000000000005',
    workspaceId,
    spaceId,
    pageId,
    query: 'release process',
    allowedPageIds: [pageId],
    sourceTypes: ['page' as const],
    limit: 8,
    candidateLimit: 40,
  };

  let adapter: OpenWebUiKnowledgeRetrievalAdapter;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    adapter = new OpenWebUiKnowledgeRetrievalAdapter(
      new AiRetrievalHttpClient({
        resolveAllowed: jest.fn(async (value: string) => ({
          url: new URL(value),
          addresses: [{ address: '127.0.0.1', family: 4 }],
        })),
      } as any),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses the fixed Open WebUI collection endpoint and Bearer key', async () => {
    let calledUrl = '';
    let calledInit: RequestInit | undefined;
    global.fetch = jest.fn(async (url, init) => {
      calledUrl = String(url);
      calledInit = init;
      return new Response(
        JSON.stringify({
          documents: [['content']],
          metadatas: [[thisMetadata({ sourceId: pageId, pageId })]],
          distances: [[0.25]],
        }),
      );
    }) as any;

    await expect(adapter.retrieve(config, request)).resolves.toEqual([
      expect.objectContaining({
        sourceType: 'page',
        sourceId: pageId,
        pageId,
        text: 'content',
        score: 0.8,
      }),
    ]);
    expect(calledUrl).toBe(
      'https://open-webui.example.test/api/v1/retrieval/query/collection',
    );
    expect(calledInit?.headers).toMatchObject({
      authorization: 'Bearer query-key',
    });
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      collection_names: ['knowledge-1'],
      query: request.query,
      k: 40,
      hybrid: false,
    });
  });

  it('accepts canonical nested and compatible top-level metadata', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        documents: [['nested', 'fallback']],
        metadatas: [
          [
            thisMetadata({ sourceId: pageId, pageId }),
            {
              docmost: docmostMetadata({
                sourceId: secondPageId,
                pageId: secondPageId,
              }),
            },
          ],
        ],
        distances: [[0, 1]],
      }),
    ) as any;

    await expect(adapter.retrieve(config, request)).resolves.toEqual([
      expect.objectContaining({ sourceId: pageId, score: 1 }),
      expect.objectContaining({ sourceId: secondPageId, score: 0.5 }),
    ]);
  });

  it('accepts metadata written by the built-in v2 synchronizer', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        documents: [['v2 content']],
        metadatas: [
          [
            thisMetadata({
              schemaVersion: 2,
              bindingId: '0198f2f5-a5a3-7000-8000-000000000007',
              targetVersion: 3,
              sourceId: pageId,
              pageId,
            }),
          ],
        ],
        distances: [[0.1]],
      }),
    ) as any;

    await expect(adapter.retrieve(config, request)).resolves.toEqual([
      expect.objectContaining({
        sourceType: 'page',
        sourceId: pageId,
        pageId,
        text: 'v2 content',
      }),
    ]);
  });

  it('hydrates Docmost metadata from the Open WebUI file record', async () => {
    const calledUrls: string[] = [];
    global.fetch = jest.fn(async (url) => {
      calledUrls.push(String(url));
      if (String(url).endsWith(`/api/v1/files/${fileId}`)) {
        return jsonResponse({
          meta: thisMetadata({ sourceId: pageId, pageId }),
        });
      }
      return jsonResponse({
        documents: [['content']],
        metadatas: [[{ file_id: fileId }]],
        distances: [[0.25]],
      });
    }) as any;

    await expect(adapter.retrieve(config, request)).resolves.toEqual([
      expect.objectContaining({
        sourceId: pageId,
        pageId,
        text: 'content',
      }),
    ]);
    expect(calledUrls).toEqual([
      'https://open-webui.example.test/api/v1/retrieval/query/collection',
      `https://open-webui.example.test/api/v1/files/${fileId}`,
    ]);
  });

  it('drops malformed candidates individually and keeps valid neighbors', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        documents: [['missing metadata', 'wrong space', 'valid']],
        metadatas: [
          [
            {},
            thisMetadata({ sourceId: pageId, pageId, spaceId: secondPageId }),
            thisMetadata({ sourceId: pageId, pageId }),
          ],
        ],
        distances: [[0.1, 0.2, 0.3]],
      }),
    ) as any;

    await expect(adapter.retrieve(config, request)).resolves.toEqual([
      expect.objectContaining({ text: 'valid', sourceId: pageId }),
    ]);
  });

  it('deduplicates candidates and retains the smallest distance', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        documents: [['far', 'near']],
        metadatas: [
          [
            thisMetadata({ sourceId: pageId, pageId }),
            thisMetadata({ sourceId: pageId, pageId }),
          ],
        ],
        distances: [[0.8, 0.1]],
      }),
    ) as any;

    await expect(adapter.retrieve(config, request)).resolves.toEqual([
      expect.objectContaining({ text: 'near' }),
    ]);
  });

  it('treats an empty collection as a successful empty retrieval', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        documents: [[]],
        metadatas: [[]],
        distances: [[]],
      }),
    ) as any;

    await expect(adapter.retrieve(config, request)).resolves.toEqual([]);
  });

  it.each([
    ['mismatched arrays', [['content']], [[]], [[0.1]]],
    [
      'invalid UUID',
      [['content']],
      [[thisMetadata({ sourceId: 'not-a-uuid', pageId })]],
      [[0.1]],
    ],
    [
      'wrong workspace',
      [['content']],
      [[thisMetadata({ sourceId: pageId, pageId, workspaceId: secondPageId })]],
      [[0.1]],
    ],
  ])(
    'rejects a non-empty incompatible response: %s',
    async (_name, documents, metadatas, distances) => {
      global.fetch = jest.fn(async () =>
        jsonResponse({ documents, metadatas, distances }),
      ) as any;

      await expect(adapter.retrieve(config, request)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'retrieval_invalid_response',
        }),
      });
    },
  );

  it('rejects oversized response bodies without exposing them', async () => {
    global.fetch = jest.fn(
      async () => new Response('x'.repeat(256 * 1024 + 1)),
    ) as any;

    await expect(adapter.retrieve(config, request)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('probes version, collection access and query for config tests', async () => {
    const calledUrls: string[] = [];
    global.fetch = jest.fn(async (url) => {
      calledUrls.push(String(url));
      if (String(url).endsWith('/api/version')) {
        return jsonResponse({ version: '0.9.6' });
      }
      if (String(url).includes('/api/v1/knowledge/')) {
        return jsonResponse({ id: 'knowledge-1' });
      }
      return jsonResponse({
        documents: [[]],
        metadatas: [[]],
        distances: [[]],
      });
    }) as any;

    await expect(adapter.test(config, request)).resolves.toMatchObject({
      ok: true,
      adapter: 'open-webui-knowledge-v1',
      remoteVersion: '0.9.6',
      candidateCount: 0,
      validCandidateCount: 0,
      state: 'empty',
    });
    expect(calledUrls).toEqual([
      'https://open-webui.example.test/api/version',
      'https://open-webui.example.test/api/v1/knowledge/knowledge-1',
      'https://open-webui.example.test/api/v1/retrieval/query/collection',
    ]);
  });

  it('maps inaccessible knowledge collections to a stable error code', async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/api/version')) {
        return jsonResponse({ version: '0.9.6' });
      }
      return new Response('', { status: 403 });
    }) as any;

    await expect(adapter.test(config, request)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'retrieval_collection_unavailable',
      }),
    });
  });

  function thisMetadata(
    overrides: Record<string, unknown>,
  ): Record<string, unknown> {
    return { data: { docmost: docmostMetadata(overrides) } };
  }

  function docmostMetadata(overrides: Record<string, unknown>) {
    return {
      schemaVersion: 1,
      workspaceId,
      spaceId,
      sourceType: 'page',
      sourceId: pageId,
      pageId,
      ...overrides,
    };
  }

  function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json' },
    });
  }
});
