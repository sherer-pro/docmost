import slugify from "@sindresorhus/slugify";

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
 * Строит URL для database-страницы в человекочитаемом формате,
 * аналогичном обычным страницам: /s/:spaceSlug/db/:title-:slugId.
 */
export const buildDatabaseUrl = (
  spaceSlug: string,
  pageSlugId: string,
  pageTitle?: string,
): string => {
  return `/s/${spaceSlug}/db/${buildPageSlug(pageSlugId, pageTitle)}`;
};

/**
 * Конфигурация временного fallback-маршрута для database-страниц.
 *
 * TODO(DOC-2471): удалить fallback после полной стабилизации slugId во всех tree payload.
 */
export const DATABASE_ROUTE_FALLBACK_CONFIG = {
  enabled: true,
  removeBy: "2026-03-31",
  ticket: "DOC-2471",
} as const;

/**
 * Строит URL для database-узла по единому приоритету:
 * 1) канонический `/s/:spaceSlug/db/:databaseSlug` по `slugId`;
 * 2) временный fallback `/s/:spaceSlug/databases/:databaseId` по `databaseId`.
 */
export const buildDatabaseNodeUrl = (opts: {
  spaceSlug?: string;
  pageSlugId?: string | null;
  pageTitle?: string;
  databaseId?: string | null;
  fallbackToLegacy?: boolean;
}): string => {
  const {
    spaceSlug,
    pageSlugId,
    pageTitle,
    databaseId,
    fallbackToLegacy = DATABASE_ROUTE_FALLBACK_CONFIG.enabled,
  } = opts;

  if (!spaceSlug) {
    return "/";
  }

  if (pageSlugId) {
    return buildDatabaseUrl(spaceSlug, pageSlugId, pageTitle);
  }

  if (fallbackToLegacy && databaseId) {
    return `/s/${spaceSlug}/databases/${databaseId}`;
  }

  return `/s/${spaceSlug}`;
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
