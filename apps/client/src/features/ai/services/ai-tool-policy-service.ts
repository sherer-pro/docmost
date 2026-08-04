import type {
  AiBuiltinToolSpacePolicyView,
  AiBuiltinToolWorkspacePolicyView,
  UpdateAiBuiltinToolSpacePolicy,
  UpdateAiBuiltinToolWorkspacePolicy,
} from "@docmost/api-contract";
import api, { unwrapApiResponse } from "@/lib/api-client.ts";

export async function getAiBuiltinToolWorkspacePolicy() {
  const response =
    await api.get<AiBuiltinToolWorkspacePolicyView>("/ai/tool-policy");
  return unwrapApiResponse<AiBuiltinToolWorkspacePolicyView>(response);
}

export async function updateAiBuiltinToolWorkspacePolicy(
  data: UpdateAiBuiltinToolWorkspacePolicy,
) {
  const response = await api.patch<AiBuiltinToolWorkspacePolicyView>(
    "/ai/tool-policy",
    data,
  );
  return unwrapApiResponse<AiBuiltinToolWorkspacePolicyView>(response);
}

export async function getAiBuiltinToolSpacePolicy(spaceId: string) {
  const response = await api.get<AiBuiltinToolSpacePolicyView>(
    `/spaces/${spaceId}/ai/tool-policy`,
  );
  return unwrapApiResponse<AiBuiltinToolSpacePolicyView>(response);
}

export async function updateAiBuiltinToolSpacePolicy(
  spaceId: string,
  data: UpdateAiBuiltinToolSpacePolicy,
) {
  const response = await api.put<AiBuiltinToolSpacePolicyView>(
    `/spaces/${spaceId}/ai/tool-policy`,
    data,
  );
  return unwrapApiResponse<AiBuiltinToolSpacePolicyView>(response);
}
