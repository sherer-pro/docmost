import {
  useMutation,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import {
  cancelAiRun,
  createAiConversation,
  deleteAiChatFile,
  deleteAiConversation,
  getAiChatFiles,
  getAiConversations,
  getAiMessages,
  getAiPageAttachments,
  getAiSpaceConfig,
  getAiSpaceStatus,
  openAiConversation,
  regenerateAiMessage,
  retryAiRun,
  sendAiMessage,
  testAiModelConfig,
  testAiRetrievalConfig,
  updateAiConversation,
  updateAiSpaceConfig,
  uploadAiChatFiles,
} from "@/features/ai/services/ai-service.ts";
import {
  AiConversation,
  AiSpaceConfigUpdate,
  SendAiMessageInput,
} from "@/features/ai/types/ai.types.ts";
import { aiStreamingRunsAtom } from "@/features/ai/atoms/ai-atoms.ts";
import { reduceAiRunState } from "@/features/ai/utils/ai-run-state.ts";

export const AI_QUERY_KEYS = {
  conversations: (pageId: string) => ["ai", "conversations", pageId] as const,
  messages: (conversationId: string) =>
    ["ai", "messages", conversationId] as const,
  files: (conversationId: string) => ["ai", "files", conversationId] as const,
  pageAttachments: (pageId: string) =>
    ["ai", "page-attachments", pageId] as const,
  config: (spaceId: string) => ["ai", "config", spaceId] as const,
  status: (spaceId: string, pageId = "") =>
    ["ai", "status", spaceId, pageId] as const,
};

export function useAiConversationsQuery(pageId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.conversations(pageId ?? ""),
    queryFn: () => getAiConversations(pageId!),
    enabled: Boolean(pageId),
    refetchOnMount: true,
  });
}

export function useCreateAiConversationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAiConversation,
    onSuccess: (conversation) => {
      queryClient.setQueryData<AiConversation[]>(
        AI_QUERY_KEYS.conversations(conversation.pageId),
        (current = []) => [conversation, ...current],
      );
    },
  });
}

export function useUpdateAiConversationMutation(pageId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      data,
    }: {
      conversationId: string;
      data: { title?: string; draft?: string; useSpaceSearch?: boolean };
    }) => updateAiConversation(conversationId, data),
    onSuccess: (conversation) => {
      queryClient.setQueryData<AiConversation[]>(
        AI_QUERY_KEYS.conversations(pageId ?? conversation.pageId),
        (current = []) =>
          current.map((item) =>
            item.id === conversation.id ? conversation : item,
          ),
      );
    },
  });
}

export function useOpenAiConversationMutation(pageId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: openAiConversation,
    onSuccess: (conversation) => {
      queryClient.setQueryData<AiConversation[]>(
        AI_QUERY_KEYS.conversations(pageId ?? conversation.pageId),
        (current = []) =>
          current.map((item) =>
            item.id === conversation.id ? conversation : item,
          ),
      );
    },
  });
}

export function useDeleteAiConversationMutation(pageId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAiConversation,
    onSuccess: (_, conversationId) => {
      queryClient.setQueryData<AiConversation[]>(
        AI_QUERY_KEYS.conversations(pageId ?? ""),
        (current = []) => current.filter((item) => item.id !== conversationId),
      );
      queryClient.removeQueries({
        queryKey: AI_QUERY_KEYS.messages(conversationId),
      });
    },
  });
}

export function useAiMessagesQuery(conversationId?: string) {
  return useInfiniteQuery({
    queryKey: AI_QUERY_KEYS.messages(conversationId ?? ""),
    queryFn: ({ pageParam }) => getAiMessages(conversationId!, pageParam),
    enabled: Boolean(conversationId),
    refetchOnMount: true,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });
}

export function useSendAiMessageMutation() {
  const queryClient = useQueryClient();
  const setRuns = useSetAtom(aiStreamingRunsAtom);

  return useMutation({
    mutationFn: (input: SendAiMessageInput) => sendAiMessage(input),
    onSuccess: (result, input) => {
      setRuns((current) =>
        reduceAiRunState(current, {
          type: "rest",
          run: result.run,
          content: result.assistantMessage.content,
        }).runs,
      );
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.messages(input.conversationId),
      });
    },
  });
}

