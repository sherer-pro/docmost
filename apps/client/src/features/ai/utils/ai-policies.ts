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
  ai_file_processing_failed: "ai.errorReason.fileProcessingFailed",
  ai_file_upload_failed: "ai.errorReason.fileUploadFailed",
  ai_context_revision_conflict: "ai.errorReason.contextRevisionConflict",
  ai_context_source_limit: "ai.errorReason.contextSourceLimit",
  context_source_unavailable: "ai.errorReason.contextSourceUnavailable",
  editor_selection_required: "ai.errorReason.editorSelectionRequired",
  editor_context_stale: "ai.errorReason.editorContextStale",
  editor_action_not_found: "ai.errorReason.editorActionNotFound",
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
      ["queued", "running"].includes(item.runStatus),
  );
  return message?.runId && message.runStatus
    ? {
        runId: message.runId,
        conversationId: message.conversationId,
        messageId: message.id,
        content: message.content,
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

export function clampAiPanelWidth(value: unknown, fallback = 350): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(600, Math.max(300, value));
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
