import {
  AiSourceAccessChangedError,
  AiSourceAccessService,
} from './ai-source-access.service';

function queryReturning(rows: unknown[]) {
  const query: any = {
    select: jest.fn(() => query),
    innerJoin: jest.fn(() => query),
    where: jest.fn(() => query),
    execute: jest.fn(async () => rows),
    executeTakeFirst: jest.fn(async () => rows[0]),
  };
  return query;
}

describe('AiSourceAccessService', () => {
  const user = { id: 'user-1' } as any;
  const params = {
    user,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
  };

  function createService(options?: {
    excluded?: string[];
    dictionaryEnabled?: boolean;
    canReadDictionary?: boolean;
  }) {
    const db = {
      selectFrom: jest.fn((table: string) => {
        if (table === 'pages') {
          return queryReturning(
            [{ id: 'page-1' }, { id: 'page-2' }].filter(
              (page) => !options?.excluded?.includes(page.id),
            ),
          );
        }
        if (table === 'databaseRows') {
          return queryReturning([
            {
              id: 'row-1',
              pageId: 'page-1',
              workspaceId: 'workspace-1',
              archivedAt: null,
            },
          ]);
        }
        if (table === 'attachments') {
          return queryReturning([
            {
              id: 'attachment-1',
              pageId: 'page-1',
              workspaceId: 'workspace-1',
              spaceId: 'space-1',
              deletedAt: null,
            },
          ]);
        }
        if (table === 'spaces') {
          return queryReturning([
            {
              settings: {
                dictionary: { enabled: options?.dictionaryEnabled ?? false },
              },
            },
          ]);
        }
        if (table === 'dictionaryTerms') {
          return queryReturning([{ id: 'term-1' }]);
        }
        return queryReturning([]);
      }),
    };
    return new AiSourceAccessService(
      db as any,
      {
        getSidebarAccessSnapshot: jest.fn(async () => ({
          readablePageIds: new Set(['page-1', 'page-2']),
        })),
      } as any,
      {
        getExcludedPageIds: jest.fn(
          async () => new Set(options?.excluded ?? []),
        ),
      } as any,
      {
        createForUser: jest.fn(async () => ({
          can: jest.fn(() => options?.canReadDictionary ?? true),
        })),
      } as any,
    );
  }

  it('requires current ACL, policy and live source identity', async () => {
    const service = createService({ excluded: ['page-2'] });
    await expect(
      service.filterAccessible(
        [
          { sourceType: 'page', sourceId: 'page-1', pageId: 'page-1' },
          {
            sourceType: 'database_row',
            sourceId: 'row-1',
            pageId: 'page-1',
          },
          {
            sourceType: 'attachment',
            sourceId: 'attachment-1',
            pageId: 'page-1',
          },
          {
            sourceType: 'attachment',
            sourceId: 'replaced-attachment',
            pageId: 'page-1',
          },
          { sourceType: 'page', sourceId: 'page-2', pageId: 'page-2' },
        ],
        params,
      ),
    ).resolves.toEqual([
      { sourceType: 'page', sourceId: 'page-1', pageId: 'page-1' },
      {
        sourceType: 'database_row',
        sourceId: 'row-1',
        pageId: 'page-1',
      },
      {
        sourceType: 'attachment',
        sourceId: 'attachment-1',
        pageId: 'page-1',
      },
    ]);
  });

  it('raises the stable access-change error when any dependency is revoked', async () => {
    const service = createService({ excluded: ['page-2'] });
    await expect(
      service.assertAccessible(
        [{ sourceType: 'page', sourceId: 'page-2', pageId: 'page-2' }],
        params,
      ),
    ).rejects.toBeInstanceOf(AiSourceAccessChangedError);
  });

  it('accepts only active enabled dictionary terms with null pageId and Read Page ability', async () => {
    const enabled = createService({ dictionaryEnabled: true });
    await expect(
      enabled.filterAccessible(
        [
          {
            sourceType: 'dictionary_term',
            sourceId: 'term-1',
            pageId: null,
          },
          {
            sourceType: 'dictionary_term',
            sourceId: 'term-1',
            pageId: 'page-1',
          },
        ],
        params,
      ),
    ).resolves.toEqual([
      { sourceType: 'dictionary_term', sourceId: 'term-1', pageId: null },
    ]);

    await expect(
      createService({ dictionaryEnabled: false }).filterAccessible(
        [
          {
            sourceType: 'dictionary_term',
            sourceId: 'term-1',
            pageId: null,
          },
        ],
        params,
      ),
    ).resolves.toEqual([]);
    await expect(
      createService({
        dictionaryEnabled: true,
        canReadDictionary: false,
      }).filterAccessible(
        [
          {
            sourceType: 'dictionary_term',
            sourceId: 'term-1',
            pageId: null,
          },
        ],
        params,
      ),
    ).resolves.toEqual([]);
  });
});
