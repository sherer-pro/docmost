/**
 * Bounded capability list resolved when a run is created.
 *
 * Carries no URL, no headers, and no secret. The URL is re-read from the
 * database at connect time, so a snapshot can never hold a stale destination.
 * Widening the policy after a run starts does not change its snapshot; any
 * narrowing is caught by re-verification before each call.
 */
export type AiMcpSnapshotTool = {
  /** Namespaced name offered to the model. */
  name: string;
  remoteName: string;
  /** Administrator-authored. The only text about the tool the model sees. */
  description: string;
  inputSchema: Record<string, unknown>;
  /** Server-only mapping. It is deliberately omitted from model definitions. */
  argumentNameMap?: import('./ai-mcp-tool-schema.util').AiMcpArgumentNameMap;
  schemaFingerprint: string;
};

export type AiMcpSnapshotConnection = {
  serverId: string;
  namespace: string;
  configVersion: number;
  bindingId: string;
  bindingPolicyVersion: number;
  /** Space-administrator hints. Never the remote server's own instructions. */
  instructions: string | null;
  tools: AiMcpSnapshotTool[];
};

export type AiMcpRunSnapshot = {
  schemaVersion: 1;
  profileKey: 'default';
  workspacePolicyVersion: number;
  connections: AiMcpSnapshotConnection[];
};

export type AiMcpResolvedTool = {
  connection: AiMcpSnapshotConnection;
  tool: AiMcpSnapshotTool;
};
