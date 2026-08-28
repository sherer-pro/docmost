import type {
  AiConversation,
  AiMessage,
  AiQuickCommand,
  AiStreamingRun,
} from "@/features/ai/types/ai.types.ts";
import type { AsideTabPreference } from "@/features/user/types/user.types.ts";
import type { i18n, TFunction } from "i18next";

export type AiDeltaSequenceDecision = "apply" | "ignore" | "recover";

const AI_ERROR_TRANSLATION_KEYS: Record<string, string> = {
  ai_unavailable: "ai.errorReason.aiUnavailable",
  ai_quota_exceeded: "ai.errorReason.quotaExceeded",
  ai_daily_request_limit: "ai.errorReason.dailyRequestLimit",
  ai_daily_token_limit: "ai.errorReason.dailyTokenLimit",
  ai_conversation_busy: "ai.errorReason.conversationBusy",
  ai_run_not_latest: "ai.errorReason.runNotLatest",
  idempotency_key_reused: "ai.errorReason.idempotencyKeyReused",
  page_write_required: "ai.errorReason.pageWriteRequired",
  page_unavailable: "ai.errorReason.pageUnavailable",
  source_access_changed: "ai.errorReason.sourceAccessChanged",
  provider_timeout: "ai.errorReason.providerTimeout",
  provider_url_rejected: "ai.errorReason.providerConfiguration",
  provider_invalid_response: "ai.errorReason.providerInvalidResponse",
  provider_unavailable: "ai.errorReason.providerUnavailable",
  queue_unavailable: "ai.errorReason.queueUnavailable",
  worker_lost: "ai.errorReason.workerLost",
  retrieval_request_too_large: "ai.errorReason.retrievalRequestTooLarge",
  retrieval_timeout: "ai.errorReason.retrievalTimeout",
  retrieval_unavailable: "ai.errorReason.retrievalUnavailable",
  retrieval_url_rejected: "ai.errorReason.retrievalConfiguration",
  retrieval_invalid_response: "ai.errorReason.retrievalInvalidResponse",
  retrieval_collection_unavailable:
    "ai.errorReason.retrievalCollectionUnavailable",
  ai_file_processing_failed: "ai.errorReason.fileProcessingFailed",
  ai_file_validation_failed: "ai.errorReason.fileUploadFailed",
  ai_file_upload_failed: "ai.errorReason.fileUploadFailed",
  ai_vision_required: "ai.errorReason.visionRequired",
  ai_context_revision_conflict: "ai.errorReason.contextRevisionConflict",
  ai_context_source_limit: "ai.errorReason.contextSourceLimit",
  ai_context_resolved_source_limit: "ai.errorReason.contextResolvedSourceLimit",
  ai_context_source_excluded: "ai.errorReason.contextSourceExcluded",
  ai_context_descendant_invalid: "ai.errorReason.contextDescendantInvalid",
  context_source_unavailable: "ai.errorReason.contextSourceUnavailable",
  editor_selection_required: "ai.errorReason.editorSelectionRequired",
  editor_context_stale: "ai.errorReason.editorContextStale",
  editor_action_not_found: "ai.errorReason.editorActionNotFound",
  agent_disabled: "ai.errorReason.agentDisabled",
  agent_provider_unverified: "ai.errorReason.agentProviderUnverified",
  ai_profile_disabled: "ai.errorReason.profileDisabled",
  ai_profile_name_conflict: "ai.errorReason.profileNameConflict",
  ai_profile_not_allowed: "ai.errorReason.profileNotAllowed",
  ai_profile_locked: "ai.errorReason.profileLocked",
  ai_profile_version_conflict: "ai.errorReason.profileVersionConflict",
  agent_profile_unverified: "ai.errorReason.agentProfileUnverified",
  agent_profile_policy_changed: "ai.errorReason.agentProfilePolicyChanged",
  agent_provider_config_changed: "ai.errorReason.agentProviderConfigChanged",
  agent_tool_call_required: "ai.errorReason.agentToolCall",
  agent_tool_call_invalid: "ai.errorReason.agentToolCall",
  agent_step_limit: "ai.errorReason.agentStepLimit",
  agent_tool_limit: "ai.errorReason.agentToolLimit",
  agent_result_limit: "ai.errorReason.agentResultLimit",
  agent_write_expired: "ai.errorReason.agentWriteExpired",
  agent_write_stale: "ai.errorReason.agentWriteStale",
  agent_write_rejected: "ai.errorReason.agentWriteRejected",
  agent_write_not_allowed: "ai.errorReason.agentWriteNotAllowed",
  agent_tool_policy_changed: "ai.errorReason.agentToolPolicyChanged",
  agent_mcp_config_changed: "ai.errorReason.externalMcpConfigChanged",
  agent_mcp_access_revoked: "ai.errorReason.externalMcpAccessRevoked",
  agent_mcp_tool_definition_limit: "ai.errorReason.externalMcpToolLimit",
  agent_mcp_snapshot_too_large: "ai.errorReason.externalMcpToolLimit",
  agent_mcp_capacity: "ai.errorReason.externalMcpUnavailable",
  external_mcp_disabled: "ai.errorReason.externalMcpDisabled",
  external_mcp_url_rejected: "ai.errorReason.externalMcpUrlRejected",
  external_mcp_unavailable: "ai.errorReason.externalMcpUnavailable",
  external_mcp_timeout: "ai.errorReason.externalMcpTimeout",
  external_mcp_invalid_response: "ai.errorReason.externalMcpInvalidResponse",
  external_mcp_namespace_conflict:
    "ai.errorReason.externalMcpNamespaceConflict",
  external_mcp_headers_conflict: "ai.errorReason.externalMcpHeadersConflict",
  external_mcp_tool_not_approved: "ai.errorReason.externalMcpToolNotApproved",
  external_mcp_not_opted_in: "ai.errorReason.externalMcpNotOptedIn",
  external_mcp_result_limit: "ai.errorReason.externalMcpResultLimit",
  external_mcp_remote_error: "ai.errorReason.externalMcpRemoteError",
};

