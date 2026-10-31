export const INTEGRATION_PREVIEW_PROVIDERS = [
  "github",
  "gitlab",
  "figma",
] as const;
export type IntegrationPreviewProvider =
  (typeof INTEGRATION_PREVIEW_PROVIDERS)[number];

export interface IntegrationPreviewConnection {
  id: string;
  provider: IntegrationPreviewProvider;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface IntegrationPreviewSettings {
  enabled: boolean;
  availableProviders: IntegrationPreviewProvider[];
}

export interface IntegrationPreviewResult {
  url: string;
  provider: IntegrationPreviewProvider;
  kind: "repository" | "issue" | "pullRequest" | "commit" | "file";
  status:
    | "ready"
    | "disabled"
    | "connectionRequired"
    | "unavailable"
    | "rateLimited";
  title?: string;
  description?: string;
  state?: "open" | "closed" | "merged" | "archived";
}
