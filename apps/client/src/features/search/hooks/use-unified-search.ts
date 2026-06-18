import { useQuery, UseQueryResult } from "@tanstack/react-query";
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

  return enabled && (hasTextQuery || hasLabelFilter);
}

export function getUnifiedSearchBackendParams(
  params: UseUnifiedSearchParams,
  searchType = getUnifiedSearchType(params.contentType),
): IPageSearchParams {
  const { contentType, ...backendParams } = params;

  if (searchType === "attachment") {
    const { labelId, ...attachmentParams } = backendParams;
    return attachmentParams;
  }

  return backendParams;
}

export function useUnifiedSearch(
  params: UseUnifiedSearchParams,
  enabled: boolean = true,
): UseQueryResult<UnifiedSearchResult[], Error> {
  const searchType = getUnifiedSearchType(params.contentType);
  const isAttachmentSearch = searchType === "attachment";

  return useQuery({
    queryKey: ["unified-search", searchType, params],
    queryFn: async () => {
      const backendParams = getUnifiedSearchBackendParams(params, searchType);

      if (isAttachmentSearch) {
        return await searchAttachments(backendParams);
      } else {
        return await searchPage(backendParams);
      }
    },
    enabled: isUnifiedSearchEnabled(params, enabled),
  });
}
