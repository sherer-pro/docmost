jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AiDatabaseResultService } from './ai-database-result.service';
import { AiSourceAccessChangedError } from './ai-source-access.service';

const databaseId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000000002';
const rowId = '00000000-0000-4000-8000-000000000003';
const propertyId = '00000000-0000-4000-8000-000000000004';
const frozenState = {
  version: 2,
  sorts: [],
  calculations: { [propertyId]: 'sum' },
  visibleColumns: {},
  groupBy: null,
  filter: {
    conjunction: 'and',
    conditions: [{ propertyId, operator: 'gt', value: 7 }],
  },
};

function setup() {
  const user = { id: 'user' } as any;
  const workspace = { id: 'workspace' } as any;
  const run = {
    id: 'run',
    workspaceId: workspace.id,
    spaceId: 'space',
    userId: user.id,
    executionMode: 'agent',
    pageId,
    responseSnapshot: 'An untrusted claim: the total is 999999.',
    databaseContext: {
      databaseId,
      viewState: { ...frozenState, filter: undefined },
      selectedPageIds: [rowId],
    },
  };
  const result = {
    databaseId,
    viewState: frozenState,
    scope: 'accessible_ai_allowed_rows',
    count: 271,
    values: { [propertyId]: 2710 },
    groups: [],
    complete: true,
    receipt: {
      version: 1,
      mode: 'summary',
      asOf: '2026-10-31T09:00:00.000Z',
      schemaFingerprint: 'a'.repeat(64),
      databasePageId: pageId,
      databaseTitle: 'Tasks',
      propertyLabels: { [propertyId]: 'Budget' },
      selectedRowCount: 1,
    },
  };
  const step: any = {
    id: 'step',
    runId: run.id,
    toolSource: 'builtin',
    toolName: 'summarizeDatabaseView',
    writeClass: 'read_only',
    status: 'completed',
    result,
  };
  const filters: unknown[][] = [];
  const db: any = {
    selectFrom: jest.fn((table) => {
      const query: any = {};
      const localFilters: unknown[][] = [];
      for (const key of ['select', 'selectAll', 'innerJoin', 'orderBy'])
        query[key] = jest.fn(() => query);
      query.where = jest.fn((...args) => {
        filters.push(args);
        localFilters.push(args);
        return query;
      });
      query.execute = jest.fn(async () => [step]);
      query.executeTakeFirst = jest.fn(async () => {
        if (table !== 'aiRunSteps')
          return { slug: 'test space', slugId: 'page-slug' };
        return localFilters.every(
          ([column, operator, value]) =>
            operator !== '=' ||
            (column !== 'id' && column !== 'runId') ||
            step[column as string] === value,
        )
          ? step
          : undefined;
      });
      return query;
    }),
  };
  const runs = {
    getOwnedRun: jest.fn(async () => run),
    assertRunSourcesAccessible: jest.fn(async () => undefined),
  };
  const databases = {
    scope: jest.fn(async () => ({ database: { pageId } })),
    read: jest.fn(async () => ({
      dependencyPageIds: [rowId],
      receipt: { ...result.receipt, mode: 'query' },
      properties: [],
      items: [{ pageId: rowId, title: 'Current row', cells: [] }],
      hasMore: true,
      nextCursor: 'next',
    })),
  };
  const configs = { getRawConfig: jest.fn(async () => ({ enabled: true })) };
  const profiles = { assertRunProfileCurrent: jest.fn(async () => undefined) };
  const tools = {
    assertRunPolicyCurrent: jest.fn(async () => [
      { name: 'queryDatabaseView' },
      { name: 'summarizeDatabaseView' },
    ]),
  };
  const sources = { assertAccessible: jest.fn(async () => undefined) };
  const service = new AiDatabaseResultService(
    db,
    runs as any,
    databases as any,
    configs as any,
    profiles as any,
    tools as any,
    sources as any,
  );
  return {
    service,
    run,
    step,
    result,
    user,
    workspace,
    filters,
    db,
    runs,
    databases,
    configs,
    profiles,
    tools,
    sources,
  };
}

