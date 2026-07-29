import api, { unwrapApiResponse } from "@/lib/api-client.ts";
import {
  AiChatFile,
  AiConversation,
  AiFileUploadBatch,
  AiListResponse,
  AiMessage,
  AiModelTestResult,
  AiPageResponse,
  AiSpaceConfigUpdate,
  AiAvailability,
  AiSpaceConfig,
  AiRetrievalTestResult,
  AiPageAttachment,
  SendAiMessageInput,
  SendAiMessageResult,
  CreateAiConversationRequest,
  AiRun,
} from "@/features/ai/types/ai.types.ts";

export interface AiCollectionPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string | null;
}

export async function getAiConversations(
  pageId: string,
): Promise<AiConversation[]> {
  const response = await api.get<AiListResponse<AiConversation>>(
    "/ai/conversations",
    { params: { pageId } },
  );
  return unwrapApiResponse<AiListResponse<AiConversation>>(response).items;
}

export async function createAiConversation(
  data: CreateAiConversationRequest,
): Promise<AiConversation> {
  const response = await api.post<AiConversation>("/ai/conversations", data);
  return unwrapApiResponse<AiConversation>(response);
}

export async function updateAiConversation(
  conversationId: string,
  data: { title?: string; draft?: string; useSpaceSearch?: boolean },
): Promise<AiConversation> {
  const response = await api.patch<AiConversation>(
    `/ai/conversations/${conversationId}`,
    data,
  );
  return unwrapApiResponse<AiConversation>(response);
}

export async function openAiConversation(
  conversationId: string,
): Promise<AiConversation> {
  const response = await api.post<AiConversation>(
    `/ai/conversations/${conversationId}/actions/open`,
  );
  return unwrapApiResponse<AiConversation>(response);
}

export async function deleteAiConversation(
  conversationId: string,
): Promise<void> {
  await api.delete(`/ai/conversations/${conversationId}`);
}

export async function getAiMessages(
  conversationId: string,
  before?: string,
): Promise<AiCollectionPage<AiMessage>> {
  const response = await api.get<AiPageResponse<AiMessage>>(
    `/ai/conversations/${conversationId}/messages`,
    { params: { before, limit: 50 } },
  );
  const payload = unwrapApiResponse<AiPageResponse<AiMessage>>(response);
  return {
    items: payload.items,
    hasMore: payload.hasMore,
    nextCursor: payload.nextCursor,
  };
}

export async function sendAiMessage(
  input: SendAiMessageInput,
): Promise<SendAiMessageResult> {
  const { conversationId, editorContext, pageId: _pageId, ...message } = input;
  const payload = {
    ...message,
    documentSnapshot: editorContext.markdown,
    snapshotHash: editorContext.documentHash,
    selection: editorContext.selection,
  };
  const response = await api.post<SendAiMessageResult>(
    `/ai/conversations/${conversationId}/messages`,
    payload,
  );
  return unwrapApiResponse<SendAiMessageResult>(response);
}

export async function cancelAiRun(runId: string): Promise<AiRun> {
  const response = await api.post<AiRun>(
    `/ai/runs/${runId}/actions/cancel`,
  );
  return unwrapApiResponse<AiRun>(response);
}

export async function retryAiRun(input: {
  runId: string;
  clientRequestId: string;
}): Promise<AiRun> {
  const response = await api.post<AiRun>(
    `/ai/runs/${input.runId}/actions/retry`,
    { clientRequestId: input.clientRequestId },
  );
  return unwrapApiResponse<AiRun>(response);
}

export async function regenerateAiMessage(input: {
  messageId: string;
  clientRequestId: string;
}): Promise<AiRun> {
  const response = await api.post<AiRun>(
    `/ai/messages/${input.messageId}/actions/regenerate`,
    { clientRequestId: input.clientRequestId },
  );
  return unwrapApiResponse<AiRun>(response);
}

export async function getAiChatFiles(
  conversationId: string,
): Promise<AiChatFile[]> {
  const response = await api.get<AiListResponse<AiChatFile>>(
    `/ai/conversations/${conversationId}/files`,
  );
  return unwrapApiResponse<AiListResponse<AiChatFile>>(response).items;
}

export async function uploadAiChatFiles(
  conversationId: string,
  files: File[],
  idempotencyKey: string,
): Promise<AiFileUploadBatch> {
  const data = new FormData();
  files.forEach((file) => data.append("files", file));

  const response = await api.post<AiFileUploadBatch>(
    `/ai/conversations/${conversationId}/files`,
    data,
    {
      headers: {
        "Content-Type": "multipart/form-data",
        "Idempotency-Key": idempotencyKey,
      },
    },
  );

  return unwrapApiResponse<AiFileUploadBatch>(response);
}

export async function deleteAiChatFile(
  conversationId: string,
  fileId: string,
): Promise<void> {
  await api.delete(`/ai/conversations/${conversationId}/files/${fileId}`);
}

export async function getAiPageAttachments(
  pageId: string,
): Promise<AiPageAttachment[]> {
  const response = await api.get<AiListResponse<AiPageAttachment>>(
    `/ai/pages/${pageId}/attachments`,
  );
  return unwrapApiResponse<AiListResponse<AiPageAttachment>>(response).items;
}

export async function getAiSpaceConfig(
  spaceId: string,
): Promise<AiSpaceConfig | null> {
  const response = await api.get<AiSpaceConfig | null>(
    `/spaces/${spaceId}/ai/config`,
  );
  return unwrapApiResponse<AiSpaceConfig | null>(response) ?? null;
}

export async function updateAiSpaceConfig(
  spaceId: string,
  data: AiSpaceConfigUpdate,
): Promise<AiSpaceConfig> {
  const response = await api.patch<AiSpaceConfig>(
    `/spaces/${spaceId}/ai/config`,
    data,
  );
  return unwrapApiResponse<AiSpaceConfig>(response);
}

export async function testAiModelConfig(
  spaceId: string,
  data?: AiSpaceConfigUpdate,
): Promise<AiModelTestResult> {
  const response = await api.post<AiModelTestResult>(
    `/spaces/${spaceId}/ai/config/actions/test-model`,
    data,
  );
  return unwrapApiResponse<AiModelTestResult>(response);
}

export async function testAiRetrievalConfig(
  spaceId: string,
  data?: AiSpaceConfigUpdate,
): Promise<AiRetrievalTestResult> {
  const response = await api.post<AiRetrievalTestResult>(
    `/spaces/${spaceId}/ai/config/actions/test-retrieval`,
    data,
  );
  return unwrapApiResponse<AiRetrievalTestResult>(response);
}

export async function getAiSpaceStatus(
  spaceId: string,
  pageId?: string,
): Promise<AiAvailability> {
  const response = await api.get<AiAvailability>(
    `/spaces/${spaceId}/ai/status`,
    pageId ? { params: { pageId } } : undefined,
  );
  return unwrapApiResponse<AiAvailability>(response);
}
