import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UpdateAiBuiltinToolSpacePolicy,
  UpdateAiBuiltinToolWorkspacePolicy,
} from "@docmost/api-contract";
import {
  getAiBuiltinToolSpacePolicy,
  getAiBuiltinToolWorkspacePolicy,
  updateAiBuiltinToolSpacePolicy,
  updateAiBuiltinToolWorkspacePolicy,
} from "@/features/ai/services/ai-tool-policy-service.ts";

export const AI_TOOL_POLICY_QUERY_KEYS = {
  workspace: ["ai", "builtin-tool-policy", "workspace"] as const,
  space: (spaceId: string) =>
    ["ai", "builtin-tool-policy", "space", spaceId] as const,
};

export function useAiBuiltinToolWorkspacePolicyQuery() {
  return useQuery({
    queryKey: AI_TOOL_POLICY_QUERY_KEYS.workspace,
    queryFn: getAiBuiltinToolWorkspacePolicy,
  });
}

export function useUpdateAiBuiltinToolWorkspacePolicyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateAiBuiltinToolWorkspacePolicy) =>
      updateAiBuiltinToolWorkspacePolicy(data),
    onSuccess: (policy) => {
      queryClient.setQueryData(AI_TOOL_POLICY_QUERY_KEYS.workspace, policy);
      void queryClient.invalidateQueries({
        queryKey: ["ai", "builtin-tool-policy", "space"],
      });
    },
  });
}

export function useAiBuiltinToolSpacePolicyQuery(spaceId?: string) {
  return useQuery({
    queryKey: AI_TOOL_POLICY_QUERY_KEYS.space(spaceId ?? ""),
    queryFn: () => getAiBuiltinToolSpacePolicy(spaceId!),
    enabled: Boolean(spaceId),
  });
}

export function useUpdateAiBuiltinToolSpacePolicyMutation(spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateAiBuiltinToolSpacePolicy) =>
      updateAiBuiltinToolSpacePolicy(spaceId, data),
    onSuccess: (policy) => {
      queryClient.setQueryData(
        AI_TOOL_POLICY_QUERY_KEYS.space(spaceId),
        policy,
      );
    },
  });
}
