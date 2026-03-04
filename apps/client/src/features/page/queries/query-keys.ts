export const QUERY_KEY_SPACE = {
  rootSidebarPages: "root-sidebar-pages",
  sidebarPages: "sidebar-pages",
  databases: "databases",
  database: "database",
  rows: "rows",
  rowContext: "row-context",
  pages: "pages",
} as const;

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

export const PAGE_QUERY_KEYS = {
  page: pageKey,
  sidebar: sidebarKey,
  rootSidebar: rootSidebarKey,
};

export const DATABASE_QUERY_KEYS = {
  bySpace: databasesBySpaceKey,
  byId: databaseKey,
};
