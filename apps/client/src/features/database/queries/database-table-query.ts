import { useEffect, useMemo, useRef } from "react";
import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  batchUpdateDatabaseRows,
  batchUpdateDatabaseCells,
  createDatabaseView,
  createDatabaseProperty,
  createDatabaseRow,
  deleteDatabaseView,
  updateDatabaseRow,
  deleteDatabaseProperty,
  deleteDatabaseRow,
  getDatabaseProperties,
  getDatabaseViews,
  updateDatabaseProperty,
  updateDatabaseView,
  getDatabaseRowContextByPage,
  getDatabaseRows,
} from "@/features/database/services";
import {
  IBatchUpdateDatabaseCellsPayload,
  IBatchUpdateDatabaseRowsPayload,
  IBatchUpdateDatabaseRowsResponse,
  ICreateDatabaseViewPayload,
  ICreateDatabasePropertyPayload,
  ICreateDatabaseRowPayload,
  IDatabaseProperty,
  IDatabaseView,
  IUpdateDatabaseRowPayload,
  IUpdateDatabaseRowResponse,
  IUpdateDatabasePropertyPayload,
  IUpdateDatabaseViewPayload,
} from "@/features/database/types/database.types";
import {
  IDatabaseRowContext,
  IDatabaseRowsPage,
  IDatabaseRowsQueryParams,
  IDatabaseRowWithCells,
} from "@/features/database/types/database-table.types";
import { queryClient } from "@/lib/query-client.ts";
import { DATABASE_QUERY_KEYS } from "@/features/page/queries/query-keys.ts";
import {
  invalidateDatabaseRowContext,
  invalidateDatabaseProperties,
  invalidateSidebarTree,
} from "@/features/page/queries/cache-invalidation.ts";

const normalizeDatabaseRowsResponse = (
  data: IDatabaseRowWithCells[] | IDatabaseRowsPage,
): IDatabaseRowsPage => {
  if (Array.isArray(data)) {
    return {
      items: data,
      nextCursor: null,
      hasMore: false,
    };
  }

  return {
    items: data.items ?? [],
    nextCursor: data.nextCursor ?? null,
    hasMore: Boolean(data.hasMore),
  };
};

/**
 * Loads property set (columns) for the selected database.
 */
export function useDatabasePropertiesQuery(
  databaseId?: string,
): UseQueryResult<IDatabaseProperty[], Error> {
  return useQuery({
    queryKey: DATABASE_QUERY_KEYS.properties(databaseId),
    queryFn: () => getDatabaseProperties(databaseId as string),
    enabled: Boolean(databaseId),
  });
}

/**
 * Loads database rows.
 */
