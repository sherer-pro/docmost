import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  breadcrumbsKey,
  databaseKey,
  databasePropertiesKey,
  databaseRowContextKey,
  databaseRowsKey,
  databasesBySpaceKey,
  invalidateBreadcrumbs,
  invalidateDatabaseProperties,
  invalidateDatabaseEntity,
  invalidateDatabaseRowContext,
  invalidatePageEntity,
  invalidateRecentChanges,
  invalidateSidebarTree,
  invalidateTrashList,
  pageKey,
  recentChangesKey,
  rootSidebarKey,
  sidebarKey,
  trashListKey,
} from "./cache-invalidation";
import { DATABASE_QUERY_KEYS, PAGE_QUERY_KEYS } from "./query-keys";

type InvalidatePayload = {
  queryKey?: readonly unknown[];
  predicate?: (item: { queryKey: readonly unknown[] }) => boolean;
};

function createMockClient() {
  const calls: InvalidatePayload[] = [];

  const client = {
    invalidateQueries: (payload: InvalidatePayload) => {
      calls.push(payload);
      return Promise.resolve();
    },
  } as any;

  return {
    calls,
    client,
  };
}

function keyTrace(calls: InvalidatePayload[]) {
  return calls.map((call) => {
    if (call.queryKey) {
      return JSON.stringify(call.queryKey);
    }

    if (call.predicate) {
      return {
        pages: call.predicate({ queryKey: ["pages", "any"] }),
        databaseRows: call.predicate({
          queryKey: ["database", "db-1", "rows"],
        }),
      };
    }

    return "unknown";
  });
}

