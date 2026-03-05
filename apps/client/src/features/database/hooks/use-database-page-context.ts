import { useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useGetDatabaseQuery } from '@/features/database/queries/database-query.ts';
import {
  resolveDatabasePageContext,
  DatabasePageContextValue,
} from '@/features/database/hooks/database-page-context.ts';
import { resolvePageDatabaseIds } from '@/features/page/page-id-adapter.ts';
import { usePageQuery } from '@/features/page/queries/page-query.ts';

type DatabasePageContextParams = Record<string, string | undefined>;

/**
 * Единая точка получения id-контекста для database/page экранов.
 *
 * Возвращает стабильные идентификаторы с приоритетом server-verified данных
 * (`database.pageId/pageSlugId`) и безопасными fallback-значениями из route/page.
 */
export function useDatabasePageContext(): DatabasePageContextValue {
  const { databaseSlug, pageSlug, spaceSlug } =
    useParams<DatabasePageContextParams>();

  const routeSlug = databaseSlug ?? pageSlug;
  const routeIds = resolvePageDatabaseIds({ routeSlug });
  const { data: pageByRoute } = usePageQuery({ pageId: routeIds.pageId });

  const pageIds = resolvePageDatabaseIds({
    pageId: pageByRoute?.id,
    slugId: pageByRoute?.slugId,
    databaseId: pageByRoute?.databaseId,
  });

  /**
   * Храним последний валидный databaseId, чтобы при кратковременном рассинхроне
   * (например, сразу после rename slug) не терять доступ к database.pageId.
   */
  const stableDatabaseIdRef = useRef<string | undefined>(routeIds.databaseId);
  if (pageIds.databaseId) {
    stableDatabaseIdRef.current = pageIds.databaseId;
  }

  const resolvedDatabaseId = pageIds.databaseId ?? stableDatabaseIdRef.current;

  const { data: database } = useGetDatabaseQuery(resolvedDatabaseId);

  return useMemo(
    () =>
      resolveDatabasePageContext({
        databaseSlug,
        pageSlug,
        spaceSlug,
        pageByRoute,
        database,
      }),
    [database, databaseSlug, pageByRoute, pageSlug, spaceSlug],
  );
}
