import { validate as isValidUUID } from 'uuid';

export type PageIdentifier = string;

export interface SplitPageIdentifiersResult {
  uuidIds: string[];
  slugIds: string[];
}

export interface CanonicalPageDatabaseIdentifierContract {
  apiPageId?: string;
  routeSlugId?: string;
  apiDatabaseId?: string;
}

/**
 * Returns the lookup column for a mixed page identifier.
 */
export function getPageIdentifierColumn(
  pageIdentifier: PageIdentifier,
): 'id' | 'slugId' {
  return isValidUUID(pageIdentifier) ? 'id' : 'slugId';
}

/**
 * Splits mixed identifiers into UUID and slug buckets.
 */
export function splitPageIdentifiers(
  pageIdentifiers: PageIdentifier[],
): SplitPageIdentifiersResult {
  return pageIdentifiers.reduce<SplitPageIdentifiersResult>(
    (acc, pageIdentifier) => {
      if (isValidUUID(pageIdentifier)) {
        acc.uuidIds.push(pageIdentifier);
      } else {
        acc.slugIds.push(pageIdentifier);
      }

      return acc;
    },
    { uuidIds: [], slugIds: [] },
  );
}

/**
 * Resolves mixed identifier to canonical `pages.id` UUID.
 */
export async function resolveCanonicalPageId(
  pageIdentifier: PageIdentifier,
  resolveSlugId: (slugId: string) => Promise<string | null>,
): Promise<string | null> {
  if (isValidUUID(pageIdentifier)) {
    return pageIdentifier;
  }

  return resolveSlugId(pageIdentifier);
}

/**
 * Defines canonical identifiers for API, routing and cache layers.
 */
export function resolveCanonicalPageDatabaseIdentifiers(input: {
  pageId?: string | null;
  slugId?: string | null;
  databaseId?: string | null;
}): CanonicalPageDatabaseIdentifierContract {
  return {
    apiPageId: input.pageId ?? undefined,
    routeSlugId: input.slugId ?? undefined,
    apiDatabaseId: input.databaseId ?? undefined,
  };
}