describe('AiDatabaseResultService', () => {
  it('returns authoritative totals and conditions without interpreting assistant prose', async () => {
    const f = setup();
    const cards = await f.service.list('run', f.user, f.workspace);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      summary: { count: 271, values: { [propertyId]: 2710 } },
      incomplete: false,
      canOpenRows: true,
      viewState: frozenState,
    });
    expect(JSON.stringify(cards)).not.toContain('999999');
    expect(cards[0].resultUrl).toBe(
      '/s/test%20space/ai/database-results/run/step',
    );
  });

  it('reuses the executed override and original explicit selection for current row reads', async () => {
    const f = setup();
    const rows = await f.service.rows(
      'run',
      'step',
      'cursor',
      f.user,
      f.workspace,
    );
    expect(rows).toMatchObject({
      items: [{ pageId: rowId }],
      hasMore: true,
      nextCursor: 'next',
    });
    expect(f.databases.read).toHaveBeenCalledWith(
      { databaseId, cursor: 'cursor', limit: 25 },
      expect.objectContaining({
        databaseContext: expect.objectContaining({
          viewState: frozenState,
          selectedPageIds: [rowId],
        }),
        workspaceId: 'workspace',
        spaceId: 'space',
      }),
      false,
      'a'.repeat(64),
    );
    expect(f.filters).toContainEqual(['id', '=', 'step']);
    expect(f.filters).toContainEqual(['runId', '=', 'run']);
  });

  it('does not grant row querying from summary-only capability', async () => {
    const f = setup();
    f.tools.assertRunPolicyCurrent.mockResolvedValue([
      { name: 'summarizeDatabaseView' },
    ]);
    expect(
      (await f.service.list('run', f.user, f.workspace))[0].canOpenRows,
    ).toBe(false);
    await expect(
      f.service.rows('run', 'step', undefined, f.user, f.workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.databases.read).not.toHaveBeenCalled();
  });

  it.each(['external_mcp', 'write', 'legacy'])(
    'does not build trusted cards from %s steps',
    async (kind) => {
      const f = setup();
      if (kind === 'external_mcp') f.step.toolSource = kind;
      if (kind === 'write') f.step.writeClass = kind;
      if (kind === 'legacy') delete (f.result as any).receipt;
      expect(await f.service.list('run', f.user, f.workspace)).toEqual([]);
      await expect(
        f.service.rows('run', 'step', undefined, f.user, f.workspace),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(f.databases.read).not.toHaveBeenCalled();
    },
  );

  it.each(['ownership', 'sources', 'profile', 'capability', 'database'])(
    'rechecks %s before disclosing a stored value',
    async (boundary) => {
      const f = setup();
      const denied = new ForbiddenException('revoked');
      if (boundary === 'ownership')
        f.runs.getOwnedRun.mockRejectedValue(denied);
      if (boundary === 'sources')
        f.runs.assertRunSourcesAccessible.mockRejectedValue(denied);
      if (boundary === 'profile')
        f.profiles.assertRunProfileCurrent.mockRejectedValue(denied);
      if (boundary === 'capability')
        f.tools.assertRunPolicyCurrent.mockResolvedValue([]);
      if (boundary === 'database') f.databases.scope.mockRejectedValue(denied);
      await expect(
        f.service.list('run', f.user, f.workspace),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.databases.read).not.toHaveBeenCalled();
    },
  );

  it('withholds receipts when AI is disabled and retains calculation-error status', async () => {
    const f = setup();
    f.configs.getRawConfig.mockResolvedValue({ enabled: false });
    await expect(
      f.service.list('run', f.user, f.workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    f.configs.getRawConfig.mockResolvedValue({ enabled: true });
    Object.assign(f.result, { complete: false, errors: { [propertyId]: 2 } });
    expect((await f.service.list('run', f.user, f.workspace))[0]).toMatchObject(
      { incomplete: true, summary: { errors: { [propertyId]: 2 } } },
    );
  });

  it('rejects a receipt whose database root identity changed', async () => {
    const f = setup();
    f.databases.scope.mockResolvedValue({ database: { pageId: rowId } });
    await expect(
      f.service.list('run', f.user, f.workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not read a step belonging to another private run', async () => {
    const f = setup();
    f.step.runId = 'another-run';
    await expect(
      f.service.rows('run', 'step', undefined, f.user, f.workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.databases.read).not.toHaveBeenCalled();
  });

  it('returns an access error if a newly read row loses access before the response', async () => {
    const f = setup();
    f.sources.assertAccessible.mockRejectedValue(
      new AiSourceAccessChangedError(),
    );
    await expect(
      f.service.rows('run', 'step', undefined, f.user, f.workspace),
    ).rejects.toMatchObject({
      response: { code: 'source_access_changed' },
    });
  });

  it('rechecks permission changes during the query and validates newly read sources', async () => {
    const f = setup();
    await f.service.rows('run', 'step', undefined, f.user, f.workspace);
    expect(f.sources.assertAccessible).toHaveBeenCalledWith(
      [
        { sourceType: 'page', sourceId: pageId, pageId },
        { sourceType: 'page', sourceId: rowId, pageId: rowId },
      ],
      { user: f.user, workspaceId: 'workspace', spaceId: 'space' },
    );
    f.databases.read.mockImplementation(async () => {
      f.configs.getRawConfig.mockResolvedValue({ enabled: false });
      return {
        dependencyPageIds: [rowId],
        receipt: f.result.receipt,
        properties: [],
        items: [],
        hasMore: false,
        nextCursor: null,
      };
    });
    await expect(
      f.service.rows('run', 'step', undefined, f.user, f.workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
