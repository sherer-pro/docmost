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
export type AiAdminGuidePanel = "overview" | AiAdminGuideAnchor;
type AiAdminGuideScenarioAnchor = Exclude<
  AiAdminGuideAnchor,
  "security" | "troubleshooting"
>;

export const AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS: Record<
  AiAdminGuidePanel,
  string
> = {
  overview: "ai.adminGuide.navigation.overview",
  assistant: "ai.title",
  retrieval: "ai.settings.retrievalSection",
  "rag-api": "ai.integrations.ragTitle",
  "rag-sync": "ai.ragSync.title",
  "inbound-mcp": "ai.integrations.mcpTitle",
  "outbound-mcp": "ai.externalTools.title",
  security: "ai.adminGuide.security.title",
  troubleshooting: "ai.adminGuide.troubleshooting.title",
};

export const AI_ADMIN_GUIDE_NAVIGATION_GROUPS = [
  {
    labelKey: "ai.adminGuide.navigation.groups.docmost",
    panels: ["assistant", "retrieval"],
  },
  {
    labelKey: "ai.adminGuide.navigation.groups.data",
    panels: ["rag-api", "rag-sync"],
  },
  {
    labelKey: "ai.adminGuide.navigation.groups.mcp",
    panels: ["inbound-mcp", "outbound-mcp"],
  },
  {
    labelKey: "ai.adminGuide.navigation.groups.support",
    panels: ["security", "troubleshooting"],
  },
] as const satisfies readonly {
  labelKey: string;
  panels: readonly AiAdminGuidePanel[];
}[];

