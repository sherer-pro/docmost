import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AiExternalMcpBindingsView,
  AiExternalMcpDiscoverResult,
  AiExternalMcpPreferencesView,
  AiExternalMcpServer,
  AiExternalMcpServerListItem,
  AiExternalMcpSettings,
  AiExternalMcpTestResult,
  CreateAiExternalMcpServerRequest,
  PutAiExternalMcpBindingRequest,
  PutAiExternalMcpPreferencesRequest,
  UpdateAiExternalMcpServerRequest,
  UpdateAiExternalMcpSettingsRequest,
} from "@/features/ai-external-mcp/types/ai-external-mcp.types.ts";
import {
  createAiExternalMcpServer,
  deleteAiExternalMcpBinding,
  deleteAiExternalMcpServer,
  discoverAiExternalMcpServer,
  getAiExternalMcpBindings,
  getAiExternalMcpPreferences,
  getAiExternalMcpServer,
  getAiExternalMcpServers,
  getAiExternalMcpSettings,
  putAiExternalMcpBinding,
  putAiExternalMcpPreferences,
  testAiExternalMcpServer,
  updateAiExternalMcpServer,
  updateAiExternalMcpSettings,
} from "@/features/ai-external-mcp/services/ai-external-mcp-service.ts";

/**
 * Namespaced under ["ai", ...] so the existing socket-reconnect invalidation of
 * the "ai" prefix refreshes these too.
 */
export const AI_EXTERNAL_MCP_QUERY_KEYS = {
  settings: () => ["ai", "external-mcp", "settings"] as const,
  servers: () => ["ai", "external-mcp", "servers"] as const,
  server: (serverId: string) =>
    ["ai", "external-mcp", "server", serverId] as const,
  bindings: (spaceId: string) =>
    ["ai", "external-mcp", "bindings", spaceId] as const,
  preferences: (spaceId: string) =>
    ["ai", "external-mcp", "preferences", spaceId] as const,
};

export function useAiExternalMcpSettingsQuery(
  enabled = true,
): UseQueryResult<AiExternalMcpSettings, Error> {
  return useQuery({
    queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.settings(),
    queryFn: getAiExternalMcpSettings,
    enabled,
  });
}

export function useUpdateAiExternalMcpSettingsMutation(): UseMutationResult<
  AiExternalMcpSettings,
  Error,
  UpdateAiExternalMcpSettingsRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAiExternalMcpSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(
        AI_EXTERNAL_MCP_QUERY_KEYS.settings(),
        settings,
      );
      // The master switch changes what every server row may do.
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.servers(),
      });
    },
  });
}

export function useAiExternalMcpServersQuery(
  enabled = true,
): UseQueryResult<AiExternalMcpServerListItem[], Error> {
  return useQuery({
    queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.servers(),
    queryFn: getAiExternalMcpServers,
    enabled,
  });
}

export function useAiExternalMcpServerQuery(
  serverId: string | null,
): UseQueryResult<AiExternalMcpServer, Error> {
  return useQuery({
    queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.server(serverId ?? ""),
    queryFn: () => getAiExternalMcpServer(serverId as string),
    enabled: Boolean(serverId),
  });
}

export function useCreateAiExternalMcpServerMutation(): UseMutationResult<
  AiExternalMcpServer,
  Error,
  CreateAiExternalMcpServerRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAiExternalMcpServer,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.servers(),
      });
    },
  });
}

export function useUpdateAiExternalMcpServerMutation(): UseMutationResult<
  AiExternalMcpServer,
  Error,
  { serverId: string; data: UpdateAiExternalMcpServerRequest }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ serverId, data }) =>
      updateAiExternalMcpServer(serverId, data),
    onSuccess: (server) => {
      queryClient.setQueryData(
        AI_EXTERNAL_MCP_QUERY_KEYS.server(server.id),
        server,
      );
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.servers(),
      });
    },
  });
}

export function useDeleteAiExternalMcpServerMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAiExternalMcpServer,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.servers(),
      });
    },
  });
}

/** Not cached: a test is a point-in-time probe, and the result is shown inline. */
export function useTestAiExternalMcpServerMutation(): UseMutationResult<
  AiExternalMcpTestResult,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: testAiExternalMcpServer,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.servers(),
      });
    },
  });
}

export function useDiscoverAiExternalMcpServerMutation(): UseMutationResult<
  AiExternalMcpDiscoverResult,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: discoverAiExternalMcpServer,
    onSuccess: (_result, serverId) => {
      // Discovery can drop approvals, so both the row and the detail change.
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.server(serverId),
      });
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.servers(),
      });
    },
  });
}

export function useAiExternalMcpBindingsQuery(
  spaceId: string | null,
): UseQueryResult<AiExternalMcpBindingsView, Error> {
  return useQuery({
    queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.bindings(spaceId ?? ""),
    queryFn: () => getAiExternalMcpBindings(spaceId as string),
    enabled: Boolean(spaceId),
  });
}

export function usePutAiExternalMcpBindingMutation(
  spaceId: string,
): UseMutationResult<
  AiExternalMcpBindingsView,
  Error,
  { serverId: string; data: PutAiExternalMcpBindingRequest }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ serverId, data }) =>
      putAiExternalMcpBinding(spaceId, serverId, data),
    onSuccess: (view) => {
      queryClient.setQueryData(
        AI_EXTERNAL_MCP_QUERY_KEYS.bindings(spaceId),
        view,
      );
      // A binding change alters which servers a user may opt into.
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.preferences(spaceId),
      });
    },
  });
}

export function useDeleteAiExternalMcpBindingMutation(
  spaceId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) =>
      deleteAiExternalMcpBinding(spaceId, serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.bindings(spaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.preferences(spaceId),
      });
    },
  });
}

export function useAiExternalMcpPreferencesQuery(
  spaceId: string | null,
  enabled = true,
): UseQueryResult<AiExternalMcpPreferencesView, Error> {
  return useQuery({
    queryKey: AI_EXTERNAL_MCP_QUERY_KEYS.preferences(spaceId ?? ""),
    queryFn: () => getAiExternalMcpPreferences(spaceId as string),
    enabled: Boolean(spaceId) && enabled,
  });
}

export function usePutAiExternalMcpPreferencesMutation(
  spaceId: string,
): UseMutationResult<
  AiExternalMcpPreferencesView,
  Error,
  PutAiExternalMcpPreferencesRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => putAiExternalMcpPreferences(spaceId, data),
    onSuccess: (view) => {
      queryClient.setQueryData(
        AI_EXTERNAL_MCP_QUERY_KEYS.preferences(spaceId),
        view,
      );
    },
  });
}
