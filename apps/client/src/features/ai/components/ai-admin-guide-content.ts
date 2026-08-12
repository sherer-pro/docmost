import type { TFunction } from "i18next";
import guideContract from "./ai-admin-guide-contract.json";

export const AI_ADMIN_GUIDE_CONTRACT_VERSION = guideContract.version;

export const AI_ADMIN_GUIDE_ANCHORS =
  guideContract.anchors as unknown as readonly [
    "assistant",
    "retrieval",
    "rag-api",
    "rag-sync",
    "inbound-mcp",
    "outbound-mcp",
    "security",
    "troubleshooting",
  ];

export type AiAdminGuideAnchor = (typeof AI_ADMIN_GUIDE_ANCHORS)[number];

export const AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS: Record<
  AiAdminGuideAnchor,
  string
> = {
  assistant: "ai.title",
  retrieval: "ai.settings.retrievalSection",
  "rag-api": "ai.integrations.ragTitle",
  "rag-sync": "ai.ragSync.title",
  "inbound-mcp": "ai.integrations.mcpTitle",
  "outbound-mcp": "ai.externalTools.title",
  security: "ai.adminGuide.securityTitle",
  troubleshooting: "ai.adminGuide.troubleshootingTitle",
};

export function getAiAdminGuideAnchorFromHash(
  hash: string,
): AiAdminGuideAnchor | null {
  const value = hash.replace(/^#/u, "");
  return AI_ADMIN_GUIDE_ANCHORS.includes(value as AiAdminGuideAnchor)
    ? (value as AiAdminGuideAnchor)
    : null;
}

export type AiAdminGuideScenario = {
  anchor: Exclude<AiAdminGuideAnchor, "security" | "troubleshooting">;
  titleKey: string;
  descriptionKey: string;
  factsKey: string;
  operationsKey: string;
  settingsPath: string;
};

export const AI_ADMIN_GUIDE_SCENARIOS: readonly AiAdminGuideScenario[] = [
  {
    anchor: "assistant",
    titleKey: "ai.title",
    descriptionKey: "ai.adminGuide.assistantDescription",
    factsKey: "ai.adminGuide.scenario.assistant.facts",
    operationsKey: "ai.adminGuide.scenario.assistant.operations",
    settingsPath: "/settings/ai/spaces",
  },
  {
    anchor: "retrieval",
    titleKey: "ai.settings.retrievalSection",
    descriptionKey: "ai.adminGuide.retrievalDescription",
    factsKey: "ai.adminGuide.scenario.retrieval.facts",
    operationsKey: "ai.adminGuide.scenario.retrieval.operations",
    settingsPath: "/settings/ai/spaces",
  },
  {
    anchor: "rag-api",
    titleKey: "ai.integrations.ragTitle",
    descriptionKey: "ai.adminGuide.ragDescription",
    factsKey: "ai.adminGuide.scenario.ragApi.facts",
    operationsKey: "ai.adminGuide.scenario.ragApi.operations",
    settingsPath: "/settings/keys/rag",
  },
  {
    anchor: "rag-sync",
    titleKey: "ai.ragSync.title",
    descriptionKey: "ai.adminGuide.syncDescription",
    factsKey: "ai.adminGuide.scenario.ragSync.facts",
    operationsKey: "ai.adminGuide.scenario.ragSync.operations",
    settingsPath: "/settings/ai/spaces",
  },
  {
    anchor: "inbound-mcp",
    titleKey: "ai.integrations.mcpTitle",
    descriptionKey: "ai.adminGuide.inboundMcpDescription",
    factsKey: "ai.adminGuide.scenario.inboundMcp.facts",
    operationsKey: "ai.adminGuide.scenario.inboundMcp.operations",
    settingsPath: "/settings/keys/mcp",
  },
  {
    anchor: "outbound-mcp",
    titleKey: "ai.externalTools.title",
    descriptionKey: "ai.adminGuide.outboundMcpDescription",
    factsKey: "ai.adminGuide.scenario.outboundMcp.facts",
    operationsKey: "ai.adminGuide.scenario.outboundMcp.operations",
    settingsPath: "/settings/ai/external-tools",
  },
] as const;

export const AI_ADMIN_GUIDE_COPY_VALUES = [
  { kind: "route", value: "/mcp" },
  { kind: "route", value: "/api/rag/*" },
  { kind: "environment", value: "AI_PROVIDER_ALLOWED_ORIGINS" },
  { kind: "environment", value: "AI_RETRIEVAL_ALLOWED_ORIGINS" },
  { kind: "environment", value: "RAG_SYNC_ENABLED" },
  { kind: "environment", value: "RAG_SYNC_ALLOWED_ORIGINS" },
  { kind: "environment", value: "AI_EXTERNAL_MCP_ENABLED" },
  { kind: "environment", value: "AI_MCP_ALLOWED_ORIGINS" },
] as const;

export const AI_ADMIN_GUIDE_SECURITY_ROWS = [
  {
    id: "provider",
    nameKey: "ai.settings.providerSection",
    ownerKey: "ai.adminGuide.securityOwner.spaceAdmin",
    boundaryKey: "ai.adminGuide.operationsSetup",
  },
  {
    id: "retrieval",
    nameKey: "ai.settings.retrievalSection",
    ownerKey: "ai.adminGuide.securityOwner.spaceAdmin",
    boundaryKey: "ai.adminGuide.securitySourceAccess",
  },
  {
    id: "ragApi",
    nameKey: "ai.integrations.ragTitle",
    ownerKey: "ai.adminGuide.securityOwner.workspaceAdmin",
    boundaryKey: "ai.adminGuide.securityInbound",
  },
  {
    id: "ragSync",
    nameKey: "ai.ragSync.title",
    ownerKey: "ai.adminGuide.securityOwner.operatorAndSpaceAdmin",
    boundaryKey: "ai.adminGuide.securitySecrets",
  },
  {
    id: "inboundMcp",
    nameKey: "ai.integrations.mcpTitle",
    ownerKey: "ai.adminGuide.securityOwner.workspaceAdmin",
    boundaryKey: "ai.adminGuide.securityInbound",
  },
  {
    id: "outboundMcp",
    nameKey: "ai.externalTools.title",
    ownerKey: "ai.adminGuide.securityOwner.layered",
    boundaryKey: "ai.adminGuide.securityOutbound",
  },
] as const;

export const AI_ADMIN_GUIDE_TROUBLESHOOTING_ROWS = [
  "401",
  "409",
  "429",
  "503",
  "leaseLost",
  "sourceAccessChanged",
  "cleanupRequired",
  "consentRevoked",
] as const;

export function splitAiAdminGuideFields(
  value: string,
  expectedCount: number,
): string[] {
  const fields = value.split("||").map((item) => item.trim());
  return fields.length === expectedCount && fields.every(Boolean) ? fields : [];
}

export type AiAdminGuideDiagram = {
  source: string;
  labelKey: string;
  captionKey: string;
  textAlternativeKey: string;
};

export function escapeMermaidLabel(value: string): string {
  return value
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/["[\]{}<>]/gu, " ")
    .replace(/\\/gu, "/")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function buildAiAdminGuideDiagrams(
  t: TFunction,
): Record<
  "overview" | "rag" | "inboundMcp" | "outboundMcp",
  AiAdminGuideDiagram
> {
  const label = (key: string) => escapeMermaidLabel(t(key));
  const nodes = (key: string, expectedCount: number) => {
    const values = t(key).split("|").map(escapeMermaidLabel);
    if (values.length !== expectedCount || values.some((value) => !value)) {
      throw new Error(`Invalid AI administrator guide diagram nodes: ${key}`);
    }
    return values;
  };
  const [toolRegistry, externalSystems, remoteMcp] = nodes(
    "ai.adminGuide.diagram.overviewNodes",
    3,
  );
  const [
    chatQuery,
    queryCredential,
    externalIndex,
    externalIndexer,
    liveAcl,
    writerCredential,
    doesNotCall,
  ] = nodes("ai.adminGuide.diagram.ragNodes", 7);
  const [apiKeySettings, liveScope, redisAdmission, contentPolicy] = nodes(
    "ai.adminGuide.diagram.inboundNodes",
    4,
  );
  const [
    deploymentGate,
    workspaceGate,
    spaceBinding,
    groupPolicy,
    userConsent,
    originAllowlists,
    dnsPinnedCall,
  ] = nodes("ai.adminGuide.diagram.outboundNodes", 7);

  return {
    overview: {
      labelKey: "ai.adminGuide.diagram.overview.label",
      captionKey: "ai.adminGuide.diagram.overview.caption",
      textAlternativeKey: "ai.adminGuide.diagram.overview.textAlternative",
      source: `flowchart LR
  UI["${label("ai.adminGuide.setupTitle")}"] --> Assistant["${label("ai.title")}"]
  Assistant --> Retrieval["${label("ai.settings.retrievalSection")}"]
  Assistant --> Registry["${toolRegistry}"]
  Retrieval --> External["${externalSystems}"]
  RagClient["${label("ai.integrations.ragTitle")}"] --> RAG["/api/rag/*"]
  Sync["${label("ai.ragSync.title")}"] --> External
  McpClient["${label("ai.integrations.mcpTitle")}"] --> MCP["/mcp"]
  Agent["${label("ai.externalTools.title")}"] --> Remote["${remoteMcp}"]
  RAG --> PG["PostgreSQL"]
  MCP --> Redis["Redis"]
  MCP --> Registry
  Registry --> PG
  Sync --> Redis
  Sync --> PG`,
    },
    rag: {
      labelKey: "ai.adminGuide.diagram.rag.label",
      captionKey: "ai.adminGuide.diagram.rag.caption",
      textAlternativeKey: "ai.adminGuide.diagram.rag.textAlternative",
      source: `flowchart LR
  Chat["${chatQuery}"] --> QueryKey["${queryCredential}"]
  QueryKey --> Retrieval["${label("ai.settings.retrievalSection")}"]
  Retrieval --> Index["${externalIndex}"]
  Indexer["${externalIndexer}"] --> RAG["/api/rag/*"]
  RAG --> ACL["${liveAcl}"]
  ACL --> PG["PostgreSQL"]
  Sync["${label("ai.ragSync.title")}"] --> WriterKey["${writerCredential}"]
  WriterKey --> Index
  Sync --> ACL
  Sync -. "${doesNotCall}" .-> RAG`,
    },
    inboundMcp: {
      labelKey: "ai.adminGuide.diagram.inboundMcp.label",
      captionKey: "ai.adminGuide.diagram.inboundMcp.caption",
      textAlternativeKey: "ai.adminGuide.diagram.inboundMcp.textAlternative",
      source: `flowchart LR
  KeyUI["${apiKeySettings}"] --> KeyAPI["/api/api-keys"]
  KeyAPI --> KeyService["ApiKeyService"]
  KeyService --> PG["PostgreSQL api_keys"]
  Client["MCP client"] --> MCP["/mcp"]
  MCP --> Guard["McpApiKeyAuthGuard"]
  Guard --> Scope["${liveScope}"]
  Scope --> Admission["${redisAdmission}"]
  Admission --> Registry["${toolRegistry}"]
  Registry --> Policy["${contentPolicy}"]
  Policy --> PG`,
    },
    outboundMcp: {
      labelKey: "ai.adminGuide.diagram.outboundMcp.label",
      captionKey: "ai.adminGuide.diagram.outboundMcp.caption",
      textAlternativeKey: "ai.adminGuide.diagram.outboundMcp.textAlternative",
      source: `flowchart LR
  Agent["Docmost Agent"] --> Deployment["${deploymentGate}"]
  Deployment --> Workspace["${workspaceGate}"]
  Workspace --> Space["${spaceBinding}"]
  Space --> Group["${groupPolicy}"]
  Group --> Consent["${userConsent}"]
  Consent --> Origin["${originAllowlists}"]
  Origin --> DNS["${dnsPinnedCall}"]
  DNS --> Remote["${remoteMcp}"]`,
    },
  };
}
