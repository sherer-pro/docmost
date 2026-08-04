import type { AiErrorCode, AiToolWriteClass } from "./ai";

/*
 * Outbound external MCP servers.
 *
 * Docmost is the MCP *client* here. This is the opposite direction from the
 * inbound `/mcp` endpoint, which exposes Docmost as an MCP server to external
 * assistants. The two surfaces share no configuration and no credentials.
 *
 * Invariant for this whole file: no type below carries an HTTP header value.
 * Header values appear only on the write-only request types, which are never
 * used as response types.
 */

export const AI_EXTERNAL_MCP_TRANSPORTS = ["streamable-http"] as const;
export type AiExternalMcpTransport =
  (typeof AI_EXTERNAL_MCP_TRANSPORTS)[number];

export const AI_EXTERNAL_MCP_TEST_STATUSES = [
  "untested",
  "passed",
  "failed",
] as const;
export type AiExternalMcpTestStatus =
  (typeof AI_EXTERNAL_MCP_TEST_STATUSES)[number];

export const AI_EXTERNAL_MCP_TOOL_SELECTION_MODES = [
  "all",
  "selected",
] as const;
export type AiExternalMcpToolSelectionMode =
  (typeof AI_EXTERNAL_MCP_TOOL_SELECTION_MODES)[number];

export const AI_EXTERNAL_MCP_UNAVAILABLE_REASONS = [
  "deployment",
  "workspace",
  "server",
  "binding",
  "group",
] as const;
export type AiExternalMcpUnavailableReason =
  (typeof AI_EXTERNAL_MCP_UNAVAILABLE_REASONS)[number];

export interface AiExternalMcpSettings {
  /** Deployment kill switch (AI_EXTERNAL_MCP_ENABLED). Read-only here. */
  deploymentEnabled: boolean;
  /** Workspace master switch. */
  enabled: boolean;
  /**
   * Origins allowed by the deployment (AI_MCP_ALLOWED_ORIGINS). Read-only: a
   * workspace administrator can narrow this list but never widen it.
   */
  deploymentAllowedOrigins: string[];
  /** Workspace allowlist. An origin must appear in both lists to be usable. */
  allowedOrigins: string[];
  policyVersion: number;
  updatedAt: string | null;
}

export interface UpdateAiExternalMcpSettingsRequest {
  enabled?: boolean;
  allowedOrigins?: string[];
}

/**
 * Remote-authored and UNTRUSTED. Every string here is display-only. None of it
 * may reach the model, be rendered as markdown or HTML, or become a tool label.
 */
export interface AiExternalMcpDiscoveredTool {
  remoteName: string;
  /** The namespaced name this tool would receive once approved. */
  toolName: string;
  /**
   * Whether the remote server shipped prose for this tool. The prose itself is
   * kept out of storage; only its presence is recorded.
   */
  remoteTitlePresent: boolean;
  remoteDescriptionPresent: boolean;
  /** Remote hints. Never used to decide the read/write class. */
  remoteAnnotations: {
    readOnlyHint: boolean | null;
    destructiveHint: boolean | null;
    idempotentHint: boolean | null;
    openWorldHint: boolean | null;
  } | null;
  /** Derived from the sanitized schema, not from the raw remote one. */
  inputSchemaSummary: {
    propertyNames: string[];
    requiredNames: string[];
    truncated: boolean;
  } | null;
  /** False when the schema could not be sanitized safely. */
  approvable: boolean;
  approved: boolean;
  changedSinceApproval: boolean;
}

export interface AiExternalMcpDiscoverySnapshot {
  discoveredAt: string;
  toolCount: number;
  tools: AiExternalMcpDiscoveredTool[];
}

/**
 * A workspace-approved tool. `description` is written by the administrator and
 * is the only text about this tool the model ever sees.
 *
 * `writeClass` is the literal "read_only", which makes an external write tool
 * unrepresentable at compile time in version 1.
 */
export interface AiExternalMcpApprovedTool {
  toolName: string;
  remoteName: string;
  description: string;
  writeClass: Extract<AiToolWriteClass, "read_only">;
  approvedAt: string;
  approvedByUserId: string | null;
  schemaFingerprint: string;
  changedSinceApproval: boolean;
}

