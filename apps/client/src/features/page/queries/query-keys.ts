export const QUERY_KEY_SPACE = {
  rootSidebarPages: "root-sidebar-pages",
  sidebarPages: "sidebar-pages",
  breadcrumbs: "breadcrumbs",
  recentChanges: "recent-changes",
  trashList: "trash-list",
  databases: "databases",
  database: "database",
  databaseProperties: "properties",
  rows: "rows",
  rowContext: "row-context",
  pages: "pages",
} as const;

export type QueryParamsKey = Record<string, unknown>;

export type SidebarKeyParams = {
  pageId?: string;
  spaceId?: string;
  includeNodeTypes?: string[];
};

export function pageKey(pageId?: string) {
  return [QUERY_KEY_SPACE.pages, pageId] as const;
}

export function databaseKey(databaseId?: string) {
  return [QUERY_KEY_SPACE.database, databaseId] as const;
}

export function sidebarKey(params?: SidebarKeyParams | null) {
  return [QUERY_KEY_SPACE.sidebarPages, params] as const;
}

export function rootSidebarKey(spaceId?: string, includeNodeTypes?: string[]) {
  if (includeNodeTypes) {
    return [
      QUERY_KEY_SPACE.rootSidebarPages,
      spaceId,
      includeNodeTypes,
    ] as const;
  }

  return [QUERY_KEY_SPACE.rootSidebarPages, spaceId] as const;
}

export function databasesBySpaceKey(spaceId?: string) {
  return [QUERY_KEY_SPACE.databases, "space", spaceId] as const;
}

export function breadcrumbsKey(pageId?: string) {
  return [QUERY_KEY_SPACE.breadcrumbs, pageId] as const;
}

export function recentChangesKey(spaceId?: string) {
  return [QUERY_KEY_SPACE.recentChanges, spaceId] as const;
}

export function trashListKey(spaceId?: string, params?: QueryParamsKey) {
  return [QUERY_KEY_SPACE.trashList, spaceId, params] as const;
}

export function databasePropertiesKey(databaseId?: string) {
  return [
    QUERY_KEY_SPACE.database,
    databaseId,
    QUERY_KEY_SPACE.databaseProperties,
  ] as const;
}

export function databaseRowsKey(databaseId?: string) {
  return [QUERY_KEY_SPACE.database, databaseId, QUERY_KEY_SPACE.rows] as const;
}

export function databaseRowContextKey(pageId?: string) {
  if (pageId) {
    return [QUERY_KEY_SPACE.database, QUERY_KEY_SPACE.rowContext, pageId] as const;
  }

  return [QUERY_KEY_SPACE.database, QUERY_KEY_SPACE.rowContext] as const;
}

export const PAGE_QUERY_KEYS = {
  page: pageKey,
  sidebar: sidebarKey,
  rootSidebar: rootSidebarKey,
  breadcrumbs: breadcrumbsKey,
  recentChanges: recentChangesKey,
  trashList: trashListKey,
};

export const DATABASE_QUERY_KEYS = {
  bySpace: databasesBySpaceKey,
  byId: databaseKey,
  properties: databasePropertiesKey,
  rows: databaseRowsKey,
  rowContext: databaseRowContextKey,
};
