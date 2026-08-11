import {
  useMutation,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import {
  cancelAiRun,
  approveAiRunStep,
  createAiConversation,
  deleteAiChatFile,
  deleteAiConversation,
  getAiChatFiles,
  getAiConversations,
  getAiMessages,
  getAiRun,
  getAiPageAttachments,
  getAiSpaceConfig,
  getAiSpaceStatus,
  openAiConversation,
  regenerateAiMessage,
  retryAiRun,
  rejectAiRunStep,
  sendAiMessage,
  testAiModelConfig,
  testAiRetrievalConfig,
  testAiAgentConfig,
  updateAiConversation,
  updateAiSpaceConfig,
  uploadAiChatFiles,
  getAiConversationContext,
  getAiContextDescendants,
  getAiSpaceContentPolicy,
  searchAiSpaceContentPolicyCandidates,
  updateAiConversationContext,
  updateAiSpaceContentPolicy,
  searchAiContextSources,
  createAiEditorAction,
  cancelAiEditorAction,
  createAiAssistantProfile,
  deleteAiAssistantProfile,
  getAiAssistantProfile,
  getAiAssistantProfilePreferences,
  getAiAssistantProfilePolicy,
  getAiAssistantProfiles,
  testAiAssistantProfileAgent,
  testAiAssistantProfileModel,
  updateAiAssistantProfile,
  updateAiAssistantProfilePolicy,
  updateAiAssistantProfilePreferences,
} from "@/features/ai/services/ai-service.ts";
import {
  AiAvailability,
  AiConversation,
  AiSpaceConfigUpdate,
  SendAiMessageInput,
  UpdateAiConversationContextRequest,
  UpdateAiSpaceContentPolicyRequest,
  CreateAiAssistantProfileRequest,
  UpdateAiAssistantProfileRequest,
  UpdateAiAssistantProfilePreferencesRequest,
  UpdateAiAssistantProfileWorkspacePolicyRequest,
} from "@/features/ai/types/ai.types.ts";
import {
  aiActivityAtom,
  aiStreamingRunsAtom,
} from "@/features/ai/atoms/ai-atoms.ts";
import { reduceAiRunState } from "@/features/ai/utils/ai-run-state.ts";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";

export const AI_QUERY_KEYS = {
  conversations: (pageId: string) => ["ai", "conversations", pageId] as const,
  messages: (conversationId: string) =>
    ["ai", "messages", conversationId] as const,
  run: (runId: string) => ["ai", "run", runId] as const,
  files: (conversationId: string) => ["ai", "files", conversationId] as const,
  context: (conversationId: string) =>
    ["ai", "context", conversationId] as const,
  contextSources: (conversationId: string, query: string) =>
    ["ai", "context-sources", conversationId, query] as const,
  contextDescendants: (conversationId: string, parentPageId: string) =>
    ["ai", "context-descendants", conversationId, parentPageId] as const,
  pageAttachments: (pageId: string) =>
    ["ai", "page-attachments", pageId] as const,
  config: (spaceId: string) => ["ai", "config", spaceId] as const,
  status: (spaceId: string, pageId = "") =>
    ["ai", "status", spaceId, pageId] as const,
  contentPolicy: (spaceId: string) =>
    ["ai", "content-policy", spaceId] as const,
  contentPolicyCandidates: (spaceId: string, query: string) =>
    ["ai", "content-policy-candidates", spaceId, query] as const,
  profilePolicy: ["ai", "assistant-profile-policy"] as const,
  profiles: (spaceId: string) => ["ai", "assistant-profiles", spaceId] as const,
  profile: (spaceId: string, profileId: string) =>
    ["ai", "assistant-profile", spaceId, profileId] as const,
  profilePreferences: (spaceId: string) =>
    ["ai", "assistant-profile-preferences", spaceId] as const,
};

export function useAiAssistantProfilePolicyQuery(enabled = true) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.profilePolicy,
    queryFn: getAiAssistantProfilePolicy,
    enabled,
  });
}

export function useUpdateAiAssistantProfilePolicyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateAiAssistantProfileWorkspacePolicyRequest) =>
      updateAiAssistantProfilePolicy(data),
    onSuccess: (policy) => {
      queryClient.setQueryData(AI_QUERY_KEYS.profilePolicy, policy);
      void queryClient.invalidateQueries({
        queryKey: ["ai", "assistant-profiles"],
      });
    },
  });
}

export function useAiAssistantProfilesQuery(spaceId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.profiles(spaceId ?? ""),
    queryFn: () => getAiAssistantProfiles(spaceId!),
    enabled: Boolean(spaceId),
  });
}

export function useAiAssistantProfilePreferencesQuery(spaceId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.profilePreferences(spaceId ?? ""),
    queryFn: () => getAiAssistantProfilePreferences(spaceId!),
    enabled: Boolean(spaceId),
  });
}

export function useAiAssistantProfileQuery(
  spaceId?: string,
  profileId?: string,
) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.profile(spaceId ?? "", profileId ?? ""),
    queryFn: () => getAiAssistantProfile(spaceId!, profileId!),
    enabled: Boolean(spaceId && profileId),
  });
}

export function useCreateAiAssistantProfileMutation(spaceId: string) {
  const queryClient = useQueryClient();
  const emit = useQueryEmit();
  return useMutation({
    mutationFn: (data: CreateAiAssistantProfileRequest) =>
      createAiAssistantProfile(spaceId, data),
    onSuccess: (profile) => {
      queryClient.setQueryData(
        AI_QUERY_KEYS.profile(spaceId, profile.id),
        profile,
      );
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.profiles(spaceId)],
      });
      return queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.profiles(spaceId),
      });
    },
  });
}

export function useUpdateAiAssistantProfileMutation(spaceId: string) {
  const queryClient = useQueryClient();
  const emit = useQueryEmit();
  return useMutation({
    mutationFn: ({
      profileId,
      data,
    }: {
      profileId: string;
      data: UpdateAiAssistantProfileRequest;
    }) => updateAiAssistantProfile(spaceId, profileId, data),
    onSuccess: (profile) => {
      queryClient.setQueryData(
        AI_QUERY_KEYS.profile(spaceId, profile.id),
        profile,
      );
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.profiles(spaceId),
      });
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.profile(spaceId, profile.id)],
      });
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.profiles(spaceId)],
      });
    },
  });
}

export function useDeleteAiAssistantProfileMutation(spaceId: string) {
  const queryClient = useQueryClient();
  const emit = useQueryEmit();
  return useMutation({
    mutationFn: (profileId: string) =>
      deleteAiAssistantProfile(spaceId, profileId),
    onSuccess: async (_, profileId) => {
      queryClient.removeQueries({
        queryKey: AI_QUERY_KEYS.profile(spaceId, profileId),
      });
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.profile(spaceId, profileId)],
      });
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.profiles(spaceId)],
      });
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.profilePreferences(spaceId)],
      });
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.config(spaceId)],
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: AI_QUERY_KEYS.profiles(spaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: AI_QUERY_KEYS.profilePreferences(spaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: AI_QUERY_KEYS.config(spaceId),
        }),
      ]);
    },
  });
}

export function useTestAiAssistantProfileModelMutation(spaceId: string) {
  return useMutation({
    mutationFn: (profileId: string) =>
      testAiAssistantProfileModel(spaceId, profileId),
  });
}

export function useTestAiAssistantProfileAgentMutation(spaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) =>
      testAiAssistantProfileAgent(spaceId, profileId),
    onSuccess: (_, profileId) => {
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.profile(spaceId, profileId),
      });
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.profiles(spaceId),
      });
    },
  });
}

