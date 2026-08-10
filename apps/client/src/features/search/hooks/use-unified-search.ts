import { useInfiniteQuery } from "@tanstack/react-query";
import {
  searchPage,
  searchAttachments,
} from "@/features/search/services/search-service";
import {
  IAttachmentSearch,
  IPageSearch,
  IPageSearchParams,
} from "@/features/search/types/search.types";

export type UnifiedSearchResult = IPageSearch | IAttachmentSearch;

export interface UseUnifiedSearchParams extends IPageSearchParams {
  contentType?: string;
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
  return contentType === "attachment" ? "attachment" : "page";
}

export function isUnifiedSearchEnabled(
  params: UseUnifiedSearchParams,
  enabled = true,
) {
  const searchType = getUnifiedSearchType(params.contentType);
  const hasTextQuery = params.query.trim().length > 0;
  const hasLabelFilter = searchType === "page" && Boolean(params.labelId);
  const hasTagFilter = searchType === "page" && Boolean(params.tag);

  return enabled && (hasTextQuery || hasLabelFilter || hasTagFilter);
}

export function getUnifiedSearchBackendParams(
  params: UseUnifiedSearchParams,
  searchType = getUnifiedSearchType(params.contentType),
): IPageSearchParams {
  const { contentType, ...backendParams } = params;

  if (searchType === "attachment") {
    const { labelId, tag, ...attachmentParams } = backendParams;
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
