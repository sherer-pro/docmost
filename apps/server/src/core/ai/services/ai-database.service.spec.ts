jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AiDatabaseService,
  databaseSchemaFingerprint,
  normalizeAiDatabaseContext,
} from './ai-database.service';

const databaseId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000000002';
const rowId = '00000000-0000-4000-8000-000000000003';
const hiddenId = '00000000-0000-4000-8000-000000000004';
const propertyId = '00000000-0000-4000-8000-000000000005';
const viewState = {
  version: 2,
  sorts: [],
  visibleColumns: {},
  calculations: {},
} as const;
const context = {
  user: { id: 'user' } as any,
  workspaceId: 'workspace',
  spaceId: 'space',
  currentPageId: pageId,
  databaseContext: {
    databaseId,
    viewState: { ...viewState, sorts: [] },
    selectedPageIds: [],
  },
};

function setup() {
  const tables = {
    databases: [{ id: databaseId, pageId, name: 'Tasks' }],
    databaseProperties: [
      { id: propertyId, name: 'Budget', type: 'number', settings: {} },
    ],
    databaseCells: [{ pageId: rowId, propertyId, value: 7, revision: 2 }],
  };
  const db: any = {
    transaction: () => ({
      setIsolationLevel: () => ({ execute: (fn) => fn(db) }),
    }),
    selectFrom: jest.fn((table) => {
      const q: any = {};
      for (const name of ['selectAll', 'select', 'where', 'orderBy'])
        q[name] = jest.fn(() => q);
      q.execute = jest.fn(async () => tables[table]);
      q.executeTakeFirst = jest.fn(async () => tables[table]?.[0]);
      return q;
    }),
  };
  const access = {
    getSidebarAccessSnapshot: jest.fn(async () => ({
      readablePageIds: new Set([pageId, rowId, hiddenId]),
      writablePageIds: new Set([rowId]),
    })),
    getAssignableSpaceUserIds: jest.fn(async () => new Set()),
  };
  const policy = {
    getExcludedPageIds: jest.fn(async () => new Set([hiddenId])),
  };
  const query = {
    matchingPageIds: jest.fn(async () => [rowId]),
    validateState: jest.fn((state) => state),
    summary: jest.fn(async () => ({
      count: 271,
      values: { [propertyId]: 2710 },
      groups: [],
    })),
    list: jest.fn(async () => ({
      items: [
        {
          pageId: rowId,
          title: 'Record',
          cells: tables.databaseCells.filter((cell) => cell.pageId === rowId),
        },
      ],
      hasMore: false,
      nextCursor: null,
    })),
  };
  const databases = {
    batchUpdateRowCells: jest.fn(async () => ({})),
    enqueuePageSearchRefresh: jest.fn(),
  };
  const service = new AiDatabaseService(
    db,
    access as any,
    policy as any,
    query as any,
    databases as any,
  );
  return { service, tables, access, policy, query, databases };
}

