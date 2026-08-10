jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { ForbiddenException } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * The database API authorizes on space roles. Page access rules are a second,
 * finer-grained layer that the space ability cannot see, so these tests pin the
 * behaviour that a row page denied by a page rule is neither readable nor
 * writable through the database endpoints.
 */
describe('DatabaseService page access enforcement', () => {
  const DATABASE = {
    id: 'db-1',
    name: 'Database',
    spaceId: 'space-1',
    workspaceId: 'ws-1',
    pageId: 'db-root-page',
  };

  const user = { id: 'u-1', locale: 'en-US', workspaceId: 'ws-1' } as any;

  function createService(readablePageIds: string[]) {
    const databaseRepo = {
      findById: jest.fn(async () => DATABASE),
      findBySpaceId: jest.fn(async () => [DATABASE]),
    };
    const databaseRowRepo = {
      findByDatabaseId: jest.fn(async () => [
        { id: 'row-1', pageId: 'allowed-page', cells: [] },
        { id: 'row-2', pageId: 'denied-page', cells: [] },
      ]),
      findByDatabaseIdPaginated: jest.fn(async () => ({
        items: [
          { id: 'row-1', pageId: 'allowed-page', cells: [] },
          { id: 'row-2', pageId: 'denied-page', cells: [] },
        ],
        nextCursor: null,
        hasMore: false,
      })),
      findByDatabaseAndPage: jest.fn(),
      findActiveByPageId: jest.fn(async () => ({
        id: 'row-2',
        databaseId: DATABASE.id,
        pageId: 'denied-page',
      })),
    };
    const databasePropertyRepo = { findByDatabaseId: jest.fn(async () => []) };
    const pageRepo = {
      findById: jest.fn(async (id: string) => ({
        id,
        title: 'Row',
        slugId: 'row-slug',
        spaceId: 'space-1',
        workspaceId: 'ws-1',
        deletedAt: null,
      })),
    };
    const spaceAbility = {
      createForUser: jest.fn(async () => ({ cannot: () => false })),
    };

    const readable = new Set(readablePageIds);
    const pageAccessService = {
      getSidebarAccessSnapshot: jest.fn(async () => ({
        readablePageIds: readable,
        visiblePageIds: readable,
        writablePageIds: readable,
      })),
      assertCanReadPage: jest.fn(
        async (_page?: unknown, _user?: unknown) => undefined,
      ),
      assertCanWritePage: jest.fn(
        async (_page?: unknown, _user?: unknown) => undefined,
      ),
      assertCanCreateChild: jest.fn(
        async (_page?: unknown, _user?: unknown) => undefined,
      ),
    };

    const service = new DatabaseService(
      databaseRepo as any,
      databaseRowRepo as any,
      { findByDatabaseAndPage: jest.fn(async () => []) } as any,
      databasePropertyRepo as any,
      { findByDatabaseId: jest.fn(async () => []) } as any,
      pageRepo as any,
      {} as any,
      {} as any,
      { findById: jest.fn(async () => null) } as any,
      spaceAbility as any,
      pageAccessService as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, pageAccessService, databaseRowRepo };
  }

  it('hides rows whose page is denied by a page access rule', async () => {
    const { service } = createService(['allowed-page']);

    const rows = (await service.listRows('db-1', user, 'ws-1')) as any[];

    expect(rows.map((row) => row.id)).toEqual(['row-1']);
  });

  it('hides denied rows on the paginated read path too', async () => {
    const { service } = createService(['allowed-page']);

    const result = (await service.listRows('db-1', user, 'ws-1', {
      limit: 50,
    } as any)) as any;

    expect(result.items.map((row: any) => row.id)).toEqual(['row-1']);
  });

  it('returns every row when the user may read all row pages', async () => {
    const { service } = createService(['allowed-page', 'denied-page']);

    const rows = (await service.listRows('db-1', user, 'ws-1')) as any[];

    expect(rows.map((row) => row.id)).toEqual(['row-1', 'row-2']);
  });

  it('refuses to mutate a row page the user cannot write', async () => {
    const { service, pageAccessService } = createService(['allowed-page']);
    pageAccessService.assertCanWritePage.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.updateRow(
        'db-1',
        'denied-page',
        { title: 'Renamed' } as any,
        user,
        'ws-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageAccessService.assertCanWritePage).toHaveBeenCalled();
  });

  it('checks create-child access for the parent page when adding a row', async () => {
    const { service, pageAccessService } = createService(['allowed-page']);
    pageAccessService.assertCanCreateChild.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.createRow(
        'db-1',
        { parentPageId: 'db-root-page' } as any,
        user,
        'ws-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageAccessService.assertCanCreateChild).toHaveBeenCalled();
  });

  it('refuses to return row context when the row page is denied', async () => {
    const { service, pageAccessService } = createService(['allowed-page']);
    pageAccessService.assertCanReadPage.mockImplementation(
      async (page?: unknown) => {
        if ((page as { id?: string } | undefined)?.id === 'denied-page') {
          throw new ForbiddenException();
        }
      },
    );

    await expect(
      service.getRowContextByPage('denied-page', user, 'ws-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageAccessService.assertCanReadPage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'denied-page' }),
      user,
    );
  });

  it('refuses to return database metadata when its root page is denied', async () => {
    const { service, pageAccessService } = createService(['allowed-page']);
    pageAccessService.assertCanReadPage.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.getDatabase(DATABASE.id, user, 'ws-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageAccessService.assertCanReadPage).toHaveBeenCalledWith(
      expect.objectContaining({ id: DATABASE.pageId }),
      user,
    );
  });
});
