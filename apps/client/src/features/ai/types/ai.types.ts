import type { AiMessage, AiRun, AiRunStatus } from "@docmost/api-contract";

export type {
  AiAssistantGender,
  AiAssistantIdentity,
  AiAvailability,
  AiChatFile,
  AiChatFileStatus,
  AiCitation,
  AiConversation,
  AiConversationContext,
  AiDescendantSelection,
  AiDescendantSelectionMode,
  AiContextSource,
  AiContextSourceType,
  AiConversationUpdatedEvent,
  AiContentPolicyUpdatedEvent,
  AiEditorActionRun,
  AiEditorActionDeltaEvent,
  AiEditorActionStatusEvent,
  AiFileUploadBatch,
  AiFileUploadBatchStatus,
  AiApplyContext,
  AiListResponse,
  AiMessage,
  AiMessageRole,
  AiMessageStatus,
  AiPanelPreference,
  AiPageAttachment,
  AiPageResponse,
  AiQuickCommand,
  AiRetrievalAdapter,
  AiRetrievalConfig,
  AiRetrievalConfigUpdate,
  AiRetrievalOutcome,
  AiRun,
  AiRunStep,
  AiRunStepEvent,
  AiRunStepStatus,
  AiRunActionRequest,
  AiRunDeltaEvent,
  AiRunTrigger,
  AiRunStatus,
  AiRunStatusEvent,
  AiSourceType,
  AiSpaceConfig,
  AiSpaceConfigUpdate,
  AiSpaceContentExclusion,
  AiSpaceContentPolicy,
  UpdateAiSpaceContentPolicyRequest,
  AiModelTestResult,
  AiAgentTestResult,
  AiRetrievalTestResult,
  CreateAiConversationRequest,
  CreateAiEditorActionRequest,
  UpdateAiConversationContextRequest,
  SendAiMessageResponse,
} from "@docmost/api-contract";

export interface AiEditorContext {
  pageId: string;
  documentHash: string;
  document: Record<string, unknown>;
  markdown: string;
  text: string;
  selection: {
    from: number;
    to: number;
    text: string;
  };
}

export interface AiDocumentContext {
  pageId: string;
  spaceId: string;
  spaceSlug?: string;
  title: string;
  canWrite: boolean;
}

export interface AiStreamingRun {
  runId: string;
  conversationId: string;
  messageId?: string;
  content: string;
  reasoning: string;
  sequence: number;
  status: AiRunStatus;
  cancelRequestedAt?: string | null;
  error?: string;
}

export interface AiActivityItem {
  runId: string;
  conversationId: string;
  pageId: string;
  pageTitle: string;
  pageHref?: string;
  status: AiRunStatus;
  unread: boolean;
  updatedAt: string;
  /** Set once a run calls a tool on an external MCP server. */
  hasExternalToolCall?: boolean;
}

export interface SendAiMessageInput {
  conversationId: string;
  content: string;
  pageId: string;
  clientRequestId: string;
  useSpaceSearch: boolean;
  contextRevision: number;
  editorContext: AiEditorContext;
  pageTitle: string;
  pageHref: string;
}

export interface SendAiMessageResult {
  userMessage: AiMessage;
  assistantMessage: AiMessage;
  run: AiRun;
}
