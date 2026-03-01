import { useMutation, useQuery, UseQueryResult } from "@tanstack/react-query";
import { createDatabase, getDatabase, getDatabases } from "@/features/database/services";
import { IDatabase } from "@/features/database/types/database.types";
import { ICreateDatabasePayload } from "@/features/database/types/database.types";
import { IUpdateDatabasePayload } from "@/features/database/types/database.types";
import { convertDatabaseToPage, updateDatabase } from "@/features/database/services/database-service";
import { queryClient } from "@/main";

/**
 * Returns the list of databases for the selected space.
 *
 * This hook is used in the Space sidebar to render a dedicated
 * Databases section without interfering with the page tree.
 */
export function useGetDatabasesBySpaceQuery(
  spaceId?: string,
): UseQueryResult<IDatabase[], Error> {
  return useQuery({
    queryKey: ["databases", "space", spaceId],
    queryFn: () => getDatabases(spaceId as string),
    enabled: Boolean(spaceId),
  });
}

/**
 * Returns a single database by id.
 *
 * This hook is used by the /s/:spaceSlug/db/:databaseSlug route page
 * to load metadata for the selected database.
 */
export function useGetDatabaseQuery(
  databaseId?: string,
): UseQueryResult<IDatabase, Error> {
  return useQuery({
    queryKey: ["database", databaseId],
    queryFn: () => getDatabase(databaseId as string),
    enabled: Boolean(databaseId),
  });
}

export function useCreateDatabaseMutation(spaceId?: string) {
  return useMutation({
    mutationFn: (payload: ICreateDatabasePayload) => createDatabase(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["databases", "space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["root-sidebar-pages", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-pages"] });
    },
  });
}

/**
 * Updates database metadata and synchronizes cache.
 *
 * After a successful PATCH, the following queries are invalidated:
 * - detailed record of the current database;
 * - database list for the current space.
 */
export function useUpdateDatabaseMutation(spaceId?: string, databaseId?: string) {
  return useMutation({
    mutationFn: (payload: IUpdateDatabasePayload) =>
      updateDatabase(databaseId as string, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["database", databaseId],
      });
      queryClient.invalidateQueries({ queryKey: ["databases", "space", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["root-sidebar-pages", spaceId] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-pages"] });
    },
  });
}


/**
 * Конвертирует базу данных в страницу и синхронно обновляет кэш дерева/деталей.
 */
export function useConvertDatabaseToPageMutation(spaceId?: string, databaseId?: string) {
  return useMutation({
    mutationFn: () => convertDatabaseToPage(databaseId as string),
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: ['database', databaseId] });
      queryClient.invalidateQueries({ queryKey: ['databases', 'space', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['root-sidebar-pages', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-pages'] });
      queryClient.invalidateQueries({ queryKey: ['database', databaseId, 'rows'] });
      queryClient.invalidateQueries({ queryKey: ['database', 'row-context'] });

      if (page?.id) {
        queryClient.invalidateQueries({ queryKey: ['pages', page.id] });
      }
      if (page?.slugId) {
        queryClient.invalidateQueries({ queryKey: ['pages', page.slugId] });
      }
    },
  });
}
