export const AI_PROVIDERS = ["openai-compatible"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_ASSISTANT_GENDERS = ["masculine", "feminine"] as const;
export type AiAssistantGender = (typeof AI_ASSISTANT_GENDERS)[number];

export const AI_ASSISTANT_NAME_MAX_LENGTH = 80;

export function hasInvalidAiAssistantNameCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

export const AI_SPACE_CONFIG_DEFAULTS = {
  provider: "openai-compatible",
  temperature: 0.2,
  maxOutputTokens: 8192,
  contextWindow: 131072,
  requestTimeoutMs: 300000,
  dailyRequestLimitPerUser: 100,
  dailyTokenLimitPerSpace: 2000000,
  retentionDays: 90,
} as const;

export const AI_RETRIEVAL_CONFIG_DEFAULTS = {
  adapter: "http-json-v1",
  timeoutMs: 8000,
  maxResults: 8,
} as const;

export const AI_RETRIEVAL_ADAPTERS = [
  "none",
  "http-json-v1",
  "open-webui-knowledge-v1",
] as const;
export type AiRetrievalAdapter = (typeof AI_RETRIEVAL_ADAPTERS)[number];

export const AI_RETRIEVAL_OUTCOMES = [
  "not_requested",
  "disabled",
  "used",
  "empty",
  "failed",
] as const;
export type AiRetrievalOutcome = (typeof AI_RETRIEVAL_OUTCOMES)[number];

export const AI_MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export const AI_MESSAGE_STATUSES = [
  "pending",
  "streaming",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AiMessageStatus = (typeof AI_MESSAGE_STATUSES)[number];

export const AI_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const AI_RUN_TRIGGERS = ["send", "retry", "regenerate"] as const;
export type AiRunTrigger = (typeof AI_RUN_TRIGGERS)[number];

export const AI_CHAT_FILE_STATUSES = [
  "pending",
  "processing",
  "ready",
  "failed",
] as const;
export type AiChatFileStatus = (typeof AI_CHAT_FILE_STATUSES)[number];

export const AI_CONTEXT_SOURCE_TYPES = [
  "page",
  "database",
  "database_row",
] as const;
export type AiContextSourceType = (typeof AI_CONTEXT_SOURCE_TYPES)[number];

export const AI_DESCENDANT_SELECTION_MODES = [
  "none",
  "all",
  "selected",
] as const;
export type AiDescendantSelectionMode =
  (typeof AI_DESCENDANT_SELECTION_MODES)[number];

export const AI_CONTEXT_LIMITS = {
  manualRoots: 10,
  resolvedSources: 50,
  files: 10,
  attachments: 20,
} as const;

export const AI_SOURCE_TYPES = [
  "page",
  "database",
  "database_row",
  "attachment",
  "chat_file",
] as const;
export type AiSourceType = (typeof AI_SOURCE_TYPES)[number];

export const AI_RETRIEVAL_SOURCE_TYPES = [
  "page",
  "database_row",
  "attachment",
] as const;
export type AiRetrievalSourceType = (typeof AI_RETRIEVAL_SOURCE_TYPES)[number];

export const AI_CONVERSATION_TITLE_SOURCES = [
  "manual",
  "generated",
  "fallback",
] as const;
export type AiConversationTitleSource =
  (typeof AI_CONVERSATION_TITLE_SOURCES)[number];

export const AI_AUX_RUN_KINDS = [
  "conversation_title",
  "editor_transform",
] as const;
export type AiAuxRunKind = (typeof AI_AUX_RUN_KINDS)[number];

export const AI_AUX_RUN_STATUSES = AI_RUN_STATUSES;
export type AiAuxRunStatus = AiRunStatus;

export const AI_ERROR_CODES = [
  "ai_unavailable",
  "ai_quota_exceeded",
  "ai_daily_request_limit",
  "ai_daily_token_limit",
  "ai_conversation_busy",
  "ai_run_not_latest",
  "idempotency_key_reused",
  "page_write_required",
  "page_unavailable",
  "provider_timeout",
  "provider_url_rejected",
  "provider_unavailable",
  "provider_invalid_response",
  "queue_unavailable",
  "worker_lost",
  "retrieval_request_too_large",
  "retrieval_timeout",
  "retrieval_unavailable",
  "retrieval_url_rejected",
  "retrieval_invalid_response",
  "retrieval_collection_unavailable",
  "ai_file_processing_failed",
  "ai_file_upload_failed",
  "ai_context_revision_conflict",
  "ai_context_source_limit",
  "ai_context_resolved_source_limit",
  "ai_context_source_excluded",
  "ai_context_descendant_invalid",
  "context_source_unavailable",
  "editor_selection_required",
  "editor_context_stale",
  "editor_action_not_found",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export interface AiListResponse<T> {
  items: T[];
}

export interface AiPageResponse<T> extends AiListResponse<T> {
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AiQuickCommand {
  id: string;
  label: string;
  prompt: string;
  description?: string;
  enabled: boolean;
  position: number;
}

export interface AiRetrievalConfig {
  adapter: AiRetrievalAdapter;
  url: string | null;
  apiKeyConfigured: boolean;
  timeoutMs: number;
  maxResults: number;
  openWebUi: {
    baseUrl: string | null;
    knowledgeId: string | null;
    apiKeyConfigured: boolean;
  };
}

export interface AiRetrievalConfigUpdate {
  adapter?: AiRetrievalAdapter;
  url?: string | null;
  apiKey?: string;
  clearApiKey?: boolean;
  timeoutMs?: number;
  maxResults?: number;
  openWebUi?: {
    baseUrl?: string | null;
    knowledgeId?: string | null;
    apiKey?: string;
    clearApiKey?: boolean;
  };
}

export interface AiAssistantIdentity {
  name: string;
  gender: AiAssistantGender;
}

export interface AiSpaceConfig {
  id: string;
  workspaceId: string;
  spaceId: string;
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  chatModel: string;
  apiKeyConfigured: boolean;
  assistantNameEnabled: boolean;
  assistantName: string | null;
  assistantGender: AiAssistantGender;
  retrieval: AiRetrievalConfig;
  systemInstructions: string | null;
  temperature: number;
  maxOutputTokens: number;
  contextWindow: number;
  requestTimeoutMs: number;
  dailyRequestLimitPerUser: number;
  dailyTokenLimitPerSpace: number;
  retentionDays: number;
  visionEnabled: boolean;
  reasoningEnabled: boolean;
  quickCommands: AiQuickCommand[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiSpaceConfigUpdate {
  enabled?: boolean;
  provider?: AiProvider;
  baseUrl?: string;
  chatModel?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  assistantNameEnabled?: boolean;
  assistantName?: string | null;
  assistantGender?: AiAssistantGender;
  retrieval?: AiRetrievalConfigUpdate;
  systemInstructions?: string | null;
  temperature?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  requestTimeoutMs?: number;
  dailyRequestLimitPerUser?: number;
  dailyTokenLimitPerSpace?: number;
  retentionDays?: number;
  visionEnabled?: boolean;
  reasoningEnabled?: boolean;
  quickCommands?: AiQuickCommand[] | null;
}

export interface AiAvailability {
  enabled: boolean;
  configured: boolean;
  canUse: boolean;
  canManage: boolean;
  currentDocumentAvailable: boolean;
  editorActionsAvailable: boolean;
  assistantIdentity: AiAssistantIdentity | null;
  retrievalAvailable: boolean;
  quickCommands?: AiQuickCommand[];
  usage?: {
    requestsToday: number;
    tokensToday: number;
    activeRuns: number;
  };
  unavailableReason?: string;
}

export interface AiConversation {
  id: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  userId: string;
  clientRequestId: string | null;
  title: string | null;
  titleSource: AiConversationTitleSource | null;
  draft: string | null;
  useSpaceSearch: boolean;
  includeCurrentDocument: boolean;
  contextRevision: number;
  lastOpenedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiContextSource {
  id: string;
  sourceType: AiContextSourceType;
  sourceId: string;
  pageId: string;
  title: string;
  icon: string | null;
  breadcrumbs: string[];
  url: string | null;
  position: number;
  available: boolean;
  hasChildren: boolean;
  descendants: AiDescendantSelection;
}

export interface AiDescendantSelection {
  mode: AiDescendantSelectionMode;
  pageIds: string[];
}

export interface AiConversationContext {
  conversationId: string;
  revision: number;
  fingerprint: string;
  includeCurrentDocument: boolean;
  currentDocumentDescendants: AiDescendantSelection;
  sources: AiContextSource[];
  resolvedSourceCount: number;
  limits: {
    manualRoots: number;
    resolvedSources: number;
  };
  fileIds: string[];
  attachmentIds: string[];
  updatedAt: string;
}

export interface AiCitation {
  id: string;
  messageId: string;
  sourceType: AiSourceType;
  sourceId: string;
  pageId: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
  excerpt: string | null;
  position: number;
  relevanceScore: number | null;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  userId: string | null;
  role: AiMessageRole;
  content: string;
  reasoning: string;
  status: AiMessageStatus;
  clientRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  errorCode: string | null;
  errorMessage: string | null;
  accessRestricted?: boolean;
  currentRunId?: string | null;
  runId?: string;
  runStatus?: AiRunStatus;
  runSequence?: number;
  retrievalOutcome?: AiRetrievalOutcome;
  retrievalErrorCode?: string | null;
  applyContext?: AiApplyContext;
  sources?: AiCitation[];
  createdAt: string;
  updatedAt: string;
}

export interface AiSelection {
  text: string;
  from: number;
  to: number;
}

export interface AiApplyContext {
  pageId: string;
  snapshotHash: string | null;
  selection: AiSelection | null;
}

export interface AiRun {
  id: string;
  conversationId: string;
  userId: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  userMessageId: string;
  assistantMessageId: string;
  rootRunId: string;
  previousRunId: string | null;
  attemptNo: number;
  trigger: AiRunTrigger;
  status: AiRunStatus;
  clientRequestId: string;
  contextRevision: number;
  useSpaceSearch: boolean;
  chatFileIds: string[];
  attachmentIds: string[];
  applyContext: AiApplyContext;
  sequence: number;
  reservedTokens: number;
  enqueuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  finishReason: string | null;
  retrievalOutcome: AiRetrievalOutcome;
  retrievalErrorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiRetrievalQueryRequest {
  schemaVersion: 1;
  requestId: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  query: string;
  allowedPageIds: string[];
  sourceTypes: AiRetrievalSourceType[];
  limit: number;
  candidateLimit: number;
}

export interface AiRetrievalCandidate {
  sourceType: AiRetrievalSourceType;
  sourceId: string;
  pageId: string;
  text: string;
  score?: number;
}

export interface AiRetrievalQueryResponse {
  items: AiRetrievalCandidate[];
}

export interface AiChatFile {
  id: string;
  conversationId: string;
  userId: string;
  workspaceId: string;
  spaceId: string;
  name: string;
  mimeType: string;
  size: number;
  status: AiChatFileStatus;
  error: string | null;
  uploadBatchId: string | null;
  uploadedAt: string | null;
  storageDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const AI_FILE_UPLOAD_BATCH_STATUSES = [
  "processing",
  "completed",
  "failed",
] as const;
export type AiFileUploadBatchStatus =
  (typeof AI_FILE_UPLOAD_BATCH_STATUSES)[number];

export interface AiFileUploadBatch {
  id: string;
  conversationId: string;
  status: AiFileUploadBatchStatus;
  errorCode: string | null;
  files: AiChatFile[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAiConversationRequest {
  pageId: string;
  clientRequestId: string;
  title?: string;
  useSpaceSearch?: boolean;
}

export interface UpdateAiConversationRequest {
  title?: string | null;
  draft?: string | null;
  useSpaceSearch?: boolean;
}

export interface UpdateAiConversationContextRequest {
  expectedRevision: number;
  includeCurrentDocument: boolean;
  currentDocumentDescendants?: AiDescendantSelection;
  sources: Array<{
    sourceType: AiContextSourceType;
    sourceId: string;
    descendants?: AiDescendantSelection;
  }>;
  fileIds: string[];
  attachmentIds: string[];
}

export interface AiContextSourceSearchRequest {
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface AiSpaceContentExclusion {
  pageId: string;
  title: string;
  icon: string | null;
  breadcrumbs: string[];
  includeDescendants: boolean;
  effectivePageCount: number;
  available: boolean;
}

export interface AiSpaceContentPolicy {
  spaceId: string;
  revision: number;
  fingerprint: string;
  exclusions: AiSpaceContentExclusion[];
  updatedAt: string | null;
}

export interface UpdateAiSpaceContentPolicyRequest {
  expectedRevision: number;
  exclusions: Array<{
    pageId: string;
    includeDescendants: boolean;
  }>;
}

export interface AiContentPolicyUpdatedEvent {
  spaceId: string;
  revision: number;
  fingerprint: string;
}

export interface AiRunActionRequest {
  clientRequestId: string;
}

export interface SendAiMessageRequest {
  content: string;
  clientRequestId: string;
  contextRevision: number;
  documentSnapshot?: string;
  snapshotHash?: string;
  selection?: AiSelection;
  fileIds?: string[];
  attachmentIds?: string[];
  useSpaceSearch?: boolean;
}

export interface SendAiMessageResponse {
  userMessage: AiMessage;
  assistantMessage: AiMessage;
  run: AiRun;
}

export interface AiModelTestResult {
  ok: boolean;
  models: string[];
  modelsAvailable: boolean;
  chatModelAvailable: boolean;
  vision: boolean;
  latencyMs: number;
}

export interface AiRetrievalTestResult {
  ok: boolean;
  skipped?: boolean;
  itemCount?: number;
  latencyMs: number;
  adapter?: AiRetrievalAdapter;
  remoteVersion?: string;
  candidateCount?: number;
  validCandidateCount?: number;
  state?: "ready" | "empty";
}

export interface AiPageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface CreateAiEditorActionRequest {
  pageId: string;
  clientRequestId: string;
  commandId: string;
  instruction: string;
  selection: AiSelection;
  snapshotHash: string;
}

export interface AiEditorActionRun {
  id: string;
  kind: "editor_transform";
  userId: string;
  workspaceId: string;
  spaceId: string;
  pageId: string;
  clientRequestId: string;
  commandId: string;
  selection: AiSelection;
  snapshotHash: string;
  status: AiAuxRunStatus;
  sequence: number;
  response: string;
  inputTokens: number;
  outputTokens: number;
  cancelRequestedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiPanelPreference {
  open: boolean;
  tab: "comments" | "toc" | "ai" | "";
  width: number;
}

export interface AiRunDeltaEvent {
  runId: string;
  conversationId: string;
  messageId: string;
  pageId: string;
  sequence: number;
  delta: string;
  reasoningDelta?: string;
}

export interface AiRunStatusEvent {
  runId: string;
  conversationId: string;
  messageId: string;
  pageId: string;
  sequence: number;
  status: AiRunStatus;
  finishReason?: string;
  retrievalOutcome?: AiRetrievalOutcome;
  retrievalErrorCode?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface AiConversationUpdatedEvent {
  conversation: AiConversation;
}

export interface AiEditorActionDeltaEvent {
  runId: string;
  pageId: string;
  sequence: number;
  delta: string;
}

export interface AiEditorActionStatusEvent {
  runId: string;
  pageId: string;
  sequence: number;
  status: AiAuxRunStatus;
  errorCode?: string;
}
