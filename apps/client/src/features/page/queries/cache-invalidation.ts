import { QueryClient } from "@tanstack/react-query";
import {
  breadcrumbsKey,
  databaseKey,
  databasePropertiesKey,
  databaseRowContextKey,
  databaseRowsKey,
  databasesBySpaceKey,
  pageKey,
  QUERY_KEY_SPACE,
  recentChangesKey,
  rootSidebarKey,
  sidebarKey,
  SidebarKeyParams,
  trashListKey,
} from "./query-keys";

export {
  pageKey,
  breadcrumbsKey,
  recentChangesKey,
  trashListKey,
  databaseKey,
  databasePropertiesKey,
  databaseRowsKey,
  databaseRowContextKey,
  sidebarKey,
  rootSidebarKey,
  databasesBySpaceKey,
  QUERY_KEY_SPACE,
};
export type { SidebarKeyParams };

type QueryClientLike = Pick<QueryClient, "invalidateQueries">;

interface InvalidateOptions {
  client: QueryClientLike;
}

/**
 * Invalidates sidebar tree caches.
 */
export function invalidateSidebarTree(
  {
    spaceId,
    includeNestedSidebar = true,
  }: {
    spaceId?: string;
    includeNestedSidebar?: boolean;
  } = {},
  { client }: InvalidateOptions,
) {
  if (spaceId) {
    client.invalidateQueries({ queryKey: rootSidebarKey(spaceId) });
  } else {
    client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.rootSidebarPages] });
  }

  if (includeNestedSidebar) {
    client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.sidebarPages] });
  }
}

/**
 * Invalidates database entity caches and optional space lists.
 */
export function invalidateDatabaseEntity(
  {
    databaseId,
    spaceId,
    includeSpaceList = true,
  }: {
    databaseId?: string;
    spaceId?: string;
    includeSpaceList?: boolean;
  } = {},
  { client }: InvalidateOptions,
) {
  if (databaseId) {
    client.invalidateQueries({ queryKey: databaseKey(databaseId) });
  }

  if (includeSpaceList) {
    if (spaceId) {
      client.invalidateQueries({
        queryKey: databasesBySpaceKey(spaceId),
      });
    }

    client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.databases] });
  }
}

/**
 * Invalidates page entity caches (id/slug or all pages via predicate).
 */
export function invalidatePageEntity(
  {
    pageId,
    pageSlugId,
    includeAllPages = false,
  }: {
    pageId?: string;
    pageSlugId?: string;
    includeAllPages?: boolean;
  } = {},
  { client }: InvalidateOptions,
) {
  if (includeAllPages) {
    client.invalidateQueries({
      predicate: (item) => item.queryKey[0] === QUERY_KEY_SPACE.pages,
    });
    return;
  }

  if (pageId) {
    client.invalidateQueries({ queryKey: pageKey(pageId) });
  }

  if (pageSlugId) {
    client.invalidateQueries({ queryKey: pageKey(pageSlugId) });
  }
}

/**
 * Invalidates database row collections and row context cache.
 */
export function invalidateDatabaseRowContext(
  {
    databaseId,
    includeRows = true,
  }: {
    databaseId?: string;
    includeRows?: boolean;
  } = {},
  { client }: InvalidateOptions,
) {
  if (includeRows && databaseId) {
    client.invalidateQueries({
      queryKey: [QUERY_KEY_SPACE.database, databaseId, QUERY_KEY_SPACE.rows],
    });
  }

  if (includeRows && !databaseId) {
    client.invalidateQueries({
      predicate: (item) =>
        item.queryKey[0] === QUERY_KEY_SPACE.database &&
        item.queryKey[2] === QUERY_KEY_SPACE.rows,
    });
  }

  client.invalidateQueries({
    queryKey: databaseRowContextKey(),
  });
}

export function invalidateRecentChanges(
  { spaceId }: { spaceId?: string } = {},
  { client }: InvalidateOptions,
) {
  if (spaceId) {
    client.invalidateQueries({ queryKey: recentChangesKey(spaceId) });
    return;
  }

  client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.recentChanges] });
}

export function invalidateTrashList(
  { spaceId }: { spaceId?: string } = {},
  { client }: InvalidateOptions,
) {
  if (spaceId) {
    client.invalidateQueries({ queryKey: trashListKey(spaceId) });
    return;
  }

  client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.trashList] });
}

export function invalidateBreadcrumbs(
  { pageId }: { pageId?: string } = {},
  { client }: InvalidateOptions,
) {
  if (pageId) {
    client.invalidateQueries({ queryKey: breadcrumbsKey(pageId) });
    return;
  }

  client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.breadcrumbs] });
}

export function invalidateDatabaseProperties(
  { databaseId }: { databaseId?: string } = {},
  { client }: InvalidateOptions,
) {
  if (databaseId) {
    client.invalidateQueries({ queryKey: databasePropertiesKey(databaseId) });
    return;
  }

  client.invalidateQueries({
    predicate: (item) =>
      item.queryKey[0] === QUERY_KEY_SPACE.database &&
      item.queryKey[2] === QUERY_KEY_SPACE.databaseProperties,
  });
}
