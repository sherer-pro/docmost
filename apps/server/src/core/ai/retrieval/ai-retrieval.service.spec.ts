import { AiRetrievalService } from './ai-retrieval.service';

function queryReturning(rows: unknown[]) {
  const query = {
    innerJoin: jest.fn(() => query),
    select: jest.fn(() => query),
    where: jest.fn(() => query),
    execute: jest.fn(async () => rows),
  };
  return query;
}

describe('AiRetrievalService', () => {
  it.each([
    {
      name: 'reports ready when a candidate resolves to a readable live page',
      pages: [
        {
          id: 'page-id',
          slugId: 'live-page',
          title: 'Live page',
          workspaceId: 'workspace-id',
          spaceId: 'space-id',
          deletedAt: null,
          spaceSlug: 'docs',
        },
      ],
      expectedState: 'ready',
      expectedCount: 1,
    },
    {
      name: 'reports empty when remote candidates no longer exist locally',
      pages: [],
      expectedState: 'empty',
      expectedCount: 0,
    },
  ])('$name', async ({ pages, expectedState, expectedCount }) => {
    const adapter = {
      kind: 'http-json-v1',
      test: jest.fn(async () => ({
        ok: true,
        latencyMs: 10,
        adapter: 'http-json-v1',
        candidateCount: 1,
        validCandidateCount: 1,
        state: 'ready',
      })),
      retrieve: jest.fn(async () => [
        {
          sourceType: 'page',
          sourceId: 'page-id',
          pageId: 'page-id',
          text: 'Candidate excerpt',
          score: 0.9,
        },
      ]),
    };
    const pageAccessService = {
      getSidebarAccessSnapshot: jest.fn(async () => ({
        readablePageIds: new Set(['page-id']),
      })),
    };
    const db = {
      selectFrom: jest.fn(() => queryReturning(pages)),
    };
    const service = new AiRetrievalService(
      db as any,
      pageAccessService as any,
      adapter as any,
      { kind: 'none' } as any,
      {
        observeRetrieval: jest.fn(),
        observeRetrievalQuery: jest.fn(),
      } as any,
    );
    const config = {
      adapter: 'http-json-v1' as const,
      url: 'https://retrieval.example/query',
      apiKey: null,
      timeoutMs: 8000,
      maxResults: 8,
    };
    const request = {
      schemaVersion: 1 as const,
      requestId: 'request-id',
      workspaceId: 'workspace-id',
      spaceId: 'space-id',
      pageId: 'page-id',
      query: 'query',
      allowedPageIds: ['page-id'],
      sourceTypes: ['page' as const],
      limit: 3,
      candidateLimit: 40,
    };

    await expect(service.test(config, request, {} as any)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        candidateCount: 1,
        validCandidateCount: expectedCount,
        state: expectedState,
      }),
    );
    expect(pageAccessService.getSidebarAccessSnapshot).toHaveBeenCalledWith(
      {},
      'space-id',
    );
    expect(adapter.retrieve).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        allowedPageIds: ['page-id'],
      }),
    );
  });

  it('uses only locally resolved, readable sources and ignores remote metadata', async () => {
    const pageId = '0198f2f5-a5a3-7000-8000-000000000001';
    const otherPageId = '0198f2f5-a5a3-7000-8000-000000000002';
    const rowId = '0198f2f5-a5a3-7000-8000-000000000003';
    const attachmentId = '0198f2f5-a5a3-7000-8000-000000000004';
    const workspaceId = '0198f2f5-a5a3-7000-8000-000000000005';
    const spaceId = '0198f2f5-a5a3-7000-8000-000000000006';
    const unreadablePageId = '0198f2f5-a5a3-7000-8000-000000000007';
    const deletedPageId = '0198f2f5-a5a3-7000-8000-000000000008';
    const db = {
      selectFrom: jest.fn((table: string) => {
        if (table === 'databaseRows') {
          return queryReturning([{ id: rowId, pageId, workspaceId }]);
        }
        if (table === 'attachments') {
          return queryReturning([
            {
              id: attachmentId,
              pageId,
              workspaceId,
              spaceId,
              fileName: 'local.pdf',
              deletedAt: null,
            },
          ]);
        }
        return queryReturning([
          {
            id: pageId,
            slugId: 'local-page',
            title: 'Local title',
            workspaceId,
            spaceId,
            deletedAt: null,
            spaceSlug: 'docs',
          },
          {
            id: otherPageId,
            slugId: 'other-page',
            title: 'Other space',
            workspaceId,
            spaceId: '0198f2f5-a5a3-7000-8000-000000000099',
            deletedAt: null,
            spaceSlug: 'other',
          },
          {
            id: unreadablePageId,
            slugId: 'unreadable-page',
            title: 'Unreadable page',
            workspaceId,
            spaceId,
            deletedAt: null,
            spaceSlug: 'docs',
          },
          {
            id: deletedPageId,
            slugId: 'deleted-page',
            title: 'Deleted page',
            workspaceId,
            spaceId,
            deletedAt: new Date(),
            spaceSlug: 'docs',
          },
        ]);
      }),
    };
    const service = new AiRetrievalService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {
        observeRetrieval: jest.fn(),
        observeRetrievalQuery: jest.fn(),
      } as any,
    );

    const sources = await (service as any).resolveSafeSources(
      [
        {
          sourceType: 'page',
          sourceId: pageId,
          pageId,
          text: 'Page excerpt',
          score: 0.9,
        },
        {
          sourceType: 'database_row',
          sourceId: rowId,
          pageId,
          text: 'Row excerpt',
          score: 0.8,
        },
        {
          sourceType: 'attachment',
          sourceId: attachmentId,
          pageId,
          text: 'Attachment excerpt',
          score: 0.7,
        },
        {
          sourceType: 'page',
          sourceId: otherPageId,
          pageId: otherPageId,
          text: 'Cross-space excerpt',
          score: 1,
        },
        {
          sourceType: 'page',
          sourceId: unreadablePageId,
          pageId: unreadablePageId,
          text: 'Unreadable excerpt',
          score: 1,
        },
        {
          sourceType: 'page',
          sourceId: deletedPageId,
          pageId: deletedPageId,
          text: 'Deleted excerpt',
          score: 1,
        },
      ],
      new Set([pageId, otherPageId, deletedPageId]),
      workspaceId,
      spaceId,
      8,
    );

    expect(sources).toEqual([
      expect.objectContaining({
        sourceType: 'page',
        sourceTitle: 'Local title',
        sourceUrl: '/s/docs/p/local-page',
      }),
      expect.objectContaining({
        sourceType: 'database_row',
        sourceTitle: 'Local title',
        pageId,
      }),
      expect.objectContaining({
        sourceType: 'attachment',
        sourceTitle: 'local.pdf',
        pageId,
      }),
    ]);
  });

  it('degrades to a stable failed outcome when the external adapter fails', async () => {
    const httpAdapter = {
      kind: 'http-json-v1',
      isConfigured: jest.fn(() => true),
      retrieve: jest.fn(async () => {
        throw new Error('remote secret body');
      }),
    };
    const service = new AiRetrievalService(
      {} as any,
      {
        getSidebarAccessSnapshot: jest.fn(async () => ({
          readablePageIds: new Set(['page-id']),
        })),
      } as any,
      httpAdapter as any,
      { kind: 'none' } as any,
      {
        observeRetrieval: jest.fn(),
        observeRetrievalQuery: jest.fn(),
      } as any,
    );

    await expect(
      service.retrieveSafe({
        config: {
          adapter: 'http-json-v1',
          url: 'https://retrieval.example/query',
          apiKey: null,
          timeoutMs: 8000,
          maxResults: 8,
        },
        user: {} as any,
        requested: true,
        request: {
          schemaVersion: 1,
          requestId: 'request-id',
          workspaceId: 'workspace-id',
          spaceId: 'space-id',
          pageId: 'page-id',
          query: 'query',
          allowedPageIds: [],
          sourceTypes: ['page'],
          limit: 8,
          candidateLimit: 40,
        },
      }),
    ).resolves.toEqual({
      status: 'failed',
      errorCode: 'retrieval_unavailable',
      sources: [],
    });
  });
});
