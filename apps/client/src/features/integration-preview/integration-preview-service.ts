import api from "@/lib/api-client";
import type {
  IntegrationPreviewConnection,
  IntegrationPreviewProvider,
  IntegrationPreviewResult,
  IntegrationPreviewSettings,
} from "@docmost/api-contract";

export const getIntegrationPreviewSettings = async () =>
  (await api.get<IntegrationPreviewSettings>("/integration-previews/settings"))
    .data;
export const updateIntegrationPreviewSettings = async (enabled: boolean) =>
  (
    await api.patch<IntegrationPreviewSettings>(
      "/integration-previews/settings",
      { enabled },
    )
  ).data;
export const getIntegrationPreviewConnections = async () =>
  (
    await api.get<IntegrationPreviewConnection[]>(
      "/integration-previews/connections",
    )
  ).data;
export const saveIntegrationPreviewConnection = async (input: {
  provider: IntegrationPreviewProvider;
  credential: string;
}) =>
  (
    await api.put<IntegrationPreviewConnection>(
      `/integration-previews/connections/${input.provider}`,
      { credential: input.credential },
    )
  ).data;
export const removeIntegrationPreviewConnection = async (
  provider: IntegrationPreviewProvider,
) => api.delete(`/integration-previews/connections/${provider}`);
export const resolveIntegrationPreview = async (pageId: string, url: string) =>
  (
    await api.post<IntegrationPreviewResult>(
      "/integration-previews/actions/resolve",
      { pageId, url },
    )
  ).data;
