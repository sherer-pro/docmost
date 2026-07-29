import type { AiMessage, AiRun, AiRunStatus } from "@docmost/api-contract";

export type {
  AiAvailability,
  AiChatFile,
  AiChatFileStatus,
  AiCitation,
  AiConversation,
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
  AiRunActionRequest,
  AiRunDeltaEvent,
  AiRunTrigger,
  AiRunStatus,
  AiRunStatusEvent,
  AiSourceType,
  AiSpaceConfig,
  AiSpaceConfigUpdate,
  AiModelTestResult,
  AiRetrievalTestResult,
  CreateAiConversationRequest,
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
  sequence: number;
  status: AiRunStatus;
  error?: string;
}

export interface SendAiMessageInput {
  conversationId: string;
  content: string;
  pageId: string;
  clientRequestId: string;
  useSpaceSearch: boolean;
  fileIds?: string[];
  attachmentIds?: string[];
  editorContext: AiEditorContext;
}

export interface SendAiMessageResult {
  userMessage: AiMessage;
  assistantMessage: AiMessage;
  run: AiRun;
}
