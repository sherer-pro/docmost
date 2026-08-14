import { useQuery } from "@tanstack/react-query";
import { getPageTemplateCapabilities } from "../services/page-template-api";

export const PAGE_TEMPLATE_QUERY_KEYS = {
  capabilities: (spaceId?: string) =>
    ["page-templates", "capabilities", spaceId] as const,
};

export function usePageTemplateCapabilitiesQuery(spaceId?: string) {
  const query = useQuery({
    queryKey: PAGE_TEMPLATE_QUERY_KEYS.capabilities(spaceId),
    queryFn: () => getPageTemplateCapabilities(spaceId!),
    enabled: Boolean(spaceId),
    staleTime: 30_000,
  });
  return query.isError ? { ...query, data: undefined } : query;
}
