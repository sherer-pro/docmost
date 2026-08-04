/*
 * Outbound external MCP: Docmost acts as the MCP client.
 *
 * Not to be confused with the inbound `/mcp` surface under /settings/keys/mcp,
 * where Docmost is the MCP server. The two share no configuration.
 */
export type {
  AiExternalMcpApprovedTool,
  AiExternalMcpBinding,
  AiExternalMcpBindingsView,
  AiExternalMcpCatalogEntry,
  AiExternalMcpDiscoverResult,
  AiExternalMcpDiscoveredTool,
  AiExternalMcpDiscoverySnapshot,
  AiExternalMcpPreferencesView,
  AiExternalMcpServer,
  AiExternalMcpServerListItem,
  AiExternalMcpSettings,
  AiExternalMcpTestResult,
  AiExternalMcpTestStatus,
  AiExternalMcpToolApprovalInput,
  AiExternalMcpToolSelectionMode,
  AiExternalMcpTransport,
  AiExternalMcpUnavailableReason,
  AiExternalMcpUserPreference,
  CreateAiExternalMcpServerRequest,
  PutAiExternalMcpBindingRequest,
  PutAiExternalMcpPreferencesRequest,
  UpdateAiExternalMcpServerRequest,
  UpdateAiExternalMcpSettingsRequest,
} from "@docmost/api-contract";

export {
  AI_EXTERNAL_MCP_TOOL_SELECTION_MODES,
  AI_EXTERNAL_MCP_TRANSPORTS,
} from "@docmost/api-contract";