export function useDatabaseRowsQuery(
  databaseId?: string,
  params?: IDatabaseRowsQueryParams,
) {
  const { cursor, ...stableParams } = params ?? {};
  const query = useInfiniteQuery({
    queryKey: DATABASE_QUERY_KEYS.rows(databaseId, stableParams),
    queryFn: async ({ pageParam }) =>
      normalizeDatabaseRowsResponse(
        await getDatabaseRows(databaseId as string, {
          ...stableParams,
          cursor: pageParam,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
    enabled: Boolean(databaseId),
  });
  const requestedCursor = useRef<string | null>(null);
  useEffect(() => {
    if (!cursor) {
      requestedCursor.current = null;
      return;
    }
    if (
      cursor !== requestedCursor.current &&
      query.hasNextPage &&
      !query.isFetching
    ) {
      requestedCursor.current = cursor;
      void query.fetchNextPage();
    }
  }, [cursor, query.hasNextPage, query.isFetching]);
  const data = useMemo(
    () =>
      query.data
        ? {
            items: query.data.pages.flatMap((page) => page.items),
            nextCursor: query.data.pages.at(-1)?.nextCursor ?? null,
            hasMore: query.data.pages.at(-1)?.hasMore ?? false,
          }
        : undefined,
    [query.data],
  );
  return { ...query, data };
}

export function useDatabaseViewsQuery(
  databaseId?: string,
): UseQueryResult<IDatabaseView[], Error> {
  return useQuery({
    queryKey: DATABASE_QUERY_KEYS.views(databaseId),
    queryFn: () => getDatabaseViews(databaseId as string),
    enabled: Boolean(databaseId),
  });
}

export function useCreateDatabaseViewMutation(databaseId?: string) {
  return useMutation({
    mutationFn: (payload: ICreateDatabaseViewPayload) =>
      createDatabaseView(databaseId as string, payload),
    onSuccess: (createdView) => {
      queryClient.setQueryData<IDatabaseView[]>(
        DATABASE_QUERY_KEYS.views(databaseId),
        (previousViews = []) => [...previousViews, createdView],
      );
      queryClient.invalidateQueries({
        queryKey: DATABASE_QUERY_KEYS.views(databaseId),
      });
    },
  });
}

export function useUpdateDatabaseViewMutation(databaseId?: string) {
  return useMutation({
    mutationFn: ({
      viewId,
      payload,
    }: {
      viewId: string;
      payload: IUpdateDatabaseViewPayload;
    }) => updateDatabaseView(databaseId as string, viewId, payload),
    onSuccess: (updatedView) => {
      queryClient.setQueryData<IDatabaseView[]>(
        DATABASE_QUERY_KEYS.views(databaseId),
        (previousViews = []) =>
          previousViews.map((view) =>
            view.id === updatedView.id ? updatedView : view,
          ),
      );
      queryClient.invalidateQueries({
        queryKey: DATABASE_QUERY_KEYS.views(databaseId),
      });
    },
  });
}

export function useDeleteDatabaseViewMutation(databaseId?: string) {
  return useMutation({
    mutationFn: (viewId: string) =>
      deleteDatabaseView(databaseId as string, viewId),
    onSuccess: (_result, deletedViewId) => {
      queryClient.setQueryData<IDatabaseView[]>(
        DATABASE_QUERY_KEYS.views(databaseId),
        (previousViews = []) =>
          previousViews.filter((view) => view.id !== deletedViewId),
      );
      queryClient.invalidateQueries({
        queryKey: DATABASE_QUERY_KEYS.views(databaseId),
      });
    },
  });
}

export function useDatabaseRowContextQuery(
  pageId?: string,
): UseQueryResult<IDatabaseRowContext | null, Error> {
  return useQuery({
    queryKey: DATABASE_QUERY_KEYS.rowContext(pageId),
    queryFn: () => getDatabaseRowContextByPage(pageId as string),
    enabled: Boolean(pageId),
  });
}

/**
 * Adds a new row to the selected database.
 */
export function useCreateDatabaseRowMutation(databaseId?: string) {
  return useMutation({
    mutationFn: (payload: ICreateDatabaseRowPayload) =>
      createDatabaseRow(databaseId as string, payload),
    onSuccess: () => {
      invalidateDatabaseRowContext({ databaseId }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
    },
  });
}

/**
 * Renames a row in the selected database.
 */
export function useUpdateDatabaseRowMutation(databaseId?: string) {
  return useMutation<
    IUpdateDatabaseRowResponse,
    Error,
    { pageId: string; payload: IUpdateDatabaseRowPayload }
  >({
    mutationFn: ({ pageId, payload }) =>
      updateDatabaseRow(databaseId as string, pageId, payload),
    onSuccess: () => {
      invalidateDatabaseRowContext({ databaseId }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
    },
  });
}

/**
 * Adds a new property (column) to the database.
 */
export function useCreateDatabasePropertyMutation(databaseId?: string) {
  return useMutation({
    mutationFn: (payload: ICreateDatabasePropertyPayload) =>
      createDatabaseProperty(databaseId as string, payload),
    onSuccess: () => {
      invalidateDatabaseProperties({ databaseId }, { client: queryClient });
    },
  });
}

export function useUpdateDatabasePropertyMutation(databaseId?: string) {
  return useMutation({
    mutationFn: ({
      propertyId,
      payload,
    }: {
      propertyId: string;
      payload: IUpdateDatabasePropertyPayload;
    }) => updateDatabaseProperty(databaseId as string, propertyId, payload),
    onSuccess: () => {
      invalidateDatabaseProperties({ databaseId }, { client: queryClient });
      invalidateDatabaseRowContext({ databaseId }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
    },
  });
}

export function useDeleteDatabasePropertyMutation(databaseId?: string) {
  return useMutation({
    mutationFn: (propertyId: string) =>
      deleteDatabaseProperty(databaseId as string, propertyId),
    onSuccess: () => {
      invalidateDatabaseProperties({ databaseId }, { client: queryClient });
      invalidateDatabaseRowContext({ databaseId }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
    },
  });
}

/**
 * Performs inline cell value persistence through the batch endpoint.
 */
export function useBatchUpdateDatabaseCellsMutation(databaseId?: string) {
  return useMutation({
    mutationFn: ({
      pageId,
      payload,
    }: {
      pageId: string;
      payload: IBatchUpdateDatabaseCellsPayload;
    }) => batchUpdateDatabaseCells(databaseId as string, pageId, payload),
    onSuccess: () => {
      invalidateDatabaseRowContext({ databaseId }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
    },
  });
}

export function useBatchUpdateDatabaseRowsMutation(databaseId?: string) {
  return useMutation<
    IBatchUpdateDatabaseRowsResponse,
    Error,
    IBatchUpdateDatabaseRowsPayload
  >({
    mutationFn: (payload) =>
      batchUpdateDatabaseRows(databaseId as string, payload),
    onSuccess: () => {
      invalidateDatabaseRowContext({ databaseId }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
    },
  });
}

export function useDeleteDatabaseRowMutation(databaseId?: string) {
  return useMutation({
    mutationFn: (pageId: string) =>
      deleteDatabaseRow(databaseId as string, pageId),
    onSuccess: () => {
      invalidateDatabaseRowContext({ databaseId }, { client: queryClient });
      invalidateSidebarTree({}, { client: queryClient });
    },
  });
}
