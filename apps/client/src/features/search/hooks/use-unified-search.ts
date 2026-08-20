import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import {
  searchPage,
  searchAttachments,
  searchDictionary,
} from "@/features/search/services/search-service";
import {
  IAttachmentSearch,
  IDictionarySearch,
  IPageSearch,
  IPageSearchParams,
} from "@/features/search/types/search.types";

export type SearchContentType = "all" | "page" | "attachment" | "dictionary";
export type UnifiedSearchResult =
  | IPageSearch
  | IAttachmentSearch
  | IDictionarySearch;

export interface UseUnifiedSearchParams extends IPageSearchParams {
  contentType?: SearchContentType;
}

export const UNIFIED_SEARCH_PAGE_SIZE = 25;

export const UNIFIED_SEARCH_CACHE_POLICY = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: true,
};

export function getUnifiedSearchNextPageParam(
  lastPageLength: number,
  loadedPageCount: number,
) {
  return lastPageLength === UNIFIED_SEARCH_PAGE_SIZE
    ? loadedPageCount * UNIFIED_SEARCH_PAGE_SIZE
    : undefined;
}

export function getUnifiedSearchType(contentType?: string) {
  return contentType === "attachment" || contentType === "dictionary"
    ? contentType
    : contentType === "all"
      ? "all"
      : "page";
}

export function isUnifiedSearchEnabled(
  params: UseUnifiedSearchParams,
  enabled = true,
) {
  const searchType = getUnifiedSearchType(params.contentType);
  const hasTextQuery = params.query.trim().length > 0;
  const hasLabelFilter = searchType === "page" && Boolean(params.labelId);
  const hasTagFilter = searchType === "page" && Boolean(params.tag);
  const hasTagsFilter = searchType === "page" && Boolean(params.tags?.length);

  return (
    enabled && (hasTextQuery || hasLabelFilter || hasTagFilter || hasTagsFilter)
  );
}

export function getUnifiedSearchBackendParams(
  params: UseUnifiedSearchParams,
  searchType = getUnifiedSearchType(params.contentType),
): IPageSearchParams {
  const { contentType, ...backendParams } = params;

  if (searchType !== "page") {
    const { labelId, tag, tags, ...attachmentParams } = backendParams;
    return attachmentParams;
  }

  return backendParams;
}

export function useUnifiedSearch(
  params: UseUnifiedSearchParams,
  enabled: boolean = true,
) {
  const searchType = getUnifiedSearchType(params.contentType);
  const isAttachmentSearch = searchType === "attachment";
  const isDictionarySearch = searchType === "dictionary";

  return useInfiniteQuery({
    queryKey: ["unified-search", searchType, params],
    ...UNIFIED_SEARCH_CACHE_POLICY,
    queryFn: async ({ pageParam }) => {
      const backendParams = getUnifiedSearchBackendParams(params, searchType);
      const paginatedParams = {
        ...backendParams,
        limit: UNIFIED_SEARCH_PAGE_SIZE,
        offset: pageParam,
      };

      if (isAttachmentSearch) {
        return await searchAttachments(paginatedParams);
      } else if (isDictionarySearch) {
        return await searchDictionary(paginatedParams);
      } else {
        return await searchPage(paginatedParams);
      }
    },
    enabled: isUnifiedSearchEnabled(params, enabled),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      getUnifiedSearchNextPageParam(lastPage.length, allPages.length),
  });
}

export function useAllSearch(
  params: UseUnifiedSearchParams,
  enabled: boolean = true,
) {
  const {
    contentType: _contentType,
    labelId: _labelId,
    tag: _tag,
    tags: _tags,
    ...base
  } = params;
  const request = { ...base, limit: 5, offset: 0 };
  const isEnabled = enabled && request.query.trim().length > 0;
  return useQueries({
    queries: [
      {
        queryKey: ["all-search", "page", request],
        queryFn: () => searchPage(request),
        enabled: isEnabled,
        ...UNIFIED_SEARCH_CACHE_POLICY,
      },
      {
        queryKey: ["all-search", "attachment", request],
        queryFn: () => searchAttachments(request),
        enabled: isEnabled,
        ...UNIFIED_SEARCH_CACHE_POLICY,
      },
      {
        queryKey: ["all-search", "dictionary", request],
        queryFn: () => searchDictionary(request),
        enabled: isEnabled,
        ...UNIFIED_SEARCH_CACHE_POLICY,
      },
    ],
  });
}