describe('AI database view and cell boundaries', () => {
  it('uses typed calculation pairs without changing the frozen filter or mutating its map', async () => {
    const { service, query } = setup();
    const scoped = {
      ...context,
      databaseContext: {
        ...context.databaseContext,
        viewState: {
          ...viewState,
          sorts: [],
          calculations: { [propertyId]: 'count' },
          filter: {
            conjunction: 'and',
            conditions: [{ propertyId, operator: 'gte', value: 3 }],
          },
        },
      },
    } as any;
    await service.read(
      { databaseId, calculations: [{ propertyId, operation: 'sum' }] },
      scoped,
      true,
    );
    expect(query.validateState).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: scoped.databaseContext.viewState.filter,
        calculations: { [propertyId]: 'sum' },
      }),
      expect.any(Array),
    );
    expect(scoped.databaseContext.viewState.calculations).toEqual({
      [propertyId]: 'count',
    });
    await service.read({ databaseId, calculations: [] }, scoped, true);
    expect(query.validateState).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: scoped.databaseContext.viewState.filter,
        calculations: {},
      }),
      expect.any(Array),
    );
  });
  it('rejects malformed, duplicate, oversized and unsupported calculation overrides', async () => {
    const { service } = setup();
    for (const calculations of [
      null,
      {},
      [{ propertyId: `'${propertyId}'`, operation: 'sum' }],
      [{ propertyId, operation: 'sql' }],
      [{ propertyId, operation: 'sum', sql: 'select 1' }],
      [
        { propertyId, operation: 'sum' },
        { propertyId, operation: 'count' },
      ],
      Array.from({ length: 21 }, () => ({ propertyId, operation: 'sum' })),
    ]) {
      await expect(
        service.read({ databaseId, calculations }, context, true),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
  it('records server time, schema and labels with the executed database query', async () => {
    const { service, tables } = setup();
    const result = await service.read({ databaseId }, context, true);
    expect(result.receipt).toMatchObject({
      version: 1,
      mode: 'summary',
      schemaFingerprint: databaseSchemaFingerprint(tables.databaseProperties),
      databasePageId: pageId,
      databaseTitle: 'Tasks',
      propertyLabels: { [propertyId]: 'Budget' },
      selectedRowCount: 0,
    });
    expect(Number.isFinite(Date.parse(result.receipt.asOf))).toBe(true);
  });
  it('rejects a result link after a schema change before reading current rows', async () => {
    const { service, query } = setup();
    await expect(
      service.read({ databaseId }, context, false, 'b'.repeat(64)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(query.list).not.toHaveBeenCalled();
  });
  it('reports a partial calculation when formula cells contain errors', async () => {
    const { service, query } = setup();
    query.summary.mockResolvedValue({
      count: 271,
      values: { [propertyId]: 2700 },
      groups: [],
      errors: { [propertyId]: 1 },
    } as any);
    const result = await service.read({ databaseId }, context, true);
    expect(result).toMatchObject({
      count: 271,
      complete: false,
      errors: { [propertyId]: 1 },
      warnings: ['formula_errors'],
    });
  });
  it.each(['formula', 'created_at', 'updated_at', 'updated_by', 'file'])(
    'rejects a proposal clearing the %s property',
    async (type) => {
      const { service, tables } = setup();
      tables.databaseProperties[0].type = type;
      await expect(
        service.propose(
          {
            databaseId,
            rows: [
              {
                pageId: rowId,
                cells: [{ propertyId, value: null, expectedRevision: 2 }],
              },
            ],
          },
          context,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('previews option labels without changing the stored canonical values', async () => {
    const { service, tables } = setup();
    tables.databaseProperties[0].type = 'select';
    tables.databaseProperties[0].settings = {
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
    };
    tables.databaseCells[0].value = 'a' as any;
    const result = await service.propose(
      {
        databaseId,
        rows: [
          {
            pageId: rowId,
            cells: [{ propertyId, value: 'b', expectedRevision: 2 }],
          },
        ],
      },
      context,
    );
    expect(result.content.approvalPreview.rows[0].cells[0]).toMatchObject({
      before: 'a',
      value: 'b',
      beforeDisplay: 'Alpha',
      afterDisplay: 'Beta',
    });
  });
  it('keeps reference title access independent of row selection and tracks filter dependencies', async () => {
    const { service, tables, policy, query } = setup();
    policy.getExcludedPageIds.mockResolvedValueOnce(new Set());
    tables.databaseProperties[0].type = 'page_reference';
    tables.databaseCells[0].value = hiddenId as any;
    const result = await service.read(
      { databaseId },
      {
        ...context,
        databaseContext: {
          ...context.databaseContext,
          selectedPageIds: [rowId],
          viewState: {
            ...context.databaseContext.viewState,
            sorts: [{ propertyId, direction: 'asc' }],
          },
        },
      },
      true,
    );
    expect(query.summary).toHaveBeenCalledWith(
      expect.objectContaining({
        readablePageIds: [rowId],
        referenceReadablePageIds: [pageId, rowId, hiddenId],
      }),
    );
    expect(result.dependencyPageIds).toContain(hiddenId);
  });
  it('freezes the focused table group independently of saved view filters', async () => {
    const { service, query } = setup();
    await service.read(
      { databaseId },
      {
        ...context,
        databaseContext: {
          ...context.databaseContext,
          groupKey: '"open"',
          viewState: {
            ...context.databaseContext.viewState,
            groupBy: propertyId,
          },
        },
      },
      true,
    );
    expect(query.summary).toHaveBeenCalledWith(
      expect.objectContaining({ groupKey: '"open"' }),
    );
    expect(() =>
      normalizeAiDatabaseContext({
        ...context.databaseContext,
        groupKey: '{}',
      }),
    ).toThrow();
  });
  it('hides inaccessible reference metadata and accepts a readable reference outside the selected rows', async () => {
    const { service, tables } = setup();
    tables.databaseProperties[0].type = 'page_reference';
    tables.databaseCells[0].value = {
      id: hiddenId,
      title: 'HIDDEN_TITLE',
    } as any;
    const read = await service.read({ databaseId }, context, false);
    expect(JSON.stringify(read)).not.toContain('HIDDEN_TITLE');
    expect(read.items[0].cells[0].value).toBeNull();
    tables.databaseCells[0].value = null;
    const result = await service.propose(
      {
        databaseId,
        rows: [
          {
            pageId: rowId,
            cells: [{ propertyId, value: pageId, expectedRevision: 2 }],
          },
        ],
      },
      {
        ...context,
        databaseContext: {
          ...context.databaseContext,
          selectedPageIds: [rowId],
        },
      },
    );
    expect(result.writeProposal.operation.rows[0].cells[0].value).toBe(pageId);
    expect(result.dependencyPageIds).toContain(pageId);
  });
  it('removes denied content before full-selection calculations and preserves frozen filters', async () => {
    const { service, query } = setup();
    const result = await service.read({ databaseId }, context, true);
    expect(query.summary).toHaveBeenCalledWith(
      expect.objectContaining({
        readablePageIds: [pageId, rowId],
        state: context.databaseContext.viewState,
      }),
    );
    expect(result).toMatchObject({ count: 271, complete: true });
    expect(JSON.stringify(result)).not.toContain(hiddenId);
  });

  it('never discloses a database whose root is excluded', async () => {
    const { service, policy, query } = setup();
    policy.getExcludedPageIds.mockResolvedValueOnce(new Set([pageId]));
    await expect(
      service.read({ databaseId }, context, true),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(query.summary).not.toHaveBeenCalled();
  });

  it('rejects a revoked explicit selection instead of reporting a complete partial total', async () => {
    const { service, query } = setup();
    await expect(
      service.read(
        { databaseId },
        {
          ...context,
          databaseContext: {
            ...context.databaseContext,
            selectedPageIds: [hiddenId],
          },
        },
        true,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query.summary).not.toHaveBeenCalled();
  });

  it('creates a complete typed preview without performing any mutation', async () => {
    const { service, databases } = setup();
    const proposal = await service.propose(
      {
        databaseId,
        rows: [
          {
            pageId: rowId,
            cells: [{ propertyId, value: 11, expectedRevision: 2 }],
          },
        ],
      },
      context,
    );
    expect(proposal.content.approvalPreview.rows[0].cells[0]).toMatchObject({
      before: 7,
      value: 11,
      expectedRevision: 2,
    });
    expect(proposal.writeProposal.operation.rows[0].cells[0].value).toBe(11);
    expect(proposal.writeProposal.baseContentHash).toBeNull();
    expect(databases.batchUpdateRowCells).not.toHaveBeenCalled();
  });

  it('requires explicit selection of the current database and a fresh revision', async () => {
    const { service } = setup();
    const args = {
      databaseId,
      rows: [
        {
          pageId: rowId,
          cells: [{ propertyId, value: 11, expectedRevision: 1 }],
        },
      ],
    };
    await expect(
      service.propose(args, { ...context, databaseContext: undefined }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.propose(args, context)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects rows outside the frozen view and oversized complete previews', async () => {
    const { service, query, tables } = setup();
    const args = {
      databaseId,
      rows: [
        {
          pageId: rowId,
          cells: [{ propertyId, value: 11, expectedRevision: 2 }],
        },
      ],
    };
    query.list.mockResolvedValueOnce({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    await expect(service.propose(args, context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    tables.databaseProperties[0].type = 'multiline_text';
    await expect(
      service.propose(
        {
          ...args,
          rows: [
            {
              pageId: rowId,
              cells: [
                { propertyId, value: 'x'.repeat(33000), expectedRevision: 2 },
              ],
            },
          ],
        },
        context,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates context identifiers, uniqueness and view rules', () => {
    expect(() =>
      normalizeAiDatabaseContext({
        ...context.databaseContext,
        selectedPageIds: [rowId, rowId],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeAiDatabaseContext({
        ...context.databaseContext,
        viewState: { version: 99 },
      }),
    ).toThrow(BadRequestException);
    expect(normalizeAiDatabaseContext(context.databaseContext)).toMatchObject(
      context.databaseContext,
    );
  });

  it('invalidates a proposal when a property changes but ignores property list order', () => {
    const first = { id: 'a', name: 'Budget', type: 'number', settings: {} };
    const second = { ...first, id: 'b' };
    expect(databaseSchemaFingerprint([first, second])).toBe(
      databaseSchemaFingerprint([second, first]),
    );
    expect(databaseSchemaFingerprint([first])).not.toBe(
      databaseSchemaFingerprint([{ ...first, type: 'date' }]),
    );
  });
});