export function useUpdateAiAssistantProfilePreferencesMutation(
  spaceId: string,
) {
  const queryClient = useQueryClient();
  const emit = useQueryEmit();
  return useMutation({
    mutationFn: (data: UpdateAiAssistantProfilePreferencesRequest) =>
      updateAiAssistantProfilePreferences(spaceId, data),
    onSuccess: (preferences) => {
      queryClient.setQueryData(
        AI_QUERY_KEYS.profilePreferences(spaceId),
        preferences,
      );
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.profilePreferences(spaceId)],
      });
      emit({
        operation: "invalidate",
        spaceId,
        entity: [...AI_QUERY_KEYS.profiles(spaceId)],
      });
      return queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.profiles(spaceId),
      });
    },
  });
}

export function useAiConversationContextQuery(conversationId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.context(conversationId ?? ""),
    queryFn: () => getAiConversationContext(conversationId!),
    enabled: Boolean(conversationId),
  });
}

export function useUpdateAiConversationContextMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      data,
    }: {
      conversationId: string;
      data: UpdateAiConversationContextRequest;
    }) => updateAiConversationContext(conversationId, data),
    onSuccess: (context) => {
      queryClient.setQueryData(
        AI_QUERY_KEYS.context(context.conversationId),
        context,
      );
      void queryClient.invalidateQueries({
        queryKey: ["ai", "conversations"],
      });
    },
  });
}

export function useAiContextSourcesQuery(
  conversationId: string | undefined,
  query: string,
) {
  return useInfiniteQuery({
    queryKey: AI_QUERY_KEYS.contextSources(conversationId ?? "", query),
    queryFn: ({ pageParam }) =>
      searchAiContextSources({
        conversationId: conversationId!,
        query,
        cursor: pageParam,
      }),
    enabled: Boolean(conversationId && query.trim()),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });
}

export function useAiContextDescendantsQuery(
  conversationId: string | undefined,
  parentPageId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.contextDescendants(
      conversationId ?? "",
      parentPageId ?? "",
    ),
    queryFn: () =>
      getAiContextDescendants({
        conversationId: conversationId!,
        parentPageId: parentPageId!,
      }),
    enabled: Boolean(enabled && conversationId && parentPageId),
  });
}

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
      data: {
        title?: string;
        draft?: string;
        useSpaceSearch?: boolean;
        agentMode?: boolean;
        assistantProfileId?: string | null;
      };
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
  const setActivity = useSetAtom(aiActivityAtom);

  return useMutation({
    mutationFn: (input: SendAiMessageInput) => sendAiMessage(input),
    onSuccess: (result, input) => {
      setRuns(
        (current) =>
          reduceAiRunState(current, {
            type: "rest",
            run: result.run,
            content: result.assistantMessage.content,
            reasoning: result.assistantMessage.reasoning ?? "",
          }).runs,
      );
      setActivity((current) => ({
        ...current,
        [result.run.id]: {
          runId: result.run.id,
          conversationId: result.run.conversationId,
          pageId: input.pageId,
          pageTitle: input.pageTitle,
          pageHref: input.pageHref,
          status: result.run.status,
          unread: false,
          updatedAt: new Date().toISOString(),
        },
      }));
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
      setRuns(
        (current) => reduceAiRunState(current, { type: "rest", run }).runs,
      );
      if (!["completed", "failed", "cancelled"].includes(run.status)) {
        return;
      }
      await queryClient.refetchQueries({
        queryKey: AI_QUERY_KEYS.messages(run.conversationId),
      });
      setRuns(
        (current) =>
          reduceAiRunState(current, { type: "prune", runId: run.id }).runs,
      );
    },
  });
}

export function useAiRunQuery(runId?: string, enabled = true) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.run(runId ?? ""),
    queryFn: () => getAiRun(runId!),
    enabled: Boolean(enabled && runId),
  });
}