export function getAiAdminGuideAnchorFromHash(
  hash: string,
): AiAdminGuideAnchor | null {
  const value = hash.replace(/^#/u, "");
  return AI_ADMIN_GUIDE_ANCHORS.includes(value as AiAdminGuideAnchor)
    ? (value as AiAdminGuideAnchor)
    : null;
}

export function getAiAdminGuidePanelFromHash(hash: string): AiAdminGuidePanel {
  return getAiAdminGuideAnchorFromHash(hash) ?? "overview";
}

export type AiAdminGuideCopyValue = {
  kind: "route" | "environment";
  value: string;
};

export type AiAdminGuideScenario = {
  anchor: AiAdminGuideScenarioAnchor;
  titleKey: string;
  contentKey: string;
  settingsPath: string;
  diagram: "rag" | "mcp" | null;
  controls: readonly AiAdminGuideCopyValue[];
  stepKeys?: readonly string[];
};

export const AI_ADMIN_GUIDE_SCENARIOS: readonly AiAdminGuideScenario[] = [
  {
    anchor: "assistant",
    titleKey: "ai.title",
    contentKey: "ai.adminGuide.scenario.assistant",
    settingsPath: "/settings/ai/spaces",
    diagram: null,
    controls: [{ kind: "environment", value: "AI_PROVIDER_ALLOWED_ORIGINS" }],
    stepKeys: ["step1", "step2", "step3", "step4"],
  },
  {
    anchor: "retrieval",
    titleKey: "ai.settings.retrievalSection",
    contentKey: "ai.adminGuide.scenario.retrieval",
    settingsPath: "/settings/ai/spaces",
    diagram: "rag",
    controls: [{ kind: "environment", value: "AI_RETRIEVAL_ALLOWED_ORIGINS" }],
  },
  {
    anchor: "rag-api",
    titleKey: "ai.integrations.ragTitle",
    contentKey: "ai.adminGuide.scenario.ragApi",
    settingsPath: "/settings/keys/rag",
    diagram: "rag",
    controls: [{ kind: "route", value: "/api/rag/*" }],
  },
  {
    anchor: "rag-sync",
    titleKey: "ai.ragSync.title",
    contentKey: "ai.adminGuide.scenario.ragSync",
    settingsPath: "/settings/ai/spaces",
    diagram: "rag",
    controls: [
      { kind: "environment", value: "RAG_SYNC_ENABLED" },
      { kind: "environment", value: "RAG_SYNC_ALLOWED_ORIGINS" },
    ],
  },
  {
    anchor: "inbound-mcp",
    titleKey: "ai.integrations.mcpTitle",
    contentKey: "ai.adminGuide.scenario.inboundMcp",
    settingsPath: "/settings/keys/mcp",
    diagram: "mcp",
    controls: [{ kind: "route", value: "/mcp" }],
  },
  {
    anchor: "outbound-mcp",
    titleKey: "ai.externalTools.title",
    contentKey: "ai.adminGuide.scenario.outboundMcp",
    settingsPath: "/settings/ai/external-tools",
    diagram: "mcp",
    controls: [
      { kind: "environment", value: "AI_EXTERNAL_MCP_ENABLED" },
      { kind: "environment", value: "AI_MCP_ALLOWED_ORIGINS" },
    ],
  },
] as const;

export const AI_ADMIN_GUIDE_SECURITY_ROWS = [
  {
    id: "provider",
    nameKey: "ai.settings.providerSection",
    ownerKey: "ai.adminGuide.security.owners.spaceAdmin",
    boundaryKey: "ai.adminGuide.security.boundaries.provider",
  },
  {
    id: "retrieval",
    nameKey: "ai.settings.retrievalSection",
    ownerKey: "ai.adminGuide.security.owners.spaceAdmin",
    boundaryKey: "ai.adminGuide.security.boundaries.retrieval",
  },
  {
    id: "ragApi",
    nameKey: "ai.integrations.ragTitle",
    ownerKey: "ai.adminGuide.security.owners.workspaceAdmin",
    boundaryKey: "ai.adminGuide.security.boundaries.ragApi",
  },
  {
    id: "ragSync",
    nameKey: "ai.ragSync.title",
    ownerKey: "ai.adminGuide.security.owners.operatorAndSpaceAdmin",
    boundaryKey: "ai.adminGuide.security.boundaries.ragSync",
  },
  {
    id: "inboundMcp",
    nameKey: "ai.integrations.mcpTitle",
    ownerKey: "ai.adminGuide.security.owners.workspaceAdmin",
    boundaryKey: "ai.adminGuide.security.boundaries.inboundMcp",
  },
  {
    id: "outboundMcp",
    nameKey: "ai.externalTools.title",
    ownerKey: "ai.adminGuide.security.owners.layered",
    boundaryKey: "ai.adminGuide.security.boundaries.outboundMcp",
  },
] as const;

export const AI_ADMIN_GUIDE_SECURITY_PRINCIPLES = [
  "leastPrivilege",
  "separateCredentials",
  "liveChecks",
  "stopControls",
] as const;

export const AI_ADMIN_GUIDE_TROUBLESHOOTING_GROUPS = [
  {
    id: "access",
    rows: ["401", "sourceAccessChanged"],
  },
  {
    id: "limits",
    rows: ["429", "503", "leaseLost"],
  },
  {
    id: "ragSync",
    rows: [
      "409",
      "targetMismatch",
      "writerVerification",
      "sourceRemoved",
      "runtimeStopped",
      "cleanupRequired",
    ],
  },
  {
    id: "mcp",
    rows: ["consentRevoked"],
  },
] as const;

export type AiAdminGuideDiagram = {
  source: string;
  labelKey: string;
  captionKey: string;
  textAlternativeKeys: readonly string[];
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
): Record<"overview" | "rag" | "mcp", AiAdminGuideDiagram> {
  const label = (key: string) => escapeMermaidLabel(t(key));
  const alternativeKeys = (diagram: "overview" | "rag" | "mcp") =>
    [1, 2, 3, 4].map(
      (index) =>
        `ai.adminGuide.diagram.${diagram}.textAlternative.step${index}`,
    );

  return {
    overview: {
      labelKey: "ai.adminGuide.diagram.overview.label",
      captionKey: "ai.adminGuide.diagram.overview.caption",
      textAlternativeKeys: alternativeKeys("overview"),
      source: `flowchart TB
  Need["${label("ai.adminGuide.overview.title")}"]
  subgraph DocmostPath["${label("ai.adminGuide.navigation.groups.docmost")}"]
    direction TB
    Assistant["${label("ai.title")}"]
    Retrieval["${label("ai.settings.retrievalSection")}"]
    Assistant ~~~ Retrieval
  end
  subgraph DataPath["${label("ai.adminGuide.navigation.groups.data")}"]
    direction TB
    RagApi["${label("ai.integrations.ragTitle")}"]
    RagSync["${label("ai.ragSync.title")}"]
    RagApi ~~~ RagSync
  end
  subgraph McpPath["${label("ai.adminGuide.navigation.groups.mcp")}"]
    direction TB
    Inbound["${label("ai.integrations.mcpTitle")}"]
    Outbound["${label("ai.externalTools.title")}"]
    Inbound ~~~ Outbound
  end
  Need --> Assistant
  Need --> RagApi
  Need --> Inbound
  DocmostPath ~~~ DataPath
  DataPath ~~~ McpPath`,
    },
    rag: {
      labelKey: "ai.adminGuide.diagram.rag.label",
      captionKey: "ai.adminGuide.diagram.rag.caption",
      textAlternativeKeys: alternativeKeys("rag"),
      source: `flowchart TB
  Question["${label("ai.adminGuide.diagram.rag.nodes.question")}"] --> Retrieval["${label("ai.settings.retrievalSection")}"]
  Retrieval --> Index["${label("ai.adminGuide.diagram.rag.nodes.externalIndex")}"]
  Index --> Checks["${label("ai.adminGuide.diagram.rag.nodes.liveChecks")}"]
  Indexer["${label("ai.adminGuide.diagram.rag.nodes.externalIndexer")}"] --> RagApi["/api/rag/*"]
  RagApi --> ExportChecks["${label("ai.adminGuide.diagram.rag.nodes.liveChecks")}"]
  Docmost["Docmost"] --> RagSync["${label("ai.ragSync.title")}"]
  RagSync --> OpenWebUi["Open WebUI"]`,
    },
    mcp: {
      labelKey: "ai.adminGuide.diagram.mcp.label",
      captionKey: "ai.adminGuide.diagram.mcp.caption",
      textAlternativeKeys: alternativeKeys("mcp"),
      source: `flowchart TB
  Client["${label("ai.integrations.mcpTitle")}"] --> Inbound["/mcp"]
  Inbound --> ReadTools["${label("ai.adminGuide.diagram.mcp.nodes.readTools")}"]
  ReadTools --> Docmost["Docmost"]
  Agent["${label("ai.externalTools.title")}"] --> Approval["${label("ai.adminGuide.diagram.mcp.nodes.approval")}"]
  Approval --> Remote["${label("ai.adminGuide.diagram.mcp.nodes.remoteServer")}"]`,
    },
  };
}
