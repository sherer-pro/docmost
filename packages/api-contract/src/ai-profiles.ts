import type { AiQuickCommand } from "./ai-quick-command";
import type { AiBuiltinToolCapability } from "./ai-tools";

export const AI_ASSISTANT_PROFILE_ICONS = [
  "sparkles",
  "robot",
  "brain",
  "book",
  "briefcase",
  "code",
  "language",
  "search",
] as const;

export type AiAssistantProfileIcon =
  (typeof AI_ASSISTANT_PROFILE_ICONS)[number];

export const AI_ASSISTANT_PROFILE_LIMITS = {
  perSpace: 50,
  name: 80,
  description: 500,
  instructions: 20_000,
  launchMessage: 2_000,
  modelId: 200,
} as const;

export type AiAssistantProfileAvailability =
  | "available"
  | "disabled"
  | "deleted"
  | "policy_disabled"
  | "not_allowed";

export type AiAssistantProfileAgentReason =
  | "available"
  | "agent_disabled"
  | "no_tools"
  | "unverified"
  | "policy_changed";

export interface AiAssistantProfileExternalTool {
  bindingId: string;
  toolName: string;
  schemaFingerprint?: string;
}

export interface AiAssistantProfileGroupPolicy {
  groupId: string;
  available: boolean;
  allowedBuiltinCapabilities: AiBuiltinToolCapability[] | null;
}

export interface AiAssistantProfileAgentStatus {
  available: boolean;
  reason: AiAssistantProfileAgentReason;
  verifiedAt: string | null;
}

export interface AiAssistantProfileSummary {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
  icon: AiAssistantProfileIcon;
  version: number;
  enabled: boolean;
  autoStart: boolean;
  launchMessage: string | null;
  quickCommands: AiQuickCommand[] | null;
  availability: AiAssistantProfileAvailability;
  agent: AiAssistantProfileAgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AiAssistantProfile extends AiAssistantProfileSummary {
  workspaceId: string;
  instructions: string;
  chatModelOverride: string | null;
  temperatureOverride: number | null;
  maxOutputTokensOverride: number | null;
  allowedBuiltinCapabilities: AiBuiltinToolCapability[];
  allowedExternalTools: AiAssistantProfileExternalTool[];
  groupPolicies: AiAssistantProfileGroupPolicy[];
  createdById: string | null;
  updatedById: string | null;
  deletedAt: string | null;
}

export interface AiAssistantProfileInput {
  name: string;
  description?: string | null;
  icon: AiAssistantProfileIcon;
  instructions: string;
  quickCommands?: AiQuickCommand[] | null;
  chatModelOverride?: string | null;
  temperatureOverride?: number | null;
  maxOutputTokensOverride?: number | null;
  allowedBuiltinCapabilities: AiBuiltinToolCapability[];
  allowedExternalTools?: AiAssistantProfileExternalTool[];
  groupPolicies?: AiAssistantProfileGroupPolicy[];
  autoStart?: boolean;
  launchMessage?: string | null;
  enabled?: boolean;
}

export type CreateAiAssistantProfileRequest = AiAssistantProfileInput;

export interface UpdateAiAssistantProfileRequest
  extends Partial<AiAssistantProfileInput> {
  expectedVersion: number;
}

export interface AiAssistantProfileWorkspacePolicy {
  deploymentEnabled: boolean;
  enabled: boolean;
  modelOverridesEnabled: boolean;
  policyVersion: number;
  updatedAt: string | null;
}

export interface UpdateAiAssistantProfileWorkspacePolicyRequest {
  enabled?: boolean;
  modelOverridesEnabled?: boolean;
}

export interface AiAssistantProfilePreferences {
  spaceId: string;
  preferredProfileId: string | null;
  hiddenProfileIds: string[];
}

export interface UpdateAiAssistantProfilePreferencesRequest {
  preferredProfileId: string | null;
  hiddenProfileIds: string[];
}

export interface AiAssistantProfilesView {
  enabled: boolean;
  modelOverridesEnabled: boolean;
  defaultProfileId: string | null;
  preferredProfileId: string | null;
  items: AiAssistantProfileSummary[];
}

export interface AiAssistantProfileDisplaySnapshot {
  name: string;
  description: string | null;
  icon: AiAssistantProfileIcon;
}

export interface AiAssistantProfileSnapshot {
  schemaVersion: 1;
  source: "assistant_profile" | "legacy_space";
  profileId: string | null;
  profileVersion: number | null;
  display: AiAssistantProfileDisplaySnapshot | null;
  instructions: string | null;
  quickCommands: AiQuickCommand[] | null;
  chatModelOverride: string | null;
  temperatureOverride: number | null;
  maxOutputTokensOverride: number | null;
  allowedBuiltinCapabilities: AiBuiltinToolCapability[] | null;
  allowedExternalTools: AiAssistantProfileExternalTool[] | null;
  autoStart: boolean;
  launchMessage: string | null;
  toolPolicyFingerprint: string;
}

export interface AiAssistantProfileConversationSummary {
  source: "assistant_profile" | "legacy_space";
  id: string | null;
  version: number | null;
  name: string | null;
  description: string | null;
  icon: AiAssistantProfileIcon | null;
  quickCommands: AiQuickCommand[] | null;
  availability: AiAssistantProfileAvailability;
}

export interface AiAssistantProfileProviderSnapshot {
  schemaVersion: 1;
  providerProtocolVersion: "openai-compatible:v1";
  normalizedBaseUrl: string;
  chatModel: string;
  temperature: number;
  maxOutputTokens: number;
  contextWindow: number;
  requestTimeoutMs: number;
  visionEnabled: boolean;
  reasoningEnabled: boolean;
}

export interface AiAssistantProfileVerificationStatus {
  verified: boolean;
  reason: AiAssistantProfileAgentReason;
  verificationFingerprint: string;
  providerFingerprint: string;
  toolSchemaFingerprint: string;
  toolPolicyFingerprint: string;
  verifiedAt: string | null;
}

export interface AiAssistantProfileTestResult {
  ok: boolean;
  toolName: string;
  latencyMs: number;
  verification: AiAssistantProfileVerificationStatus;
}