export function getAiErrorTranslationKey(
  errorCode: string | null | undefined,
): string {
  return AI_ERROR_TRANSLATION_KEYS[errorCode ?? ""] ?? "ai.errorReason.unknown";
}

export function resolveAiErrorMessage(
  t: TFunction,
  i18nInstance: i18n,
  errorCode: string | null | undefined,
): string {
  const key = getAiErrorTranslationKey(errorCode);
  if (i18nInstance.exists(key)) {
    const translated = t(key);
    if (translated && translated !== key) return translated;
  }
  const fallbackKey = "ai.errorReason.unknown";
  if (i18nInstance.exists(fallbackKey)) {
    const translated = t(fallbackKey);
    if (translated && translated !== fallbackKey) return translated;
  }
  return "The AI request could not be completed.";
}

export function shouldShowAiPanelLoadFailure(
  availabilityIsError: boolean,
  conversationsIsError: boolean,
  canUse: boolean | undefined,
): boolean {
  return availabilityIsError || (canUse === true && conversationsIsError);
}

export function shouldShowAiRetrievalUi(
  retrievalAvailable: boolean | undefined,
): boolean {
  return retrievalAvailable === true;
}

export function isAiMessageRetryable(status: AiMessage["status"]): boolean {
  return status === "failed" || status === "cancelled";
}

export function getAiDeltaSequenceDecision(
  previousSequence: number | undefined,
  nextSequence: number,
): AiDeltaSequenceDecision {
  if (
    typeof previousSequence === "number" &&
    nextSequence <= previousSequence
  ) {
    return "ignore";
  }

  if (
    nextSequence > 1 &&
    (typeof previousSequence !== "number" ||
      nextSequence !== previousSequence + 1)
  ) {
    return "recover";
  }

  return "apply";
}

