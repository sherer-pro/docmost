import { buildDatabaseNodeUrl } from "@/features/page/page.utils.ts";
import { useGetDatabaseQuery } from "@/features/database/queries/database-query.ts";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { LegacyRouteRemoved } from "@/pages/common/legacy-route-removed.tsx";
import { useLegacyCanonicalRedirect } from "@/features/page/hooks/use-legacy-canonical-redirect.ts";
import { useParams } from "react-router-dom";

/**
 * Временный обработчик legacy URL формата `/s/:spaceSlug/databases/:databaseId`.
 *
 * Компонент содержит только предметную часть:
 * - загрузка database и связанной page;
 * - построение канонического URL `/s/:spaceSlug/db/:databaseSlug`.
 *
 * Повторяющиеся части (аудит, redirect, 410-экран) вынесены в общий слой.
 */
export default function DatabaseLegacyRedirect() {
  const { databaseId, spaceSlug } = useParams();

  const {
    data: database,
    isLoading: databaseIsLoading,
    isError: databaseIsError,
  } = useGetDatabaseQuery(databaseId);

  const {
    data: page,
    isLoading: pageIsLoading,
    isError: pageIsError,
  } = usePageQuery({ pageId: database?.pageId });

  const canonicalUrl = page
    ? buildDatabaseNodeUrl({
        spaceSlug,
        pageSlugId: page.slugId,
        pageTitle: page.title,
        databaseId,
        fallbackToLegacy: false,
      })
    : undefined;

  const { isRedirectingOrLoading } = useLegacyCanonicalRedirect({
    routeType: "legacy_database",
    legacyPath: window.location.pathname,
    canonicalUrl,
    isLoading: databaseIsLoading || pageIsLoading,
  });

  if (isRedirectingOrLoading) {
    return null;
  }

  if (databaseIsError || pageIsError || !database?.pageId || !page) {
    return (
      <LegacyRouteRemoved canonicalFormat={"/s/:spaceSlug/db/:databaseSlug"} />
    );
  }

  return null;
}
