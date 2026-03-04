import {
  useMutation,
  useQuery,
  UseQueryResult,
} from '@tanstack/react-query';
import {
  batchUpdateDatabaseCells,
  createDatabaseProperty,
  createDatabaseRow,
  deleteDatabaseProperty,
  deleteDatabaseRow,
  getDatabaseProperties,
  updateDatabaseProperty,
  getDatabaseRowContextByPage,
  getDatabaseRows,
} from '@/features/database/services';
import {
  IBatchUpdateDatabaseCellsPayload,
  ICreateDatabasePropertyPayload,
  ICreateDatabaseRowPayload,
  IDatabaseProperty,
  IUpdateDatabasePropertyPayload,
} from '@/features/database/types/database.types';
import { IDatabaseRowContext, IDatabaseRowWithCells } from '@/features/database/types/database-table.types';
import { queryClient } from '@/main.tsx';
import { DATABASE_QUERY_KEYS } from '@/features/page/queries/query-keys.ts';
import {
  invalidateDatabaseRowContext,
  invalidateDatabaseProperties,
  invalidateSidebarTree,
} from '@/features/page/queries/cache-invalidation.ts';

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
): UseQueryResult<IDatabaseRowWithCells[], Error> {
  return useQuery({
    queryKey: DATABASE_QUERY_KEYS.rows(databaseId),
    queryFn: () => getDatabaseRows(databaseId as string),
    enabled: Boolean(databaseId),
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
