import {
  InfiniteData,
  QueryKey,
  useInfiniteQuery,
  UseInfiniteQueryResult,
  useMutation,
  useQuery,
  UseQueryResult,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  createPage,
  deletePage,
  getPageById,
  getSidebarPages,
  updatePage,
  movePage,
  getPageBreadcrumbs,
  getRecentChanges,
  getAllSidebarPages,
  getDeletedPages,
  restorePage,
  convertPageToDatabase,
} from "@/features/page/services/page-service";
import {
  IMovePage,
  IPage,
  IPageInput,
  IUpdatePageInput,
  SidebarNodeType,
  ISidebarNode,
  SidebarPagesParams,
  PageCustomFieldStatus,
} from "@/features/page/types/page.types";
import { notifications } from "@mantine/notifications";
import { IPagination, QueryParams } from "@/lib/types.ts";
import { queryClient } from "@/main.tsx";
import { buildTree } from "@/features/page/tree/utils";
import { useEffect } from "react";
import { validate as isValidUuid } from "uuid";
import { useTranslation } from "react-i18next";
import { getDefaultStore, useAtom } from "jotai";
import {
  dropTreeNodeAtom,
  treeDataAtom,
} from "@/features/page/tree/atoms/tree-data-atom";
import { SimpleTree } from "react-arborist";
import { SpaceTreeNode } from "@/features/page/tree/types";
import { useQueryEmit } from "@/features/websocket/use-query-emit";
import {
  PAGE_QUERY_KEYS,
  breadcrumbsKey,
  recentChangesKey,
  SidebarKeyParams,
  trashListKey,
  QUERY_KEY_SPACE,
} from "@/features/page/queries/query-keys";
import {
  invalidateBreadcrumbs,
  invalidateDatabaseEntity,
  invalidateDatabaseRowContext,
  invalidatePageEntity,
  invalidateRecentChanges,
  invalidateSidebarTree,
  invalidateTrashList,
} from "@/features/page/queries/cache-invalidation";

const DEFAULT_SIDEBAR_NODE_TYPES: SidebarNodeType[] = ["page", "database"];

const jotaiStore = getDefaultStore();

/**
 * Ensures that base node types are always present in a sidebar request.
 * This is necessary so that pages and databases are simultaneously displayed in the general SpaceTree.
 */
function withDefaultSidebarNodeTypes(
  params: SidebarPagesParams,
): SidebarPagesParams {
  const includeNodeTypes = Array.from(
    new Set([
      ...(params.includeNodeTypes ?? []),
      ...DEFAULT_SIDEBAR_NODE_TYPES,
    ]),
  );

  return {
    ...params,
    includeNodeTypes,
  };
}

export function usePageQuery(
  pageInput: Partial<IPageInput>,
): UseQueryResult<IPage, Error> {
  const query = useQuery({
    queryKey: PAGE_QUERY_KEYS.page(pageInput.pageId),
    queryFn: () => getPageById(pageInput),
    enabled: !!pageInput.pageId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (query.data) {
      if (isValidUuid(pageInput.pageId)) {
        queryClient.setQueryData(
          PAGE_QUERY_KEYS.page(query.data.slugId),
          query.data,
        );
      } else {
        queryClient.setQueryData(
          PAGE_QUERY_KEYS.page(query.data.id),
          query.data,
        );
      }
    }
  }, [query.data]);

  return query;
}

function invalidateDatabaseTreeConsistency() {
  invalidateDatabaseRowContext({}, { client: queryClient });
}

export function useCreatePageMutation() {
  const { t } = useTranslation();
  return useMutation<IPage, Error, Partial<IPageInput>>({
    mutationFn: (data) => createPage(data),
    onSuccess: (data) => {
      invalidateOnCreatePage(data);
    },
    onError: (error) => {
      notifications.show({ message: t("Failed to create page"), color: "red" });
    },
  });
}

export function updatePageData(data: IPage) {
  queryClient.setQueryData<IPage>(
    PAGE_QUERY_KEYS.page(data.slugId),
    (pageBySlug) => ({
      ...(pageBySlug ?? {}),
      ...data,
    }),
  );

  queryClient.setQueryData<IPage>(
    PAGE_QUERY_KEYS.page(data.id),
    (pageById) => ({
      ...(pageById ?? {}),
      ...data,
    }),
  );

  invalidateOnUpdatePage(
    data.spaceId,
    data.parentPageId,
    data.id,
    data.title,
    data.icon,
    data.customFields?.status,
  );
}

