import { extractPageSlugId } from '../../lib';

type NullableId = string | null | undefined;

export interface ResolvedPageDatabaseIds {
  pageId?: string;
  slugId?: string;
  databaseId?: string;
}

/**
 * Resolves route/API identifiers into a single contract:
 * - page cache key prefers UUID pageId when present;
 * - routing prefers slugId;
 * - database API/cache always uses databaseId.
 */
export function resolvePageDatabaseIds(input: {
  pageId?: NullableId;
  slugId?: NullableId;
  routeSlug?: NullableId;
  databaseId?: NullableId;
}): ResolvedPageDatabaseIds {
  const normalizedSlugId =
    input.slugId ?? (input.routeSlug ? extractPageSlugId(input.routeSlug) : undefined);

  return {
    pageId: input.pageId ?? normalizedSlugId ?? undefined,
    slugId: normalizedSlugId ?? undefined,
    databaseId: input.databaseId ?? undefined,
  };
}

export function getPageQueryKey(pageId: NullableId): [string, string] | null {
  if (!pageId) {
    return null;
  }

  return ['pages', pageId];
}

export function getDatabaseQueryKey(
  databaseId: NullableId,
): [string, string] | null {
  if (!databaseId) {
    return null;
  }

  return ['database', databaseId];
}

