import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPageLabels,
  BacklinkDirection,
  getBacklinks,
  getBacklinksCount,
  getPageLabels,
  removePageLabel,
} from "@/features/page/services/page-service";
import { getPageTemplateProvenance } from "@/features/page-template/services/page-template-api";

export const PAGE_DETAILS_QUERY_KEYS = {
  labels: (pageId?: string) => ["page-details", "labels", pageId] as const,
  backlinksCount: (pageId?: string) =>
    ["page-details", "backlinks-count", pageId] as const,
  backlinks: (pageId?: string, direction?: BacklinkDirection) =>
    ["page-details", "backlinks", pageId, direction] as const,
  templateProvenance: (pageId?: string) =>
    ["page-details", "template-provenance", pageId] as const,
};

export function usePageLabelsQuery(pageId?: string, enabled = true) {
  return useQuery({
    queryKey: PAGE_DETAILS_QUERY_KEYS.labels(pageId),
    queryFn: () => getPageLabels(pageId!),
    enabled: enabled && !!pageId,
  });
}

export function useAddPageLabelsMutation(pageId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (names: string[]) => addPageLabels({ pageId: pageId!, names }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: PAGE_DETAILS_QUERY_KEYS.labels(pageId),
      });
      queryClient.invalidateQueries({ queryKey: ["search-labels"] });
    },
  });
}

export function useRemovePageLabelMutation(pageId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (labelId: string) =>
      removePageLabel({ pageId: pageId!, labelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: PAGE_DETAILS_QUERY_KEYS.labels(pageId),
      });
      queryClient.invalidateQueries({ queryKey: ["search-labels"] });
    },
  });
}

export function useBacklinksCountQuery(pageId?: string, enabled = true) {
  return useQuery({
    queryKey: PAGE_DETAILS_QUERY_KEYS.backlinksCount(pageId),
    queryFn: () => getBacklinksCount(pageId!),
    enabled: enabled && !!pageId,
  });
}

export function useBacklinksQuery(
  pageId?: string,
  direction: BacklinkDirection = "incoming",
  enabled = true,
) {
  return useQuery({
    queryKey: PAGE_DETAILS_QUERY_KEYS.backlinks(pageId, direction),
    queryFn: () => getBacklinks({ pageId: pageId!, direction }),
    enabled: enabled && !!pageId,
  });
}

export function usePageTemplateProvenanceQuery(
  pageId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: PAGE_DETAILS_QUERY_KEYS.templateProvenance(pageId),
    queryFn: () => getPageTemplateProvenance(pageId!),
    enabled: enabled && !!pageId,
  });
}
