export const AI_BUILTIN_TOOL_CAPABILITIES = [
  "search.query",
  "page.tree.read",
  "page.context.read",
  "page.content.read",
  "page.outline.read",
  "page.node.read",
  "page.text.search",
  "page.text.propose",
  "page.node.patch.propose",
  "page.node.insert.propose",
  "page.node.delete.propose",
  "workspace.context.read",
  "space.context.read",
  "database.context.read",
  "database.rows.read",
  "database.row_context.read",
  "page.table.read",
  "page.comments.read",
  "page.history.list",
  "page.history.diff",
  "page.transclusion_references.read",
  "page.attachments.metadata.read",
  "page.public_share.read",
  "page.templates.list",
  "page.template.metadata.read",
  "page.template.usages.read",
] as const;

export type AiBuiltinToolCapability =
  (typeof AI_BUILTIN_TOOL_CAPABILITIES)[number];

export const AI_LEGACY_AGENT_CAPABILITIES: AiBuiltinToolCapability[] = [
  "search.query",
  "page.tree.read",
  "page.context.read",
  "page.content.read",
  "page.outline.read",
  "page.node.read",
  "page.text.search",
  "page.text.propose",
  "page.node.patch.propose",
  "page.node.insert.propose",
  "page.node.delete.propose",
];

export const AI_LEGACY_MCP_CAPABILITIES: AiBuiltinToolCapability[] = [
  "search.query",
  "page.tree.read",
  "page.context.read",
  "page.content.read",
  "page.outline.read",
  "page.node.read",
  "page.text.search",
];

export const AI_BUILTIN_TOOL_CATEGORIES = [
  "search",
  "page_read",
  "page_write",
  "context",
  "database",
  "page_structure",
  "collaboration",
  "history",
  "attachments",
  "sharing",
] as const;

export type AiBuiltinToolCategory = (typeof AI_BUILTIN_TOOL_CATEGORIES)[number];

export type AiBuiltinToolTargetScope =
  | "workspace"
  | "current_space"
  | "readable_page"
  | "current_page";

export type AiBuiltinToolApprovalMode = "none" | "current_page_hash";

export interface AiBuiltinToolAnnotations {
  idempotent: boolean;
  destructive: boolean;
  openWorld: boolean;
}

export interface AiBuiltinToolCatalogEntry {
  name: string;
  capability: AiBuiltinToolCapability;
  category: AiBuiltinToolCategory;
  targetScope: AiBuiltinToolTargetScope;
  approvalMode: AiBuiltinToolApprovalMode;
  maxResultBytes: number;
  writeClass: "read_only" | "write";
  exposures: Array<"agent" | "mcp">;
  annotations: AiBuiltinToolAnnotations;
}

export interface AiBuiltinToolWorkspacePolicyView {
  enabled: boolean;
  allowedCapabilities: AiBuiltinToolCapability[];
  maximumCapabilities: AiBuiltinToolCapability[];
  effectiveCapabilities: AiBuiltinToolCapability[];
  policyVersion: number;
  catalog: AiBuiltinToolCatalogEntry[];
}

export interface AiBuiltinToolSpacePolicyView {
  spaceId: string;
  inherited: boolean;
  allowedCapabilities: AiBuiltinToolCapability[] | null;
  workspaceAllowedCapabilities: AiBuiltinToolCapability[];
  effectiveCapabilities: AiBuiltinToolCapability[];
  workspacePolicyVersion: number;
  spacePolicyVersion: number;
  catalog: AiBuiltinToolCatalogEntry[];
}

export interface UpdateAiBuiltinToolWorkspacePolicy {
  enabled: boolean;
  allowedCapabilities: AiBuiltinToolCapability[];
}

export interface UpdateAiBuiltinToolSpacePolicy {
  allowedCapabilities: AiBuiltinToolCapability[] | null;
}