/** Workspace-admin catalog row. Carries no secret and no header value. */
export interface AiExternalMcpServerListItem {
  id: string;
  name: string;
  /** Immutable after creation. */
  namespace: string;
  url: string;
  transport: AiExternalMcpTransport;
  enabled: boolean;
  /** Whether headers are stored. Never a value, never a length. */
  headersConfigured: boolean;
  approvedToolCount: number;
  discoveredToolCount: number;
  boundSpaceCount: number;
  testStatus: AiExternalMcpTestStatus;
  testErrorCode: AiErrorCode | null;
  testCheckedAt: string | null;
  discoveredAt: string | null;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Workspace-admin detail. Adds header NAMES, never values. */
export interface AiExternalMcpServer extends AiExternalMcpServerListItem {
  headerNames: string[];
  approvedTools: AiExternalMcpApprovedTool[];
  discovery: AiExternalMcpDiscoverySnapshot | null;
}

/**
 * Space-admin and space-member projection. Deliberately omits
 * `headersConfigured`, `headerNames`, test metadata, and bound-space counts.
 */
export interface AiExternalMcpCatalogEntry {
  serverId: string;
  name: string;
  namespace: string;
  /** Kept: informed consent needs the outbound destination. */
  url: string;
  approvedTools: AiExternalMcpApprovedTool[];
}

export interface CreateAiExternalMcpServerRequest {
  name: string;
  namespace: string;
  url: string;
  transport?: AiExternalMcpTransport;
  /** WRITE-ONLY. Never returned by any endpoint. */
  headers?: Record<string, string>;
}

export interface AiExternalMcpToolApprovalInput {
  remoteName: string;
  approved: boolean;
  /** Required when `approved` is true. */
  description?: string;
}

/**
 * `namespace` is absent on purpose: immutability is enforced by the type rather
 * than by a runtime check.
 */
export interface UpdateAiExternalMcpServerRequest {
  name?: string;
  url?: string;
  enabled?: boolean;
  /** WRITE-ONLY. Omitting this field keeps the stored headers. */
  headers?: Record<string, string>;
  /** Deletes the stored headers. Sending both fields is rejected. */
  clearHeaders?: boolean;
  /** Full replacement of the approved set. */
  tools?: AiExternalMcpToolApprovalInput[];
}

export interface AiExternalMcpTestResult {
  status: AiExternalMcpTestStatus;
  latencyMs: number;
  protocolVersion: string | null;
  /** Remote-reported, untrusted, display-only. */
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number | null;
  errorCode: AiErrorCode | null;
}

export interface AiExternalMcpDiscoverResult {
  snapshot: AiExternalMcpDiscoverySnapshot | null;
  latencyMs: number;
  errorCode: AiErrorCode | null;
}

export interface AiExternalMcpBinding {
  serverId: string;
  serverName: string;
  namespace: string;
  url: string;
  spaceId: string;
  enabled: boolean;
  /** Catalog state, read-only from a space. */
  serverEnabled: boolean;
  toolSelection: AiExternalMcpToolSelectionMode;
  /** Meaningful when `toolSelection` is "selected". */
  toolNames: string[];
  availableTools: AiExternalMcpApprovedTool[];
  instructions: string | null;
  deniedByGroup: boolean;
  policyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiExternalMcpBindingsView {
  spaceId: string;
  deploymentEnabled: boolean;
  workspaceEnabled: boolean;
  bindings: AiExternalMcpBinding[];
  /** Enabled catalog servers not yet bound to this space. */
  catalog: AiExternalMcpCatalogEntry[];
}

export interface PutAiExternalMcpBindingRequest {
  enabled: boolean;
  toolSelection?: AiExternalMcpToolSelectionMode;
  toolNames?: string[];
  instructions?: string | null;
}

export interface AiExternalMcpUserPreference {
  serverId: string;
  serverName: string;
  namespace: string;
  /** Shown in the outbound-data consent warning. */
  url: string;
  /** Effective tools for this binding after every narrowing is applied. */
  toolNames: string[];
  /**
   * A missing stored row is normalized to `false` on the server, so the client
   * can never read an absent preference as opted in.
   */
  optedIn: boolean;
  /** True when every gate except the user's opt-in is satisfied. */
  available: boolean;
  unavailableReason: AiExternalMcpUnavailableReason | null;
}

export interface AiExternalMcpPreferencesView {
  spaceId: string;
  available: boolean;
  items: AiExternalMcpUserPreference[];
}

export interface PutAiExternalMcpPreferencesRequest {
  items: Array<{ serverId: string; optedIn: boolean }>;
}