export const AI_RECONNECT_QUERY_KEY = ["ai"] as const;

export function getPersistedActiveRun(
  messages: AiMessage[],
): AiStreamingRun | undefined {
  const message = messages.find(
    (item) =>
      item.runId &&
      item.runStatus &&
      ["queued", "running", "awaiting_approval"].includes(item.runStatus),
  );
  return message?.runId && message.runStatus
    ? {
        runId: message.runId,
        conversationId: message.conversationId,
        messageId: message.id,
        content: message.content,
        reasoning: message.reasoning ?? "",
        sequence: message.runSequence ?? 0,
        status: message.runStatus,
      }
    : undefined;
}

export function sortAiMessagesChronologically(
  messages: AiMessage[],
): AiMessage[] {
  return [...messages].sort((left, right) => {
    const createdAtDifference =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return createdAtDifference || left.id.localeCompare(right.id);
  });
}

export type AiInsertTarget = "selection-end" | "cursor";

export function getAiApplyPolicy(
  contextIsCurrent: boolean,
  selection: { from: number; to: number } | null | undefined,
): {
  hasRealSelection: boolean;
  canReplace: boolean;
  insertTarget: AiInsertTarget;
} {
  const hasRealSelection = Boolean(selection && selection.to > selection.from);

  return {
    hasRealSelection,
    canReplace: contextIsCurrent && hasRealSelection,
    insertTarget: contextIsCurrent ? "selection-end" : "cursor",
  };
}

export const AI_PANEL_MIN_WIDTH = 360;
export const AI_PANEL_MAX_WIDTH = 600;
export const AI_PANEL_RESIZE_STEP = 10;

export function clampAiPanelWidth(value: unknown, fallback = 400): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, value));
}

export function getAiPanelWidthForKey(
  currentWidth: number,
  key: string,
): number | null {
  if (key === "ArrowLeft") {
    return clampAiPanelWidth(currentWidth + AI_PANEL_RESIZE_STEP);
  }
  if (key === "ArrowRight") {
    return clampAiPanelWidth(currentWidth - AI_PANEL_RESIZE_STEP);
  }
  if (key === "Home") {
    return AI_PANEL_MIN_WIDTH;
  }
  if (key === "End") {
    return AI_PANEL_MAX_WIDTH;
  }
  return null;
}

export interface AiPanelProfilePreference {
  aiPanelOpen: boolean;
  aiPanelTab: AsideTabPreference;
  aiPanelWidth: number;
}

export function getAiPanelPreferencePayload(
  preference: AiPanelProfilePreference,
): AiPanelProfilePreference {
  return {
    aiPanelOpen: preference.aiPanelOpen,
    aiPanelTab: preference.aiPanelTab,
    aiPanelWidth: clampAiPanelWidth(preference.aiPanelWidth),
  };
}

export function getLatestAiConversation(
  conversations: AiConversation[],
): AiConversation | undefined {
  return [...conversations].sort(
    (left, right) =>
      new Date(right.lastOpenedAt || right.updatedAt).getTime() -
      new Date(left.lastOpenedAt || left.updatedAt).getTime(),
  )[0];
}

export function mergeAiQuickCommands(
  standardCommands: AiQuickCommand[],
  customCommands: AiQuickCommand[],
): AiQuickCommand[] {
  const enabledCustomCommands = customCommands
    .filter((command) => command.enabled)
    .sort((left, right) => left.position - right.position);
  const customById = new Map(
    enabledCustomCommands.map((command) => [command.id, command]),
  );
  const standardIds = new Set(standardCommands.map((command) => command.id));

  return [
    ...standardCommands.map((command) => customById.get(command.id) ?? command),
    ...enabledCustomCommands.filter((command) => !standardIds.has(command.id)),
  ];
}
