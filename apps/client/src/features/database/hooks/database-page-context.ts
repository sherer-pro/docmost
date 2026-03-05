import { IDatabase } from '@/features/database/types/database.types.ts';
import { resolvePageDatabaseIds } from '@/features/page/page-id-adapter.ts';
import { IPage } from '@/features/page/types/page.types.ts';

export interface ResolveDatabasePageContextInput {
  databaseSlug?: string;
  pageSlug?: string;
  spaceSlug?: string;
  pageByRoute?: IPage;
  database?: IDatabase;
}

export interface DatabasePageContextValue {
  databaseId?: string;
  databasePageId?: string;
  databasePageSlugId?: string;
  spaceSlug?: string;
  pageByRoute?: IPage;
  database?: IDatabase;
}

/**
 * Нормализует контекст database/page маршрутов в единый набор идентификаторов.
 *
 * Зачем это нужно:
 * - при rename backend может быстрее вернуть `database.pageId/pageSlugId`,
 *   чем обновится запрос page-by-slug;
 * - комментарии, header-меню и прочие действия должны использовать один и тот же
 *   pageId, чтобы query-key и UI не расходились по разным сущностям.
 */
export function resolveDatabasePageContext(
  input: ResolveDatabasePageContextInput,
): DatabasePageContextValue {
  const routeSlug = input.databaseSlug ?? input.pageSlug;
  const routeIds = resolvePageDatabaseIds({ routeSlug });

  const pageIds = resolvePageDatabaseIds({
    pageId: input.pageByRoute?.id,
    slugId: input.pageByRoute?.slugId,
    databaseId: input.pageByRoute?.databaseId,
  });

  const databaseId = input.database?.id ?? pageIds.databaseId;
  const databasePageId =
    input.database?.pageId ?? input.pageByRoute?.id ?? routeIds.pageId;
  const databasePageSlugId =
    input.database?.pageSlugId ?? input.pageByRoute?.slugId ?? routeIds.slugId;

  return {
    databaseId: databaseId ?? undefined,
    databasePageId: databasePageId ?? undefined,
    databasePageSlugId: databasePageSlugId ?? undefined,
    spaceSlug: input.spaceSlug,
    pageByRoute: input.pageByRoute,
    database: input.database,
  };
}
