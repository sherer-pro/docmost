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
  getDatabaseRowContextByPage,
  getDatabaseRows,
} from '@/features/database/services';
import {
  IBatchUpdateDatabaseCellsPayload,
  ICreateDatabasePropertyPayload,
  ICreateDatabaseRowPayload,
  IDatabaseProperty,
} from '@/features/database/types/database.types';
import { IDatabaseRowContext, IDatabaseRowWithCells } from '@/features/database/types/database-table.types';
import { queryClient } from '@/main.tsx';

/**
 * Loads property set (columns) for the selected database.
 */
export function useDatabasePropertiesQuery(
  databaseId?: string,
): UseQueryResult<IDatabaseProperty[], Error> {
  return useQuery({
    queryKey: ['database', databaseId, 'properties'],
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
    queryKey: ['database', databaseId, 'rows'],
    queryFn: () => getDatabaseRows(databaseId as string),
    enabled: Boolean(databaseId),
  });
}



export function useDatabaseRowContextQuery(
  pageId?: string,
): UseQueryResult<IDatabaseRowContext | null, Error> {
  return useQuery({
    queryKey: ['database', 'row-context', pageId],
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
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'rows'],
      });
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
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'properties'],
      });
    },
  });
}

export function useDeleteDatabasePropertyMutation(databaseId?: string) {
  return useMutation({
    mutationFn: (propertyId: string) =>
      deleteDatabaseProperty(databaseId as string, propertyId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'properties'],
      });
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'rows'],
      });
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
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'rows'],
      });
    },
  });
}


export function useDeleteDatabaseRowMutation(databaseId?: string) {
  return useMutation({
    mutationFn: (pageId: string) =>
      deleteDatabaseRow(databaseId as string, pageId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'rows'],
      });
    },
  });
}
