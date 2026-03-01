import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getDatabase, getDatabases } from "@/features/database/services";
import { IDatabase } from "@/features/database/types/database.types";

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