export function useCancelAiRunMutation() {
  const queryClient = useQueryClient();
  const setRuns = useSetAtom(aiStreamingRunsAtom);
  return useMutation({
    mutationFn: cancelAiRun,
    onSuccess: async (run) => {
      setRuns((current) =>
        reduceAiRunState(current, { type: "rest", run }).runs,
      );
      await queryClient.refetchQueries({
        queryKey: AI_QUERY_KEYS.messages(run.conversationId),
      });
      setRuns((current) =>
        reduceAiRunState(current, { type: "prune", runId: run.id }).runs,
      );
    },
  });
}

export function useRetryAiRunMutation(conversationId?: string) {
  const queryClient = useQueryClient();
  const setRuns = useSetAtom(aiStreamingRunsAtom);
  return useMutation({
    mutationFn: retryAiRun,
    onSuccess: (run) => {
      setRuns((current) =>
        reduceAiRunState(current, { type: "rest", run }).runs,
      );
      return queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.messages(conversationId ?? ""),
      });
    },
  });
}

export function useRegenerateAiMessageMutation(conversationId?: string) {
  const queryClient = useQueryClient();
  const setRuns = useSetAtom(aiStreamingRunsAtom);
  return useMutation({
    mutationFn: regenerateAiMessage,
    onSuccess: (run) => {
      setRuns((current) =>
        reduceAiRunState(current, { type: "rest", run }).runs,
      );
      return queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.messages(conversationId ?? ""),
      });
    },
  });
}

export function useAiChatFilesQuery(conversationId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.files(conversationId ?? ""),
    queryFn: () => getAiChatFiles(conversationId!),
    enabled: Boolean(conversationId),
    refetchInterval: (query) =>
      query.state.data?.some((file) =>
        ["pending", "processing"].includes(file.status),
      )
        ? 1500
        : false,
  });
}

export function useAiPageAttachmentsQuery(pageId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.pageAttachments(pageId ?? ""),
    queryFn: () => getAiPageAttachments(pageId!),
    enabled: Boolean(pageId),
  });
}

export function useUploadAiChatFilesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      files,
      idempotencyKey,
    }: {
      conversationId: string;
      files: File[];
      idempotencyKey: string;
    }) => uploadAiChatFiles(conversationId, files, idempotencyKey),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.files(variables.conversationId),
      }),
  });
}

export function useDeleteAiChatFileMutation(conversationId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => deleteAiChatFile(conversationId!, fileId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.files(conversationId ?? ""),
      }),
  });
}

export function useAiSpaceConfigQuery(spaceId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.config(spaceId ?? ""),
    queryFn: () => getAiSpaceConfig(spaceId!),
    enabled: Boolean(spaceId),
  });
}

export function useAiSpaceStatusQuery(spaceId?: string, pageId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.status(spaceId ?? "", pageId ?? ""),
    queryFn: () => getAiSpaceStatus(spaceId!, pageId),
    enabled: Boolean(spaceId),
    refetchInterval: 15000,
  });
}

export function useUpdateAiSpaceConfigMutation(spaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AiSpaceConfigUpdate) =>
      updateAiSpaceConfig(spaceId!, data),
    onSuccess: (config) => {
      queryClient.setQueryData(AI_QUERY_KEYS.config(spaceId ?? ""), config);
      queryClient.invalidateQueries({
        queryKey: ["ai", "status", spaceId ?? ""],
      });
    },
  });
}

export function useTestAiModelConfigMutation(spaceId?: string) {
  return useMutation({
    mutationFn: (data?: AiSpaceConfigUpdate) =>
      testAiModelConfig(spaceId!, data),
  });
}

export function useTestAiRetrievalConfigMutation(spaceId?: string) {
  return useMutation({
    mutationFn: (data?: AiSpaceConfigUpdate) =>
      testAiRetrievalConfig(spaceId!, data),
  });
}
