import { queryClient } from "@/lib/query-client.ts";
import { getSpaces } from "@/features/space/services/space-service.ts";
import { getGroups } from "@/features/group/services/group-service.ts";
import { QueryParams } from "@/lib/types.ts";
import { getWorkspaceMembers } from "@/features/workspace/services/workspace-service.ts";
import { getSsoProviders } from "@/features/security/services/security-service.ts";
import { getShares } from "@/features/share/services/share-service.ts";
import { getApiKeys } from "@/features/api-key";

export const prefetchWorkspaceMembers = () => {
  const params: QueryParams = { limit: 100, query: "" };
  queryClient.prefetchQuery({
    queryKey: ["workspaceMembers", params],
    queryFn: () => getWorkspaceMembers(params),
  });
};

export const prefetchSpaces = () => {
  queryClient.prefetchQuery({
    queryKey: ["spaces", {}],
    queryFn: () => getSpaces({}),
  });
};

export const prefetchGroups = () => {
  const params: QueryParams = { limit: 10 };

  queryClient.prefetchQuery({
    queryKey: ["groups", params],
    queryFn: () => getGroups(params),
  });
};

export const prefetchSsoProviders = () => {
  queryClient.prefetchQuery({
    queryKey: ["sso-providers"],
    queryFn: () => getSsoProviders(),
  });
};

export const prefetchShares = () => {
  queryClient.prefetchQuery({
    queryKey: ["share-list", {}],
    queryFn: () => getShares({}),
  });
};

export const prefetchApiKeyManagement = (keyType: "rag" | "mcp") => {
  const params = { adminView: true, keyType } as const;
  queryClient.prefetchQuery({
    queryKey: ["api-key-list", params],
    queryFn: () => getApiKeys(params),
  });
};
