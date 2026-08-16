import type { QueryClient } from "@tanstack/react-query";

const ACCESS_SENSITIVE_SEARCH_QUERY_ROOTS = [
  "unified-search",
  "page-search",
  "search-tag-facets",
  "attachment-search",
  "search-suggestion",
] as const;

export function invalidateAccessSensitiveSearchCaches(
  queryClient: Pick<QueryClient, "invalidateQueries" | "removeQueries">,
) {
  for (const queryRoot of ACCESS_SENSITIVE_SEARCH_QUERY_ROOTS) {
    queryClient.removeQueries({
      queryKey: [queryRoot],
      type: "inactive",
    });
    void queryClient.invalidateQueries({
      queryKey: [queryRoot],
      refetchType: "active",
    });
  }
}

export function handleAccessInvalidation(
  queryClient: Pick<QueryClient, "invalidateQueries" | "removeQueries">,
  options: {
    hasActiveDocument: boolean;
    reload?: () => void;
  },
) {
  invalidateAccessSensitiveSearchCaches(queryClient);
  if (options.hasActiveDocument) {
    (options.reload ?? (() => window.location.reload()))();
  }
}
