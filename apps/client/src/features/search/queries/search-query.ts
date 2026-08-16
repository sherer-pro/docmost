import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  searchAttachments,
  searchLabels,
  searchPage,
  searchShare,
  searchSuggestions,
  searchTagFacets,
} from "@/features/search/services/search-service";
import {
  IAttachmentSearch,
  IPageSearch,
  IPageSearchLabel,
  IPageSearchParams,
  ISuggestionResult,
  SearchLabelParams,
  SearchSuggestionParams,
  ITagSearchFacet,
  SearchTagFacetParams,
} from "@/features/search/types/search.types";

export function hasNonWhitespaceSearchQuery(query: string) {
  return query.trim().length > 0;
}

export function usePageSearchQuery(
  params: IPageSearchParams,
): UseQueryResult<IPageSearch[], Error> {
  return useQuery({
    queryKey: ["page-search", params],
    queryFn: () => searchPage(params),
    enabled:
      hasNonWhitespaceSearchQuery(params.query) ||
      !!params.labelId ||
      !!params.tag ||
      Boolean(params.tags?.length),
  });
}

export function getSearchTagFacetsQueryKey(params: SearchTagFacetParams) {
  return ["search-tag-facets", { spaceId: params.spaceId ?? null }] as const;
}

export function useSearchTagFacetsQuery(
  params: SearchTagFacetParams,
  enabled = true,
): UseQueryResult<ITagSearchFacet[], Error> {
  return useQuery({
    queryKey: getSearchTagFacetsQueryKey(params),
    queryFn: () => searchTagFacets(params),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function getSearchLabelsQueryKey(params: SearchLabelParams) {
  return [
    "search-labels",
    {
      query: params.query ?? "",
      spaceId: params.spaceId ?? null,
      limit: params.limit ?? 25,
    },
  ] as const;
}

export function useSearchLabelsQuery(
  params: SearchLabelParams,
  enabled = true,
): UseQueryResult<IPageSearchLabel[], Error> {
  return useQuery({
    queryKey: getSearchLabelsQueryKey(params),
    queryFn: () => searchLabels(params),
    enabled,
  });
}

export function getSearchSuggestionQueryKey(params: SearchSuggestionParams) {
  return [
    "search-suggestion",
    {
      query: params.query,
      includeUsers: Boolean(params.includeUsers),
      includeGroups: Boolean(params.includeGroups),
      includePages: Boolean(params.includePages),
      spaceId: params.spaceId ?? null,
      limit: params.limit ?? 10,
    },
  ] as const;
}

export function useSearchSuggestionsQuery(
  params: SearchSuggestionParams & { preload?: boolean },
): UseQueryResult<ISuggestionResult, Error> {
  const { preload, ...queryParams } = params;
  return useQuery({
    queryKey: getSearchSuggestionQueryKey(queryParams),
    staleTime: 60 * 1000, // 1min
    queryFn: () => searchSuggestions(queryParams),
    enabled: preload || !!params.query,
  });
}

export function useShareSearchQuery(
  params: IPageSearchParams,
): UseQueryResult<IPageSearch[], Error> {
  return useQuery({
    queryKey: ["share-search", params],
    queryFn: () => searchShare(params),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    enabled: hasNonWhitespaceSearchQuery(params.query),
  });
}

export function useAttachmentSearchQuery(
  params: IPageSearchParams,
): UseQueryResult<IAttachmentSearch[], Error> {
  return useQuery({
    queryKey: ["attachment-search", params],
    queryFn: () => searchAttachments(params),
    enabled: hasNonWhitespaceSearchQuery(params.query),
  });
}
