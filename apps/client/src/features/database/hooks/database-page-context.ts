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
 * Normalizes database/page route context to one stable set of identifiers.
 *
 * This keeps UI actions consistent during transient route/data desync:
 * - backend may return `database.pageId/pageSlugId` before page-by-slug refreshes;
 * - comments, header actions, and queries must keep using the same pageId.
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
