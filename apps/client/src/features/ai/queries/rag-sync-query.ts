import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RagSyncSpaceConfig,
  RagSyncSpaceConfigUpdate,
} from "@docmost/api-contract";
import {
  getRagSyncSpaceConfig,
  runRagSyncAction,
  testRagSyncTarget,
  updateRagSyncSpaceConfig,
  type RagSyncAction,
} from "@/features/ai/services/rag-sync-service.ts";

export const RAG_SYNC_QUERY_KEYS = {
  config: (spaceId: string) => ["ai", "rag-sync", spaceId] as const,
};

export function getRagSyncPollingInterval(config?: RagSyncSpaceConfig) {
  return config?.state === "enabled" || config?.state === "draining"
    ? 10_000
    : 60_000;
}

export function useRagSyncSpaceConfigQuery(spaceId: string) {
  return useQuery({
    queryKey: RAG_SYNC_QUERY_KEYS.config(spaceId),
    queryFn: () => getRagSyncSpaceConfig(spaceId),
    refetchInterval: (query) => getRagSyncPollingInterval(query.state.data),
  });
}

export function useUpdateRagSyncSpaceConfigMutation(spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RagSyncSpaceConfigUpdate) =>
      updateRagSyncSpaceConfig(spaceId, data),
    onSuccess: (config) => {
      queryClient.setQueryData(RAG_SYNC_QUERY_KEYS.config(spaceId), config);
    },
  });
}

export function useTestRagSyncTargetMutation(spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => testRagSyncTarget(spaceId),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: RAG_SYNC_QUERY_KEYS.config(spaceId),
      }),
  });
}

export function useRagSyncActionMutation(spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      expectedVersion,
    }: {
      action: RagSyncAction;
      expectedVersion: number;
    }) => runRagSyncAction(spaceId, action, expectedVersion),
    onSuccess: (config) => {
      queryClient.setQueryData(RAG_SYNC_QUERY_KEYS.config(spaceId), config);
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: RAG_SYNC_QUERY_KEYS.config(spaceId),
      }),
  });
}
