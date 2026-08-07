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

  function createService(options?: { excluded?: string[] }) {
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
});
