import { useMutation, useQuery, UseQueryResult } from "@tanstack/react-query";
import { createDatabase, getDatabase, getDatabases } from "@/features/database/services";
import { IDatabase } from "@/features/database/types/database.types";
import { ICreateDatabasePayload } from "@/features/database/types/database.types";
import { IUpdateDatabasePayload } from "@/features/database/types/database.types";
import { updateDatabase } from "@/features/database/services/database-service";
import { queryClient } from "@/main";

/**
 * Возвращает список баз данных для выбранного пространства.
 *
 * Хук используется в боковой панели Space, чтобы отрисовать отдельный
 * раздел Databases без вмешательства в дерево страниц.
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
 * Возвращает одну базу данных по идентификатору.
 *
 * Хук используется страницей маршрута /s/:spaceSlug/databases/:databaseId
 * для загрузки метаданных выбранной базы данных.
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
      queryClient.invalidateQueries({
        queryKey: ["databases", "space", spaceId],
      });
    },
  });
}

/**
 * Обновляет метаданные базы данных и синхронизирует кеш.
 *
 * После успешного PATCH инвалидируются:
 * - детальная запись текущей базы;
 * - список баз данных в текущем пространстве.
 */
export function useUpdateDatabaseMutation(spaceId?: string, databaseId?: string) {
  return useMutation({
    mutationFn: (payload: IUpdateDatabasePayload) =>
      updateDatabase(databaseId as string, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["database", databaseId],
      });
      queryClient.invalidateQueries({
        queryKey: ["databases", "space", spaceId],
      });
    },
  });
}