export function useApproveAiRunStepMutation() {
  const queryClient = useQueryClient();
  const setRuns = useSetAtom(aiStreamingRunsAtom);
  return useMutation({
    mutationFn: approveAiRunStep,
    onSuccess: ({ run }) => {
      setRuns(
        (current) => reduceAiRunState(current, { type: "rest", run }).runs,
      );
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.run(run.id),
      });
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.messages(run.conversationId),
      });
    },
  });
}

export function useRejectAiRunStepMutation() {
  const queryClient = useQueryClient();
  const setRuns = useSetAtom(aiStreamingRunsAtom);
  return useMutation({
    mutationFn: rejectAiRunStep,
    onSuccess: ({ run }) => {
      setRuns(
        (current) => reduceAiRunState(current, { type: "rest", run }).runs,
      );
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.run(run.id),
      });
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.messages(run.conversationId),
      });
    },
  });
}

export function useCreateAiEditorActionMutation() {
  return useMutation({ mutationFn: createAiEditorAction });
}

export function useCancelAiEditorActionMutation() {
  return useMutation({ mutationFn: cancelAiEditorAction });
}

export function useRetryAiRunMutation(conversationId?: string) {
  const queryClient = useQueryClient();
  const setRuns = useSetAtom(aiStreamingRunsAtom);
  return useMutation({
    mutationFn: retryAiRun,
    onSuccess: (run) => {
      setRuns(
        (current) => reduceAiRunState(current, { type: "rest", run }).runs,
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
      setRuns(
        (current) => reduceAiRunState(current, { type: "rest", run }).runs,
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

export function useAiSpaceContentPolicyQuery(spaceId?: string) {
  return useQuery({
    queryKey: AI_QUERY_KEYS.contentPolicy(spaceId ?? ""),
    queryFn: () => getAiSpaceContentPolicy(spaceId!),
    enabled: Boolean(spaceId),
  });
}

export function useAiSpaceContentPolicyCandidatesQuery(
  spaceId: string | undefined,
  query: string,
) {
  return useInfiniteQuery({
    queryKey: AI_QUERY_KEYS.contentPolicyCandidates(spaceId ?? "", query),
    queryFn: ({ pageParam }) =>
      searchAiSpaceContentPolicyCandidates({
        spaceId: spaceId!,
        query,
        cursor: pageParam,
      }),
    enabled: Boolean(spaceId && query.trim()),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });
}

export function useUpdateAiSpaceContentPolicyMutation(spaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateAiSpaceContentPolicyRequest) =>
      updateAiSpaceContentPolicy(spaceId!, data),
    onSuccess: (policy) => {
      queryClient.setQueryData(
        AI_QUERY_KEYS.contentPolicy(spaceId ?? policy.spaceId),
        policy,
      );
      void queryClient.invalidateQueries({
        queryKey: ["ai", "status", policy.spaceId],
      });
    },
  });
}

export function useUpdateAiSpaceConfigMutation(spaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AiSpaceConfigUpdate) =>
      updateAiSpaceConfig(spaceId!, data),
    onSuccess: (config) => {
      const effectiveSpaceId = spaceId ?? config.spaceId;
      queryClient.setQueryData(AI_QUERY_KEYS.config(effectiveSpaceId), config);
      queryClient.setQueriesData<AiAvailability>(
        { queryKey: ["ai", "status", effectiveSpaceId] },
        (status) =>
          status
            ? {
                ...status,
                assistantIdentity:
                  config.assistantNameEnabled && config.assistantName
                    ? {
                        name: config.assistantName,
                        gender: config.assistantGender,
                      }
                    : null,
              }
            : status,
      );
      void queryClient.invalidateQueries({
        queryKey: ["ai", "status", effectiveSpaceId],
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

export function useTestAiAgentConfigMutation(spaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data?: AiSpaceConfigUpdate) =>
      testAiAgentConfig(spaceId!, data),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.config(spaceId ?? ""),
      }),
  });
}
