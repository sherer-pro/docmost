import {
  useMutation,
  useQuery,
  UseQueryResult,
} from '@tanstack/react-query';
import {
  batchUpdateDatabaseCells,
  createDatabaseProperty,
  createDatabaseRow,
  getDatabaseProperties,
  getDatabaseRows,
} from '@/features/database/services';
import {
  IBatchUpdateDatabaseCellsPayload,
  ICreateDatabasePropertyPayload,
  ICreateDatabaseRowPayload,
  IDatabaseProperty,
} from '@/features/database/types/database.types';
import { IDatabaseRowWithCells } from '@/features/database/types/database-table.types';
import { queryClient } from '@/main.tsx';

/**
 * Загружает набор свойств (колонок) выбранной базы.
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
 * Загружает строки базы данных.
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

/**
 * Добавляет новую строку (row) в выбранную базу.
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
 * Добавляет новое свойство (колонку) в базу.
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

/**
 * Инлайн-сохранение значения ячейки через batch endpoint.
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