export function updatePageDataFromPatch(
  data: Pick<IPage, "id" | "spaceId"> & Partial<IPage>,
): IPage | undefined {
  const pageById = queryClient.getQueryData<IPage>(
    PAGE_QUERY_KEYS.page(data.id),
  );
  const resolvedSlugId = data.slugId ?? pageById?.slugId;
  const pageBySlug = resolvedSlugId
    ? queryClient.getQueryData<IPage>(PAGE_QUERY_KEYS.page(resolvedSlugId))
    : undefined;
  const basePage = pageById ?? pageBySlug;

  if (!basePage) {
    return undefined;
  }

  const updatedPage: IPage = {
    ...basePage,
    ...data,
    settings:
      data.settings === undefined
        ? basePage.settings
        : {
            ...(basePage.settings ?? {}),
            ...data.settings,
          },
    customFields:
      data.customFields === undefined
        ? basePage.customFields
        : {
            ...basePage.customFields,
            ...data.customFields,
          },
  };

  updatePageData(updatedPage);

  return updatedPage;
}

export function useUpdateTitlePageMutation() {
  return useMutation<IPage, Error, IUpdatePageInput>({
    mutationFn: (data) => updatePage(data),
    onSuccess: () => {
      invalidateDatabaseTreeConsistency();
    },
  });
}

export function useUpdatePageMutation() {
  return useMutation<IPage, Error, IUpdatePageInput>({
    mutationFn: (data) => updatePage(data),
    onSuccess: (data) => {
      updatePageData(data);
    },
  });
}

export function useRemovePageMutation() {
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (pageId: string) => deletePage(pageId, false),
    onSuccess: (_, pageId) => {
      notifications.show({ message: t("Page moved to trash") });
      invalidateOnDeletePage(pageId);
      queryClient.invalidateQueries({
        queryKey: trashListKey(),
      });
    },
    onError: (error) => {
      notifications.show({ message: t("Failed to delete page"), color: "red" });
    },
  });
}

export function useDeletePageMutation() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (pageId: string) => deletePage(pageId, true),
    onSuccess: (data, pageId) => {
      notifications.show({ message: t("Page deleted successfully") });
      invalidateOnDeletePage(pageId);

      // Invalidate to refresh trash lists
      queryClient.invalidateQueries({
        queryKey: trashListKey(),
      });
    },
    onError: (error) => {
      notifications.show({ message: t("Failed to delete page"), color: "red" });
    },
  });
}

/**
 * Mutation of page to database conversion.
 *
 * After a successful operation, we invalidate the tree, page card and related
 * database queries so that the UI immediately reflects the change in node type.
 */
export function useConvertPageToDatabaseMutation() {
  return useMutation({
    mutationFn: (pageId: string) => convertPageToDatabase(pageId),
    onSuccess: (data) => {
      /**
       * It is important to invalidate ALL `pages` caches, not just the key by UUID.
       *
       * After conversion, the route goes to `/db/:slug`, where `usePageQuery`
       * requests a page specifically by slugId. Before conversion in cache already
       * there may be a record `['pages', slugId]` without `databaseId`, and when
       * `staleTime` at 5 minutes the UI temporarily gets a stale node, which
       * visually appears as a “blank page” before manual refresh.
       */
      invalidatePageEntity({ includeAllPages: true }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
      invalidateDatabaseEntity(
        { databaseId: data.databaseId },
        { client: queryClient },
      );
      invalidateDatabaseRowContext(
        { databaseId: data.databaseId },
        { client: queryClient },
      );
    },
  });
}

export function useMovePageMutation() {
  return useMutation<void, Error, IMovePage>({
    mutationFn: (data) => movePage(data),
  });
}

export function useRestorePageMutation() {
  const [treeData, setTreeData] = useAtom(treeDataAtom);
  const emit = useQueryEmit();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (pageId: string) => restorePage(pageId),
    onSuccess: async (restoredPage) => {
      notifications.show({ message: t("Page restored successfully") });

      // Add the restored page back to the tree
      const treeApi = new SimpleTree<SpaceTreeNode>(treeData);

      // Check if the page already exists in the tree (it shouldn't)
      if (!treeApi.find(restoredPage.id)) {
        // Create the tree node data with hasChildren from backend
        const nodeData: SpaceTreeNode = {
          id: restoredPage.id,
          nodeType: "page",
          slugId: restoredPage.slugId,
          databaseId: null,
          name: restoredPage.title || "Untitled",
          icon: restoredPage.icon,
          position: restoredPage.position,
          spaceId: restoredPage.spaceId,
          parentPageId: restoredPage.parentPageId,
          hasChildren: restoredPage.hasChildren || false,
          children: [],
        };

        // Determine the parent and index
        const parentId = restoredPage.parentPageId || null;
        let index = 0;

        if (parentId) {
          const parentNode = treeApi.find(parentId);
          if (parentNode) {
            index = parentNode.children?.length || 0;
          }
        } else {
          // Root level page
          index = treeApi.data.length;
        }

        // Add the node to the tree
        treeApi.create({
          parentId,
          index,
          data: nodeData,
        });

        // Update the tree data
        setTreeData(treeApi.data);

        // Emit websocket event to sync with other users
        setTimeout(() => {
          emit({
            operation: "addTreeNode",
            spaceId: restoredPage.spaceId,
            payload: {
              parentId,
              index,
              node: nodeData,
            },
          });
        }, 50);
      }

      // Also invalidate deleted pages query to refresh the trash list
      await queryClient.invalidateQueries({
        queryKey: trashListKey(restoredPage.spaceId),
      });
    },
    onError: (error) => {
      notifications.show({
        message: t("Failed to restore page"),
        color: "red",
      });
    },
  });
}

