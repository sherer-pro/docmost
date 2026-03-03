import slugify from "@sindresorhus/slugify";
import { resolvePageDatabaseIds } from "@/features/page/page-id-adapter.ts";

const buildPageSlug = (pageSlugId: string, pageTitle?: string): string => {
  const titleSlug = slugify(pageTitle?.substring(0, 70) || "untitled", {
    customReplacements: [
      ["♥", ""],
      ["🦄", ""],
    ],
  });

  return `${titleSlug}-${pageSlugId}`;
};

/**
 * Builds a URL for a database page in a human-readable format,
 * similar to regular pages: /s/:spaceSlug/db/:title-:slugId.
 */
export const buildDatabaseUrl = (
  spaceSlug: string,
  pageSlugId: string,
  pageTitle?: string,
): string => {
  return `/s/${spaceSlug}/db/${buildPageSlug(pageSlugId, pageTitle)}`;
};

/**
 * Builds URL for a database node using canonical database page slugId.
 */
export const buildDatabaseNodeUrl = (opts: {
  spaceSlug?: string;
  pageSlugId?: string | null;
  pageTitle?: string;
}): string => {
  const { spaceSlug, pageSlugId, pageTitle } = opts;

  if (!spaceSlug) {
    return "/";
  }

  const { slugId } = resolvePageDatabaseIds({ slugId: pageSlugId });
  if (!slugId) {
    return `/s/${spaceSlug}`;
  }

  return buildDatabaseUrl(spaceSlug, slugId, pageTitle);
};

export const buildPageUrl = (
  spaceName: string,
  pageSlugId: string,
  pageTitle?: string,
  anchorId?: string,
): string => {
  let url: string;
  if (spaceName === undefined) {
    url = `/p/${buildPageSlug(pageSlugId, pageTitle)}`;
  } else {
    url = `/s/${spaceName}/p/${buildPageSlug(pageSlugId, pageTitle)}`;
  }
  return anchorId ? `${url}#${anchorId}` : url;
};

export const buildSharedPageUrl = (opts: {
  shareId: string;
  pageSlugId: string;
  pageTitle?: string;
  anchorId?: string;
}): string => {
  const { shareId, pageSlugId, pageTitle, anchorId } = opts;
  let url: string;
  if (!shareId) {
    url = `/share/p/${buildPageSlug(pageSlugId, pageTitle)}`;
  } else {
    url = `/share/${shareId}/p/${buildPageSlug(pageSlugId, pageTitle)}`;
  }
  return anchorId ? `${url}#${anchorId}` : url;
};