describe("cache invalidation scenarios", () => {
  it("query key factories stay aligned between hooks and invalidation layer", () => {
    assert.deepEqual(PAGE_QUERY_KEYS.page("page-1"), pageKey("page-1"));
    assert.deepEqual(
      PAGE_QUERY_KEYS.sidebar({ pageId: "page-1", spaceId: "space-1" }),
      sidebarKey({ pageId: "page-1", spaceId: "space-1" }),
    );
    assert.deepEqual(
      PAGE_QUERY_KEYS.rootSidebar("space-1", ["page", "database"]),
      rootSidebarKey("space-1", ["page", "database"]),
    );

    assert.deepEqual(
      DATABASE_QUERY_KEYS.bySpace("space-1"),
      databasesBySpaceKey("space-1"),
    );
    assert.deepEqual(DATABASE_QUERY_KEYS.byId("db-1"), databaseKey("db-1"));
    assert.deepEqual(
      DATABASE_QUERY_KEYS.properties("db-1"),
      databasePropertiesKey("db-1"),
    );
    assert.deepEqual(DATABASE_QUERY_KEYS.rows("db-1"), databaseRowsKey("db-1"));
    assert.deepEqual(
      DATABASE_QUERY_KEYS.rowContext("page-1"),
      databaseRowContextKey("page-1"),
    );

    assert.deepEqual(PAGE_QUERY_KEYS.breadcrumbs("page-1"), breadcrumbsKey("page-1"));
    assert.deepEqual(
      PAGE_QUERY_KEYS.recentChanges("space-1"),
      recentChangesKey("space-1"),
    );
    assert.deepEqual(
      PAGE_QUERY_KEYS.trashList("space-1", { limit: 10 }),
      trashListKey("space-1", { limit: 10 }),
    );
  });
  it("page:create invalidates row-context tree while recent-changes stays in page-query", () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseRowContext({}, { client });

    assert.deepEqual(keyTrace(calls), [
      { pages: false, databaseRows: true },
      JSON.stringify(["database", "row-context"]),
    ]);
  });

  it("page:update invalidates row-context and rows via shared utility", () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseRowContext({}, { client });

    assert.deepEqual(keyTrace(calls), [
      { pages: false, databaseRows: true },
      JSON.stringify(["database", "row-context"]),
    ]);
  });

  it("page:delete invalidates row-context and rows via shared utility", () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseRowContext({}, { client });

    assert.deepEqual(keyTrace(calls), [
      { pages: false, databaseRows: true },
      JSON.stringify(["database", "row-context"]),
    ]);
  });

  it("page:convert invalidates pages + sidebar + database entity + row context", () => {
    const { client, calls } = createMockClient();

    invalidatePageEntity({ includeAllPages: true }, { client });
    invalidateSidebarTree({}, { client });
    invalidateDatabaseEntity({ databaseId: "db-1" }, { client });
    invalidateDatabaseRowContext({ databaseId: "db-1" }, { client });

    assert.deepEqual(keyTrace(calls), [
      { pages: true, databaseRows: false },
      JSON.stringify(["root-sidebar-pages"]),
      JSON.stringify(["sidebar-pages"]),
      JSON.stringify(["database", "db-1"]),
      JSON.stringify(["databases"]),
      JSON.stringify(["database", "db-1", "rows"]),
      JSON.stringify(["database", "row-context"]),
    ]);
  });

  it("database:create invalidates databases list and sidebar tree", () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseEntity({ spaceId: "space-1" }, { client });
    invalidateSidebarTree({ spaceId: "space-1" }, { client });

    assert.deepEqual(keyTrace(calls), [
      JSON.stringify(["databases", "space", "space-1"]),
      JSON.stringify(["databases"]),
      JSON.stringify(["root-sidebar-pages", "space-1"]),
      JSON.stringify(["sidebar-pages"]),
    ]);
  });

  it("database:update invalidates entity, lists, and tree", () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseEntity(
      { databaseId: "db-1", spaceId: "space-1" },
      { client },
    );
    invalidateSidebarTree({ spaceId: "space-1" }, { client });

    assert.deepEqual(keyTrace(calls), [
      JSON.stringify(["database", "db-1"]),
      JSON.stringify(["databases", "space", "space-1"]),
      JSON.stringify(["databases"]),
      JSON.stringify(["root-sidebar-pages", "space-1"]),
      JSON.stringify(["sidebar-pages"]),
    ]);
  });

  it("database:convert invalidates entity, tree, rows/context, and page", () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseEntity(
      { databaseId: "db-1", spaceId: "space-1" },
      { client },
    );
    invalidateSidebarTree({ spaceId: "space-1" }, { client });
    invalidateDatabaseRowContext({ databaseId: "db-1" }, { client });
    invalidatePageEntity(
      { pageId: "page-1", pageSlugId: "page-slug-1" },
      { client },
    );

    assert.deepEqual(keyTrace(calls), [
      JSON.stringify(["database", "db-1"]),
      JSON.stringify(["databases", "space", "space-1"]),
      JSON.stringify(["databases"]),
      JSON.stringify(["root-sidebar-pages", "space-1"]),
      JSON.stringify(["sidebar-pages"]),
      JSON.stringify(["database", "db-1", "rows"]),
      JSON.stringify(["database", "row-context"]),
      JSON.stringify(["pages", "page-1"]),
      JSON.stringify(["pages", "page-slug-1"]),
    ]);
  });

  it("invalidate recent-changes, breadcrumbs and trash-list via dedicated helpers", () => {
    const { client, calls } = createMockClient();

    invalidateRecentChanges({ spaceId: "space-1" }, { client });
    invalidateBreadcrumbs({ pageId: "page-1" }, { client });
    invalidateTrashList({ spaceId: "space-1" }, { client });

    assert.deepEqual(keyTrace(calls), [
      JSON.stringify(["recent-changes", "space-1"]),
      JSON.stringify(["breadcrumbs", "page-1"]),
      JSON.stringify(["trash-list", "space-1", undefined]),
    ]);
  });

  it("invalidate database properties via dedicated helper", () => {
    const { client, calls } = createMockClient();

    invalidateDatabaseProperties({ databaseId: "db-1" }, { client });

    assert.deepEqual(keyTrace(calls), [
      JSON.stringify(["database", "db-1", "properties"]),
    ]);
  });
});