export function useGetSidebarPagesQuery(
  data: SidebarPagesParams | null,
): UseInfiniteQueryResult<InfiniteData<IPagination<ISidebarNode>, unknown>> {
  const sidebarParams = data ? withDefaultSidebarNodeTypes(data) : null;

  return useInfiniteQuery({
    queryKey: PAGE_QUERY_KEYS.sidebar(sidebarParams),
    enabled: !!sidebarParams?.pageId || !!sidebarParams?.spaceId,
    queryFn: ({ pageParam }) => {
      if (!sidebarParams) {
        throw new Error("Sidebar params are required");
      }

      return getSidebarPages({ ...sidebarParams, cursor: pageParam });
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.nextCursor ?? undefined,
  });
}

export function useGetRootSidebarPagesQuery(data: SidebarPagesParams) {
  const sidebarParams = withDefaultSidebarNodeTypes(data);

  return useInfiniteQuery({
    queryKey: PAGE_QUERY_KEYS.rootSidebar(
      data.spaceId,
      sidebarParams.includeNodeTypes,
    ),
    queryFn: async ({ pageParam }) => {
      return getSidebarPages({ ...sidebarParams, cursor: pageParam });
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.nextCursor ?? undefined,
  });
}

export function usePageBreadcrumbsQuery(
  pageId: string,
): UseQueryResult<Partial<IPage[]>, Error> {
  return useQuery({
    queryKey: breadcrumbsKey(pageId),
    queryFn: () => getPageBreadcrumbs(pageId),
    enabled: !!pageId,
  });
}

export async function fetchAllAncestorChildren(params: SidebarPagesParams) {
  const sidebarParams = withDefaultSidebarNodeTypes(params);

  // not using a hook here, so we can call it inside a useEffect hook
  const response = await queryClient.fetchQuery({
    queryKey: PAGE_QUERY_KEYS.sidebar(sidebarParams),
    queryFn: () => getAllSidebarPages(sidebarParams),
    staleTime: 30 * 60 * 1000,
  });

  const allItems = response.pages.flatMap((page) => page.items);
  return buildTree(allItems);
}

export function useRecentChangesQuery(
  spaceId?: string,
): UseQueryResult<IPagination<IPage>, Error> {
  return useQuery({
    queryKey: recentChangesKey(spaceId),
    queryFn: () => getRecentChanges(spaceId),
    refetchOnMount: true,
  });
}

export function useDeletedPagesQuery(
  spaceId: string,
  params?: QueryParams,
): UseQueryResult<IPagination<IPage>, Error> {
  return useQuery({
    queryKey: trashListKey(spaceId, params),
    queryFn: () => getDeletedPages(spaceId, params),
    enabled: !!spaceId,
    placeholderData: keepPreviousData,
    refetchOnMount: true,
    staleTime: 0,
  });
}

export function invalidateOnCreatePage(data: Partial<IPage>) {
  const newPage: Partial<IPage> = {
    creatorId: data.creatorId,
    hasChildren: data.hasChildren,
    icon: data.icon,
    id: data.id,
    parentPageId: data.parentPageId,
    position: data.position,
    slugId: data.slugId,
    spaceId: data.spaceId,
    title: data.title,
  };

  let queryKey: QueryKey = null;
  if (data.parentPageId === null) {
    queryKey = PAGE_QUERY_KEYS.rootSidebar(data.spaceId);
  } else {
    queryKey = PAGE_QUERY_KEYS.sidebar({
      pageId: data.parentPageId,
      spaceId: data.spaceId,
    });
  }

  //update all sidebar pages
  queryClient.setQueryData<InfiniteData<IPagination<Partial<IPage>>>>(
    queryKey,
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page, index) => {
          if (index === old.pages.length - 1) {
            return {
              ...page,
              items: [...page.items, newPage],
            };
          }
          return page;
        }),
      };
    },
  );

  //update sidebar haschildren
  if (data.parentPageId !== null) {
    //update sub sidebar pages haschildern
    const subSideBarMatches = queryClient.getQueriesData({
      queryKey: [QUERY_KEY_SPACE.sidebarPages],
      exact: false,
    });

    subSideBarMatches.forEach(([key, d]) => {
      queryClient.setQueryData<InfiniteData<IPagination<IPage>>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((sidebarPage: IPage) =>
              sidebarPage.id === data.parentPageId
                ? { ...sidebarPage, hasChildren: true }
                : sidebarPage,
            ),
          })),
        };
      });
    });

    //update root sidebar pages haschildern
    const rootSideBarMatches = queryClient.getQueriesData({
      queryKey: PAGE_QUERY_KEYS.rootSidebar(data.spaceId),
      exact: false,
    });

    rootSideBarMatches.forEach(([key, d]) => {
      queryClient.setQueryData<InfiniteData<IPagination<IPage>>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((sidebarPage: IPage) =>
              sidebarPage.id === data.parentPageId
                ? { ...sidebarPage, hasChildren: true }
                : sidebarPage,
            ),
          })),
        };
      });
    });
  }

  //update recent changes
  invalidateRecentChanges({ spaceId: data.spaceId }, { client: queryClient });
  invalidateDatabaseTreeConsistency();
}

