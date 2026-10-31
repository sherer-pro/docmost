import api from "@/lib/api-client";
import type {
  McpOAuthConsent,
  McpOAuthConnection,
} from "@docmost/api-contract";

export const getMcpOAuthConsent = async (requestId: string) =>
  (
    await api.get<McpOAuthConsent>("/mcp-oauth/account/consent", {
      params: { requestId },
    })
  ).data;
export const decideMcpOAuthConsent = async (input: {
  requestId: string;
  allow: boolean;
  spaceId?: string;
}) =>
  (await api.post<{ redirectUri: string }>("/mcp-oauth/account/consent", input))
    .data;
export const getMcpOAuthConnections = async () =>
  (await api.get<McpOAuthConnection[]>("/mcp-oauth/account/connections")).data;
export const disconnectMcpOAuth = async (id: string) =>
  api.post("/mcp-oauth/account/disconnect", { id });
export const getMcpOAuthSettings = async () =>
  (await api.get<{ enabled: boolean }>("/mcp-oauth/account/settings")).data;
export const updateMcpOAuthSettings = async (enabled: boolean) =>
  (
    await api.patch<{ enabled: boolean }>("/mcp-oauth/account/settings", {
      enabled,
    })
  ).data;
