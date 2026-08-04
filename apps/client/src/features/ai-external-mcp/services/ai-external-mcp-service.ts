import api, { unwrapApiResponse } from "@/lib/api-client.ts";
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

export async function getAiExternalMcpSettings(): Promise<AiExternalMcpSettings> {
  const response = await api.get<AiExternalMcpSettings>("/ai/mcp-settings");
  return unwrapApiResponse<AiExternalMcpSettings>(response);
}

export async function updateAiExternalMcpSettings(
  data: UpdateAiExternalMcpSettingsRequest,
): Promise<AiExternalMcpSettings> {
  const response = await api.patch<AiExternalMcpSettings>(
    "/ai/mcp-settings",
    data,
  );
  return unwrapApiResponse<AiExternalMcpSettings>(response);
}

export async function getAiExternalMcpServers(): Promise<
  AiExternalMcpServerListItem[]
> {
  const response = await api.get<{ items: AiExternalMcpServerListItem[] }>(
    "/ai/mcp-servers",
  );
  return unwrapApiResponse<{ items: AiExternalMcpServerListItem[] }>(response)
    .items;
}

export async function createAiExternalMcpServer(
  data: CreateAiExternalMcpServerRequest,
): Promise<AiExternalMcpServer> {
  const response = await api.post<AiExternalMcpServer>("/ai/mcp-servers", data);
  return unwrapApiResponse<AiExternalMcpServer>(response);
}

export async function getAiExternalMcpServer(
  serverId: string,
): Promise<AiExternalMcpServer> {
  const response = await api.get<AiExternalMcpServer>(
    `/ai/mcp-servers/${serverId}`,
  );
  return unwrapApiResponse<AiExternalMcpServer>(response);
}

export async function updateAiExternalMcpServer(
  serverId: string,
  data: UpdateAiExternalMcpServerRequest,
): Promise<AiExternalMcpServer> {
  const response = await api.patch<AiExternalMcpServer>(
    `/ai/mcp-servers/${serverId}`,
    data,
  );
  return unwrapApiResponse<AiExternalMcpServer>(response);
}

export async function deleteAiExternalMcpServer(
  serverId: string,
): Promise<void> {
  await api.delete(`/ai/mcp-servers/${serverId}`);
}

export async function testAiExternalMcpServer(
  serverId: string,
): Promise<AiExternalMcpTestResult> {
  const response = await api.post<AiExternalMcpTestResult>(
    `/ai/mcp-servers/${serverId}/actions/test`,
  );
  return unwrapApiResponse<AiExternalMcpTestResult>(response);
}

export async function discoverAiExternalMcpServer(
  serverId: string,
): Promise<AiExternalMcpDiscoverResult> {
  const response = await api.post<AiExternalMcpDiscoverResult>(
    `/ai/mcp-servers/${serverId}/actions/discover`,
  );
  return unwrapApiResponse<AiExternalMcpDiscoverResult>(response);
}

export async function getAiExternalMcpBindings(
  spaceId: string,
): Promise<AiExternalMcpBindingsView> {
  const response = await api.get<AiExternalMcpBindingsView>(
    `/spaces/${spaceId}/ai/mcp-bindings`,
  );
  return unwrapApiResponse<AiExternalMcpBindingsView>(response);
}

export async function putAiExternalMcpBinding(
  spaceId: string,
  serverId: string,
  data: PutAiExternalMcpBindingRequest,
): Promise<AiExternalMcpBindingsView> {
  const response = await api.put<AiExternalMcpBindingsView>(
    `/spaces/${spaceId}/ai/mcp-bindings/${serverId}`,
    data,
  );
  return unwrapApiResponse<AiExternalMcpBindingsView>(response);
}

export async function deleteAiExternalMcpBinding(
  spaceId: string,
  serverId: string,
): Promise<void> {
  await api.delete(`/spaces/${spaceId}/ai/mcp-bindings/${serverId}`);
}

export async function getAiExternalMcpPreferences(
  spaceId: string,
): Promise<AiExternalMcpPreferencesView> {
  const response = await api.get<AiExternalMcpPreferencesView>(
    `/spaces/${spaceId}/ai/mcp-preferences`,
  );
  return unwrapApiResponse<AiExternalMcpPreferencesView>(response);
}

export async function putAiExternalMcpPreferences(
  spaceId: string,
  data: PutAiExternalMcpPreferencesRequest,
): Promise<AiExternalMcpPreferencesView> {
  const response = await api.put<AiExternalMcpPreferencesView>(
    `/spaces/${spaceId}/ai/mcp-preferences`,
    data,
  );
  return unwrapApiResponse<AiExternalMcpPreferencesView>(response);
}
