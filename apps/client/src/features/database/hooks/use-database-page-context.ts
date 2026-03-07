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
 * Single source of truth for page/database identifiers on database screens.
 *
 * Returns stable IDs with priority for server-verified values
 * (`database.pageId/pageSlugId`) and safe route/page fallbacks.
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
   * Keep the last valid databaseId so brief desync periods
   * (for example right after slug rename) do not lose page linkage.
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