export function invalidateOnUpdatePage(
  spaceId: string,
  parentPageId: string | null | undefined,
  id: string,
  title?: string,
  icon?: string | null,
  status?: PageCustomFieldStatus | null,
) {
  const targetSidebarCacheKeys = queryClient
    .getQueriesData({
      predicate: (query) => {
        if (query.queryKey[0] === QUERY_KEY_SPACE.rootSidebarPages) {
          return query.queryKey[1] === spaceId;
        }

        if (query.queryKey[0] === QUERY_KEY_SPACE.sidebarPages) {
          const params = query.queryKey[1] as SidebarKeyParams | undefined;

          if (params?.spaceId !== spaceId) {
            return false;
          }

          if (parentPageId === undefined) {
            return true;
          }

          return params?.pageId === parentPageId;
        }

        return false;
      },
    })
    .map(([key]) => key);

  targetSidebarCacheKeys.forEach((queryKey) => {
    queryClient.setQueryData<InfiniteData<IPagination<IPage>>>(
      queryKey,
      (old) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((sidebarPage: IPage) =>
              sidebarPage.id === id
                ? {
                    ...sidebarPage,
                    ...(title !== undefined ? { title } : {}),
                    ...(icon !== undefined ? { icon } : {}),
                    ...(status !== undefined
                      ? {
                          customFields: {
                            ...sidebarPage.customFields,
                            status,
                          },
                        }
                      : {}),
                  }
                : sidebarPage,
            ),
          })),
        };
      },
    );
  });

  const currentTreeData = jotaiStore.get(treeDataAtom);
  if (currentTreeData.length > 0) {
    const treeApi = new SimpleTree<SpaceTreeNode>(currentTreeData);
    const changes: Partial<SpaceTreeNode> = {};

    if (title !== undefined) {
      changes.name = title;
    }

    if (icon !== undefined) {
      changes.icon = icon;
    }

    if (status !== undefined) {
      changes.status = status;
    }

    if (treeApi.find(id) && Object.keys(changes).length > 0) {
      treeApi.update({
        id,
        changes,
      });
      jotaiStore.set(treeDataAtom, treeApi.data);
    }
  }

  //update recent changes
  invalidateRecentChanges({ spaceId }, { client: queryClient });
  invalidateDatabaseTreeConsistency();
}

