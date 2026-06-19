import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageAccessService } from '../page-access/page-access.service';

jest.mock('kysely/helpers/postgres', () => ({
  jsonArrayFrom: jest.fn(() => ({
    as: jest.fn((alias: string) => ({ alias })),
  })),
  jsonObjectFrom: jest.fn(() => ({
    as: jest.fn((alias: string) => ({ alias })),
  })),
}));

interface QueryBuilderState {
  whereCalls: unknown[][];
  orderByCalls: unknown[][];
  selectFromCalls: string[];
  notCalls: unknown[];
}

function createSubqueryBuilder(state?: QueryBuilderState) {
  const builder: any = {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    whereRef: jest.fn().mockReturnThis(),
    where: jest.fn((...args: unknown[]) => {
      if (typeof args[0] === 'function') {
        (args[0] as (eb: unknown) => unknown)(createExpressionBuilder(state));
      }
      return builder;
    }),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };

  return builder;
}

function createExpressionBuilder(state?: QueryBuilderState) {
  const eb = jest.fn((left, operator, right) => ({
    left,
    operator,
    right,
  })) as any;

  eb.selectFrom = jest.fn((table: string) => {
    state?.selectFromCalls.push(table);
    return createSubqueryBuilder(state);
  });
  eb.exists = jest.fn((expression: unknown) => ({ exists: expression }));
  eb.not = jest.fn((expression: unknown) => {
    state?.notCalls.push(expression);
    return { not: expression };
  });

  return eb;
}

function createAttachmentQueryBuilder(rows: unknown[]) {
  const state: QueryBuilderState = {
    whereCalls: [],
    orderByCalls: [],
    selectFromCalls: [],
    notCalls: [],
  };
  let currentLimit: number | undefined;
  let currentOffset = 0;

  const builder: any = {};
  Object.assign(builder, {
    innerJoin: jest.fn().mockReturnThis(),
    $if: jest.fn((condition: boolean, callback: (qb: any) => any) =>
      condition ? callback(builder) : builder,
    ),
    select: jest.fn((selection) => {
      if (typeof selection === 'function') {
        selection(createExpressionBuilder(state));
      }
      return builder;
    }),
    where: jest.fn((...args: unknown[]) => {
      state.whereCalls.push(args);
      if (typeof args[0] === 'function') {
        (args[0] as (eb: unknown) => unknown)(createExpressionBuilder(state));
      }
      return builder;
    }),
    orderBy: jest.fn((...args: unknown[]) => {
      state.orderByCalls.push(args);
      return builder;
    }),
    limit: jest.fn((limit: number) => {
      currentLimit = limit;
      return builder;
    }),
    offset: jest.fn((offset: number) => {
      currentOffset = offset;
      return builder;
    }),
    execute: jest.fn(async () =>
      rows.slice(
        currentOffset,
        currentLimit ? currentOffset + currentLimit : undefined,
      ),
    ),
  });

  return { builder, state };
}

function createAttachmentSearchService(rows: unknown[]) {
  const { builder, state } = createAttachmentQueryBuilder(rows);
  const db = {
    selectFrom: jest.fn(() => builder),
  };
  const spaceMemberRepo = {
    getUserSpaceIdsQuery: jest.fn(() => ['space-1']),
  };
  const userRepo = {
    findById: jest.fn(async () => ({ id: 'user-1' })),
  };
  const pageAccessService = {
    getSidebarAccessSnapshot: jest.fn(async () => ({
      readablePageIds: new Set(['page-1']),
      visiblePageIds: new Set(['page-1']),
    })),
  };

  const service = new SearchService(
    db as any,
    {} as any,
    {} as any,
    spaceMemberRepo as any,
    userRepo as any,
    pageAccessService as any,
  );

  return { service, state, db, spaceMemberRepo, userRepo, pageAccessService };
}

function createPageSearchService(
  rows: unknown[],
  readablePageIds = new Set(['page-1', 'database-page-1']),
) {
  const { builder, state } = createAttachmentQueryBuilder(rows);
  const db = {
    selectFrom: jest.fn(() => builder),
  };
  const pageRepo = {
    withDatabaseId: jest.fn(() => ({ alias: 'databaseId' })),
    withSpace: jest.fn(() => ({ alias: 'space' })),
  };
  const spaceMemberRepo = {
    getUserSpaceIdsQuery: jest.fn(() => ['space-1']),
  };
  const userRepo = {
    findById: jest.fn(async () => ({ id: 'user-1', workspaceId: 'workspace-1' })),
  };
  const pageAccessService = {
    getSidebarAccessSnapshot: jest.fn(async () => ({
      readablePageIds,
      visiblePageIds: readablePageIds,
    })),
  };

  const service = new SearchService(
    db as any,
    pageRepo as any,
    {} as any,
    spaceMemberRepo as any,
    userRepo as any,
    pageAccessService as any,
  );

  return {
    service,
    state,
    db,
    pageRepo,
    spaceMemberRepo,
    userRepo,
    pageAccessService,
  };
}

function createSearchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-1',
    slugId: 'page-1',
    title: 'Roadmap',
    icon: null,
    parentPageId: null,
    creatorId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    rank: 0,
    highlight: '',
    databaseId: null,
    labels: [{ id: 'label-1', name: 'urgent', type: 'page' }],
    space: {
      id: 'space-1',
      name: 'Engineering',
      slug: 'engineering',
    },
    ...overrides,
  };
}

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
        { provide: PageRepo, useValue: {} },
        { provide: ShareRepo, useValue: {} },
        { provide: SpaceMemberRepo, useValue: {} },
        { provide: UserRepo, useValue: {} },
        { provide: PageAccessService, useValue: {} },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns readable pages for label-only search without full-text filtering', async () => {
    const row = createSearchRow();
    const { service, state } = createPageSearchService([row]);

    const result = await service.searchPage(
      { query: '', labelId: 'label-1' } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(result.items).toEqual([{ ...row, breadcrumbs: [] }]);
    expect(state.whereCalls.some(([column]) => column === 'tsv')).toBe(false);
    expect(state.selectFromCalls).toContain('pageLabels as labelFilter');
    expect(state.orderByCalls).toEqual(
      expect.arrayContaining([
        ['updatedAt', 'desc'],
        ['id', 'desc'],
      ]),
    );
  });

  it('requires both full-text and label matching when query and label are provided', async () => {
    const row = createSearchRow({ rank: 1, highlight: '<mark>Roadmap</mark>' });
    const { service, state } = createPageSearchService([row]);

    const result = await service.searchPage(
      { query: 'Roadmap', labelId: 'label-1' } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(result.items).toEqual([{ ...row, breadcrumbs: [] }]);
    expect(state.whereCalls.some(([column]) => column === 'tsv')).toBe(true);
    expect(state.selectFromCalls).toContain('pageLabels as labelFilter');
    expect(state.orderByCalls).toContainEqual(['rank', 'desc']);
  });

  it('adds an active database row exclusion when label filtering pages', async () => {
    const { service, state } = createPageSearchService([createSearchRow()]);

    await service.searchPage(
      { labelId: 'label-1' } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(state.selectFromCalls).toContain('databaseRows');
    expect(state.notCalls).toHaveLength(1);
  });

  it('filters unreadable label search results through the access snapshot', async () => {
    const readableRow = createSearchRow();
    const unreadableRow = createSearchRow({
      id: 'page-2',
      slugId: 'page-2',
      title: 'Hidden Roadmap',
    });
    const { service } = createPageSearchService(
      [readableRow, unreadableRow],
      new Set(['page-1']),
    );

    const result = await service.searchPage(
      { labelId: 'label-1' } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(result.items).toEqual([{ ...readableRow, breadcrumbs: [] }]);
  });

  it('backfills readable page search results beyond unreadable limited rows', async () => {
    const hiddenRow = createSearchRow({
      id: 'page-hidden',
      slugId: 'page-hidden',
      title: 'Hidden Roadmap',
    });
    const readableRow = createSearchRow({
      id: 'page-readable',
      slugId: 'page-readable',
      title: 'Readable Roadmap',
    });
    const { service } = createPageSearchService(
      [hiddenRow, readableRow],
      new Set(['page-readable']),
    );

    const result = await service.searchPage(
      { labelId: 'label-1', limit: 1 } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(result.items).toEqual([{ ...readableRow, breadcrumbs: [] }]);
  });

  it('searches attachments by filename tokens without requiring attachment tsv data', async () => {
    const row = {
      id: 'attachment-1',
      fileName: 'Quarterly Budget.pdf',
      pageId: 'page-1',
      creatorId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      rank: 1,
      highlight: '',
      space: {
        id: 'space-1',
        name: 'Engineering',
        slug: 'engineering',
        icon: null,
      },
      page: {
        id: 'page-1',
        title: 'Planning',
        slugId: 'planning',
      },
    };
    const { service, state } = createAttachmentSearchService([row]);

    const result = await service.searchAttachments(
      { query: 'budget pdf' } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(result.items).toEqual([row]);
    expect(
      state.whereCalls.some(([column]) => column === 'attachments.tsv'),
    ).toBe(false);
    expect(
      state.whereCalls.filter(([condition]) => typeof condition === 'function'),
    ).toHaveLength(2);
  });

  it('returns no attachment results for a blank query', async () => {
    const { service, db } = createAttachmentSearchService([]);

    const result = await service.searchAttachments(
      { query: '   ' } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(result.items).toEqual([]);
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it('filters attachment results by readable page access', async () => {
    const readableRow = {
      id: 'attachment-1',
      fileName: 'Readable.pdf',
      pageId: 'page-1',
      creatorId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      rank: 1,
      highlight: '',
      space: {
        id: 'space-1',
        name: 'Engineering',
        slug: 'engineering',
        icon: null,
      },
      page: {
        id: 'page-1',
        title: 'Visible',
        slugId: 'visible',
      },
    };
    const unreadableRow = {
      ...readableRow,
      id: 'attachment-2',
      fileName: 'Unreadable.pdf',
      pageId: 'page-2',
      page: {
        id: 'page-2',
        title: 'Hidden',
        slugId: 'hidden',
      },
    };
    const { service } = createAttachmentSearchService([
      readableRow,
      unreadableRow,
    ]);

    const result = await service.searchAttachments(
      { query: 'pdf' } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(result.items).toEqual([readableRow]);
  });

  it('backfills readable attachment results beyond unreadable limited rows', async () => {
    const hiddenRow = {
      id: 'attachment-hidden',
      fileName: 'Hidden.pdf',
      pageId: 'page-2',
      creatorId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      rank: 1,
      highlight: '',
      space: {
        id: 'space-1',
        name: 'Engineering',
        slug: 'engineering',
        icon: null,
      },
      page: {
        id: 'page-2',
        title: 'Hidden',
        slugId: 'hidden',
      },
    };
    const readableRow = {
      ...hiddenRow,
      id: 'attachment-readable',
      fileName: 'Readable.pdf',
      pageId: 'page-1',
      page: {
        id: 'page-1',
        title: 'Readable',
        slugId: 'readable',
      },
    };
    const { service } = createAttachmentSearchService([hiddenRow, readableRow]);

    const result = await service.searchAttachments(
      { query: 'pdf', limit: 1 } as any,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    expect(result.items).toEqual([readableRow]);
  });

  it('keeps readable page suggestions after access filtering', async () => {
    const hiddenPage = {
      id: 'page-hidden',
      slugId: 'page-hidden',
      title: 'Hidden Page EN',
      icon: null,
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
    };
    const sourcePage = {
      id: 'page-1',
      slugId: 'page-1',
      title: 'Test Page EN',
      icon: null,
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
    };
    let selectedColumns: string[] = [];
    let currentLimit: number | undefined;
    let currentOffset = 0;
    const sourceRows = [hiddenPage, sourcePage];
    const pageSearchQuery = {
      select: jest.fn((columns: string[]) => {
        selectedColumns = columns;
        return pageSearchQuery;
      }),
      where: jest.fn(() => pageSearchQuery),
      orderBy: jest.fn(() => pageSearchQuery),
      limit: jest.fn((limit: number) => {
        currentLimit = limit;
        return pageSearchQuery;
      }),
      offset: jest.fn((offset: number) => {
        currentOffset = offset;
        return pageSearchQuery;
      }),
      execute: jest.fn(async () =>
        sourceRows
          .slice(
            currentOffset,
            currentLimit ? currentOffset + currentLimit : undefined,
          )
          .map((row) =>
            Object.fromEntries(
              selectedColumns.map((column) => [column, row[column]]),
            ),
          ),
      ),
    };
    const db = {
      selectFrom: jest.fn(() => pageSearchQuery),
    };
    const pageAccessService = {
      getSidebarAccessSnapshot: jest.fn(async () => ({
        readablePageIds: new Set(['page-1']),
        visiblePageIds: new Set(['page-1']),
      })),
    };

    const service = new SearchService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      pageAccessService as any,
    );

    const result = await service.searchSuggestions(
      {
        query: 'Tes',
        includePages: true,
        spaceId: 'space-1',
        limit: 10,
      },
      {
        id: 'user-1',
        workspaceId: 'workspace-1',
      } as any,
      'workspace-1',
    );

    expect(result.pages).toEqual([sourcePage]);
    expect(pageAccessService.getSidebarAccessSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' }),
      'space-1',
    );
  });
});
