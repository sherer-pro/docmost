import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  invalidateDatabaseEntity,
  invalidateDatabaseRowContext,
  invalidatePageEntity,
  invalidateSidebarTree,
} from './cache-invalidation';

type InvalidatePayload = {
  queryKey?: unknown[];
  predicate?: (item: { queryKey: unknown[] }) => boolean;
};

function createMockClient() {
  const calls: InvalidatePayload[] = [];

  return {
    calls,
    client: {
      invalidateQueries: (payload: InvalidatePayload) => {
        calls.push(payload);
        return Promise.resolve();
      },
    },
  };
}

function keyTrace(calls: InvalidatePayload[]) {
  return calls.map((call) => {
    if (call.queryKey) {
      return JSON.stringify(call.queryKey);
    }

    if (call.predicate) {
      return {
        pages: call.predicate({ queryKey: ['pages', 'any'] }),
        databaseRows: call.predicate({ queryKey: ['database', 'db-1', 'rows'] }),
      };
    }

    return 'unknown';
  });
}

describe('cache invalidation scenarios', () => {
  it('page:create инвалидирует дерево, recent-changes остаётся на стороне page-query', () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseRowContext({}, { client });

    assert.deepEqual(keyTrace(calls), [
      { pages: false, databaseRows: true },
      JSON.stringify(['database', 'row-context']),
    ]);
  });

  it('page:update инвалидирует row-context и rows через общий utility', () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseRowContext({}, { client });

    assert.deepEqual(keyTrace(calls), [
      { pages: false, databaseRows: true },
      JSON.stringify(['database', 'row-context']),
    ]);
  });

  it('page:delete инвалидирует row-context и rows через общий utility', () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseRowContext({}, { client });

    assert.deepEqual(keyTrace(calls), [
      { pages: false, databaseRows: true },
      JSON.stringify(['database', 'row-context']),
    ]);
  });

  it('page:convert инвалидирует pages + sidebar + database entity + row context', () => {
    const { client, calls } = createMockClient();

    invalidatePageEntity({ includeAllPages: true }, { client });
    invalidateSidebarTree({}, { client });
    invalidateDatabaseEntity({ databaseId: 'db-1' }, { client });
    invalidateDatabaseRowContext({ databaseId: 'db-1' }, { client });

    assert.deepEqual(keyTrace(calls), [
      { pages: true, databaseRows: false },
      JSON.stringify(['root-sidebar-pages']),
      JSON.stringify(['sidebar-pages']),
      JSON.stringify(['database', 'db-1']),
      JSON.stringify(['databases']),
      JSON.stringify(['database', 'db-1', 'rows']),
      JSON.stringify(['database', 'row-context']),
    ]);
  });

  it('database:create инвалидирует список баз и дерево sidebar', () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseEntity({ spaceId: 'space-1' }, { client });
    invalidateSidebarTree({ spaceId: 'space-1' }, { client });

    assert.deepEqual(keyTrace(calls), [
      JSON.stringify(['databases', 'space', 'space-1']),
      JSON.stringify(['databases']),
      JSON.stringify(['root-sidebar-pages', 'space-1']),
      JSON.stringify(['sidebar-pages']),
    ]);
  });

  it('database:update инвалидирует entity, списки и дерево', () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseEntity({ databaseId: 'db-1', spaceId: 'space-1' }, { client });
    invalidateSidebarTree({ spaceId: 'space-1' }, { client });

    assert.deepEqual(keyTrace(calls), [
      JSON.stringify(['database', 'db-1']),
      JSON.stringify(['databases', 'space', 'space-1']),
      JSON.stringify(['databases']),
      JSON.stringify(['root-sidebar-pages', 'space-1']),
      JSON.stringify(['sidebar-pages']),
    ]);
  });

  it('database:convert инвалидирует entity, дерево, rows/context и страницу', () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseEntity({ databaseId: 'db-1', spaceId: 'space-1' }, { client });
    invalidateSidebarTree({ spaceId: 'space-1' }, { client });
    invalidateDatabaseRowContext({ databaseId: 'db-1' }, { client });
    invalidatePageEntity({ pageId: 'page-1', pageSlugId: 'page-slug-1' }, { client });

    assert.deepEqual(keyTrace(calls), [
      JSON.stringify(['database', 'db-1']),
      JSON.stringify(['databases', 'space', 'space-1']),
      JSON.stringify(['databases']),
      JSON.stringify(['root-sidebar-pages', 'space-1']),
      JSON.stringify(['sidebar-pages']),
      JSON.stringify(['database', 'db-1', 'rows']),
      JSON.stringify(['database', 'row-context']),
      JSON.stringify(['pages', 'page-1']),
      JSON.stringify(['pages', 'page-slug-1']),
    ]);
  });
});
