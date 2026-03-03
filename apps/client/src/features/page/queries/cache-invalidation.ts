import { QueryClient } from '@tanstack/react-query';

/**
 * Query key-space map for page/database cache domains.
 *
 * - `['root-sidebar-pages', spaceId]` — root SpaceTree nodes for a space.
 * - `['sidebar-pages', params]` — child tree nodes by `pageId`/`spaceId`.
 * - `['databases', 'space', spaceId]` — databases list in current space.
 * - `['database', databaseId]` — single database metadata.
 * - `['database', databaseId, 'rows']` — rows collection for a database.
 * - `['database', 'row-context']` — selected row/context panel state.
 * - `['pages', pageId|slugId]` — single page entity by id/slug.
 * - `['pages', *]` (predicate) — all page entity variants.
 */
export const QUERY_KEY_SPACE = {
  rootSidebarPages: 'root-sidebar-pages',
  sidebarPages: 'sidebar-pages',
  databases: 'databases',
  database: 'database',
  rows: 'rows',
  rowContext: 'row-context',
  pages: 'pages',
} as const;

type QueryClientLike = Pick<QueryClient, 'invalidateQueries'>;

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
    client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.rootSidebarPages, spaceId] });
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
    client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.database, databaseId] });
  }

  if (includeSpaceList) {
    if (spaceId) {
      client.invalidateQueries({
        queryKey: [QUERY_KEY_SPACE.databases, 'space', spaceId],
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
    client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.pages, pageId] });
  }

  if (pageSlugId) {
    client.invalidateQueries({ queryKey: [QUERY_KEY_SPACE.pages, pageSlugId] });
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
        item.queryKey[0] === QUERY_KEY_SPACE.database && item.queryKey[2] === QUERY_KEY_SPACE.rows,
    });
  }

  client.invalidateQueries({
    queryKey: [QUERY_KEY_SPACE.database, QUERY_KEY_SPACE.rowContext],
  });
}