export function updateCacheOnMovePage(
  spaceId: string,
  pageId: string,
  oldParentId: string | null,
  newParentId: string | null,
  pageData: Partial<IPage> & Partial<ISidebarNode>,
) {
  type SidebarCacheItem = Partial<IPage> & Partial<ISidebarNode>;

  const getParentCacheKeys = (parentId: string | null): QueryKey[] => {
    return queryClient
      .getQueriesData<InfiniteData<IPagination<SidebarCacheItem>>>({
        predicate: (query) => {
          if (query.queryKey[0] === QUERY_KEY_SPACE.rootSidebarPages) {
            return parentId === null && query.queryKey[1] === spaceId;
          }

          if (
            query.queryKey[0] === QUERY_KEY_SPACE.sidebarPages &&
            parentId !== null
          ) {
            const params = query.queryKey[1] as SidebarKeyParams | undefined;
            return params?.spaceId === spaceId && params?.pageId === parentId;
          }

          return false;
        },
      })
      .map(([key]) => key);
  };

  // Remove page from old parent's cache
  const oldParentCacheKeys = getParentCacheKeys(oldParentId);
  oldParentCacheKeys.forEach((key) => {
    queryClient.setQueryData<InfiniteData<IPagination<SidebarCacheItem>>>(
      key,
      (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== pageId),
          })),
        };
      },
    );
  });

  // Update old parent's hasChildren flag if it has no more children
  if (oldParentId !== null && oldParentCacheKeys.length > 0) {
    const remainingChildren = oldParentCacheKeys.reduce((acc, key) => {
      const cache =
        queryClient.getQueryData<InfiniteData<IPagination<SidebarCacheItem>>>(
          key,
        );
      const count = cache?.pages.flatMap((page) => page.items).length ?? 0;
      return Math.max(acc, count);
    }, 0);

    if (remainingChildren === 0) {
      // Update hasChildren in all caches where old parent appears
      const allSideBarMatches = queryClient.getQueriesData({
        predicate: (query) =>
          query.queryKey[0] === QUERY_KEY_SPACE.rootSidebarPages ||
          query.queryKey[0] === QUERY_KEY_SPACE.sidebarPages,
      });

      allSideBarMatches.forEach(([key]) => {
        queryClient.setQueryData<InfiniteData<IPagination<SidebarCacheItem>>>(
          key,
          (old) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((item) =>
                  item.id === oldParentId
                    ? { ...item, hasChildren: false }
                    : item,
                ),
              })),
            };
          },
        );
      });
    }
  }

  // Add page to new parent's cache
  const newParentCacheKeys = getParentCacheKeys(newParentId);
  newParentCacheKeys.forEach((key) => {
    queryClient.setQueryData<InfiniteData<IPagination<SidebarCacheItem>>>(
      key,
      (old) => {
        if (!old) return old;

        // Check if page already exists in new location
        const exists = old.pages.some((page) =>
          page.items.some((item) => item.id === pageId),
        );
        if (exists) return old;

        return {
          ...old,
          pages: old.pages.map((page, index) => {
            if (index === old.pages.length - 1) {
              return {
                ...page,
                items: [...page.items, pageData],
              };
            }
            return page;
          }),
        };
      },
    );
  });

  // Update new parent's hasChildren flag
  if (newParentId !== null) {
    const allSideBarMatches = queryClient.getQueriesData({
      predicate: (query) =>
        query.queryKey[0] === QUERY_KEY_SPACE.rootSidebarPages ||
        query.queryKey[0] === QUERY_KEY_SPACE.sidebarPages,
    });

    allSideBarMatches.forEach(([key]) => {
      queryClient.setQueryData<InfiniteData<IPagination<IPage>>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === newParentId ? { ...item, hasChildren: true } : item,
            ),
          })),
        };
      });
    });
  }

  invalidateDatabaseTreeConsistency();
}

export function invalidateOnDeletePage(pageId: string) {
  /**
   * We synchronously remove a node from the atom tree using the same algorithm as drag/drop (`SimpleTree.drop`).
   *
   * This ensures cascading deletion of child nodes (including `databaseRow`)
   * and removes visual “ghosts” until the next server-refetch arrives.
   */
  jotaiStore.set(dropTreeNodeAtom, pageId);

  //update all sidebar pages
  const allSideBarMatches = queryClient.getQueriesData({
    predicate: (query) =>
      query.queryKey[0] === QUERY_KEY_SPACE.rootSidebarPages ||
      query.queryKey[0] === QUERY_KEY_SPACE.sidebarPages,
  });

  allSideBarMatches.forEach(([key, d]) => {
    queryClient.setQueryData<InfiniteData<IPagination<IPage>>>(key, (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.filter(
            (sidebarPage: IPage) => sidebarPage.id !== pageId,
          ),
        })),
      };
    });
  });

  //update recent changes
  invalidateRecentChanges({}, { client: queryClient });
  invalidateBreadcrumbs({}, { client: queryClient });
  invalidateTrashList({}, { client: queryClient });
  invalidateDatabaseTreeConsistency();
}

