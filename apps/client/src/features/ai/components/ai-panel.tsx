import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Drawer,
  Group,
  Loader,
  Menu,
  Modal,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconCheck,
  IconChevronDown,
  IconDots,
  IconMessagePlus,
  IconPaperclip,
  IconPencil,
  IconPlayerStop,
  IconPlus,
  IconRobot,
  IconSearch,
  IconSend,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useAtomValue, useSetAtom } from "jotai";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import clsx from "clsx";
import { useDrop } from "react-dnd";
import {
  pageEditorAtom,
  titleEditorAtom,
} from "@/features/editor/atoms/editor-atoms.ts";
import {
  aiDocumentContextAtom,
  aiActivityAtom,
  aiLastEditorContextAtom,
  aiStreamingRunsAtom,
  aiUnreadRunsAtom,
} from "@/features/ai/atoms/ai-atoms.ts";
import {
  useAiChatFilesQuery,
  useAiConversationsQuery,
  useAiMessagesQuery,
  useAiPageAttachmentsQuery,
  useAiSpaceStatusQuery,
  useAiConversationContextQuery,
  useUpdateAiConversationContextMutation,
  useCancelAiRunMutation,
  useCreateAiConversationMutation,
  useDeleteAiChatFileMutation,
  useDeleteAiConversationMutation,
  useRegenerateAiMessageMutation,
  useRetryAiRunMutation,
  useSendAiMessageMutation,
  useUploadAiChatFilesMutation,
  useOpenAiConversationMutation,
  useUpdateAiConversationMutation,
  useAiRunQuery,
  useApproveAiRunStepMutation,
  useRejectAiRunStepMutation,
} from "@/features/ai/queries/ai-query.ts";
import {
  AiConversation,
  AiConversationContext,
  AiContextSource,
  AiDescendantSelection,
  AiMessage,
  AiStreamingRun,
} from "@/features/ai/types/ai.types.ts";
import { captureAiEditorContext } from "@/features/ai/utils/editor-context.ts";
import { AiMessageCard } from "./ai-message-card.tsx";
import { AiReasoningDisclosure } from "./ai-reasoning-disclosure.tsx";
import classes from "./ai-panel.module.css";
import { DEFAULT_AI_QUICK_COMMANDS } from "@/features/ai/constants/quick-commands.ts";
import {
  getPersistedActiveRun,
  getLatestAiConversation,
  mergeAiQuickCommands,
  shouldShowAiRetrievalUi,
  shouldShowAiPanelLoadFailure,
  sortAiMessagesChronologically,
} from "@/features/ai/utils/ai-policies.ts";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";
import { AiContextPicker } from "./ai-context-picker.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { useEditorState } from "@tiptap/react";
import { getAiConversationContext } from "@/features/ai/services/ai-service.ts";
import { AI_QUERY_KEYS } from "@/features/ai/queries/ai-query.ts";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import {
  findTreeNodeById,
  treeNodeToContextSource,
} from "@/features/ai/utils/ai-context.ts";
import {
  createTreeExternalDropResult,
  type TreeExternalDropResult,
} from "@/features/page/tree/utils";
import { isAiChatNearBottom } from "@/features/ai/utils/ai-scroll.ts";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { clearAiPageActivity } from "@/features/ai/utils/ai-activity.ts";
import { resolveAiAssistantText } from "@/features/ai/utils/ai-identity.ts";
import { AiApprovalPreview } from "./ai-approval-preview.tsx";
import {
  getAiLocalDraftKey,
  readAiLocalDraft,
  writeAiLocalDraft,
} from "@/features/ai/utils/ai-local-draft.ts";
import {
  userAtom,
  workspaceAtom,
} from "@/features/user/atoms/current-user-atom.ts";

export function AiPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const isCompactMobile = useMediaQuery("(max-width: 30em)");
  const documentContext = useAtomValue(aiDocumentContextAtom);
  const user = useAtomValue(userAtom);
  const workspace = useAtomValue(workspaceAtom);
  const asideState = useAtomValue(asideStateAtom);
  const tree = useAtomValue(treeDataAtom);
  const editor = useAtomValue(pageEditorAtom);
  const titleEditor = useAtomValue(titleEditorAtom);
  const liveDocumentTitle = useEditorState({
    editor: titleEditor,
    selector: ({ editor: currentTitleEditor }) =>
      currentTitleEditor?.getText().trim() ?? "",
  });
  const streamingRuns = useAtomValue(aiStreamingRunsAtom);
  const setStreamingRuns = useSetAtom(aiStreamingRunsAtom);
  const setActivity = useSetAtom(aiActivityAtom);
  const setUnreadRuns = useSetAtom(aiUnreadRunsAtom);
  const editorContexts = useAtomValue(aiLastEditorContextAtom);
  const setEditorContexts = useSetAtom(aiLastEditorContextAtom);
  const pageId = documentContext?.pageId;
  const spaceId = documentContext?.spaceId;
  const conversationsQuery = useAiConversationsQuery(pageId);
  const availabilityQuery = useAiSpaceStatusQuery(spaceId, pageId);
  const [activeByPage, setActiveByPage] = useState<
    Record<string, string | null>
  >({});
  const activeSelection = pageId ? activeByPage[pageId] : undefined;
  const activeConversationId =
    typeof activeSelection === "string" ? activeSelection : undefined;
  const isLocalDraft = activeSelection === null;
  const conversations = conversationsQuery.data ?? [];
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const messagesQuery = useAiMessagesQuery(activeConversationId);
  const contextQuery = useAiConversationContextQuery(activeConversationId);
  const filesQuery = useAiChatFilesQuery(activeConversationId);
  const pageAttachmentsQuery = useAiPageAttachmentsQuery(pageId);
  const createConversation = useCreateAiConversationMutation();
  const updateConversation = useUpdateAiConversationMutation(pageId);
  const { mutate: touchConversation } = useOpenAiConversationMutation(pageId);
  const deleteConversation = useDeleteAiConversationMutation(pageId);
  const sendMessage = useSendAiMessageMutation();
  const uploadFilesMutation = useUploadAiChatFilesMutation();
  const updateContext = useUpdateAiConversationContextMutation();
  const cancelRun = useCancelAiRunMutation();
  const retryRun = useRetryAiRunMutation(activeConversationId);
  const regenerateMessage =
    useRegenerateAiMessageMutation(activeConversationId);
  const deleteFile = useDeleteAiChatFileMutation(activeConversationId);
  const [draft, setDraft] = useState("");
  const [useSpaceSearch, setUseSpaceSearch] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [renameOpened, setRenameOpened] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [quickCommandQuery, setQuickCommandQuery] = useState("");
  const [quickCommandsOpened, setQuickCommandsOpened] = useState(false);
  const [historyOpened, setHistoryOpened] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [draftStatus, setDraftStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [contextSaveFailed, setContextSaveFailed] = useState(false);
  const [contextManagerOpened, setContextManagerOpened] = useState(false);
  const [pendingDroppedSource, setPendingDroppedSource] =
    useState<AiContextSource | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const draftHydratedFor = useRef<string | null>(null);
  const ensureConversationRef = useRef<Promise<AiConversation> | null>(null);
  const draftSaveChain = useRef<Promise<unknown>>(Promise.resolve());
  const contextSaveChain = useRef<Promise<AiConversationContext> | null>(null);
  const lastContextTransformRef = useRef<
    ((current: AiConversationContext) => AiConversationContext) | null
  >(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const followOutputRef = useRef(true);

  const activeRuns = useMemo(
    () =>
      Object.values(streamingRuns).filter(
        (run) => run.conversationId === activeConversationId,
      ),
    [activeConversationId, streamingRuns],
  );
  const persistedActiveRun = useMemo(() => {
    return getPersistedActiveRun(
      messagesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    );
  }, [messagesQuery.data]);
  const persistedRunState = persistedActiveRun
    ? streamingRuns[persistedActiveRun.runId]
    : undefined;
  const pendingRun =
    activeRuns.find((run) =>
      ["queued", "running", "awaiting_approval"].includes(run.status),
    ) ??
    (persistedActiveRun && !persistedRunState ? persistedActiveRun : undefined);
  const pendingRunQuery = useAiRunQuery(
    pendingRun?.runId,
    pendingRun?.status === "awaiting_approval",
  );
  const approveStep = useApproveAiRunStepMutation();
  const rejectStep = useRejectAiRunStepMutation();
  const pendingApproval = pendingRunQuery.data?.steps?.find(
    (step) => step.status === "pending_approval",
  );
  const chatFiles = filesQuery.data ?? [];
  const pageAttachments = pageAttachmentsQuery.data ?? [];
  const context = contextQuery.data;
  const selectedFilesAreReady = (context?.fileIds ?? []).every((fileId) =>
    chatFiles.some((file) => file.id === fileId && file.status === "ready"),
  );
  const documentTitle =
    liveDocumentTitle || documentContext?.title?.trim() || t("ai.untitled");
  const localDraftKey =
    workspace?.id && user?.id && pageId
      ? getAiLocalDraftKey(workspace.id, user.id, pageId)
      : null;

  useEffect(() => {
    if (!pageId || asideState.tab !== "ai" || !asideState.isAsideOpen) {
      return;
    }
    setUnreadRuns((current) => {
      if (!current[pageId]) return current;
      const next = { ...current };
      delete next[pageId];
      return next;
    });
    setActivity((current) => clearAiPageActivity(current, pageId));
  }, [
    asideState.isAsideOpen,
    asideState.tab,
    pageId,
    setActivity,
    setUnreadRuns,
  ]);

  useEffect(() => {
    if (!persistedActiveRun) {
      return;
    }
    setStreamingRuns((current) => {
      const existing = current[persistedActiveRun.runId];
      if (existing && existing.sequence >= persistedActiveRun.sequence) {
        return current;
      }
      return {
        ...current,
        [persistedActiveRun.runId]: persistedActiveRun,
      };
    });
  }, [persistedActiveRun, setStreamingRuns]);

  useEffect(() => {
    if (
      !pageId ||
      activeByPage[pageId] !== undefined ||
      conversationsQuery.isLoading
    ) {
      return;
    }
    const latest = getLatestAiConversation(conversations);
    if (latest) {
      setActiveByPage((current) => ({ ...current, [pageId]: latest.id }));
      touchConversation(latest.id);
    } else {
      setActiveByPage((current) => ({ ...current, [pageId]: null }));
    }
  }, [
    activeByPage,
    conversations,
    conversationsQuery.isLoading,
    pageId,
    touchConversation,
  ]);

  useEffect(() => {
    if (!activeConversation) {
      if (!isLocalDraft || !localDraftKey) {
        return;
      }
      const marker = `local:${localDraftKey}`;
      if (draftHydratedFor.current !== marker) {
        const saved = readAiLocalDraft(sessionStorage, localDraftKey);
        const defaultAgentMode =
          availabilityQuery.data?.agentAvailable === true &&
          availabilityQuery.data?.canUse !== true;
        setDraft(saved?.text ?? "");
        setUseSpaceSearch(saved?.useSpaceSearch ?? false);
        setAgentMode(saved?.agentMode ?? defaultAgentMode);
        draftHydratedFor.current = marker;
      }
      contextSaveChain.current = null;
      return;
    }
    const shouldHydrateDraft =
      draftHydratedFor.current !== activeConversation.id;
    draftHydratedFor.current = activeConversation.id;
    if (shouldHydrateDraft) {
      setDraft(activeConversation.draft ?? "");
    }
    setDraftStatus("idle");
    setUseSpaceSearch(Boolean(activeConversation.useSpaceSearch));
    setAgentMode(Boolean(activeConversation.agentMode));
    contextSaveChain.current = null;
    setContextSaveFailed(false);
  }, [
    activeConversation,
    availabilityQuery.data?.agentAvailable,
    availabilityQuery.data?.canUse,
    isLocalDraft,
    localDraftKey,
  ]);

  useEffect(() => {
    if (
      !isLocalDraft ||
      !localDraftKey ||
      draftHydratedFor.current !== `local:${localDraftKey}`
    ) {
      return;
    }
    writeAiLocalDraft(sessionStorage, localDraftKey, {
      text: draft,
      useSpaceSearch,
      agentMode,
    });
  }, [agentMode, draft, isLocalDraft, localDraftKey, useSpaceSearch]);

  useEffect(() => {
    if (
      !activeConversation &&
      availabilityQuery.data?.agentAvailable === true &&
      availabilityQuery.data?.canUse !== true
    ) {
      setAgentMode(true);
    }
  }, [
    activeConversation,
    availabilityQuery.data?.agentAvailable,
    availabilityQuery.data?.canUse,
  ]);

  useEffect(() => {
    if (
      !activeConversation ||
      draftHydratedFor.current !== activeConversation.id ||
      draft === (activeConversation.draft ?? "")
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDraftStatus("saving");
      draftSaveChain.current = draftSaveChain.current
        .catch(() => undefined)
        .then(() =>
          updateConversation.mutateAsync({
            conversationId: activeConversation.id,
            data: { draft },
          }),
        )
        .then(() => setDraftStatus("saved"))
        .catch(() => {
          setDraftStatus("error");
        });
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [activeConversation, draft, updateConversation]);

  useEffect(() => {
    followOutputRef.current = true;
    setShowJumpToLatest(false);
  }, [activeConversationId]);

  useEffect(() => {
    if (!followOutputRef.current) {
      setShowJumpToLatest(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (viewport && followOutputRef.current) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
        setShowJumpToLatest(false);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeConversationId,
    messagesQuery.data?.pages[0]?.items.at(-1)?.id,
    pendingRun?.content,
    pendingRun?.reasoning,
  ]);

  const ensureConversation = async (): Promise<AiConversation> => {
    if (activeConversation) {
      return activeConversation;
    }
    if (ensureConversationRef.current) {
      return ensureConversationRef.current;
    }
    if (!pageId) {
      throw new Error("Page context is missing");
    }

    const creation = createConversation
      .mutateAsync({
        pageId,
        clientRequestId: crypto.randomUUID(),
        useSpaceSearch,
        agentMode,
      })
      .then((conversation) => {
        draftHydratedFor.current = conversation.id;
        if (localDraftKey) {
          sessionStorage.removeItem(localDraftKey);
        }
        setActiveByPage((current) => ({
          ...current,
          [pageId]: conversation.id,
        }));
        return conversation;
      });
    ensureConversationRef.current = creation;
    try {
      return await creation;
    } finally {
      if (ensureConversationRef.current === creation) {
        ensureConversationRef.current = null;
      }
    }
  };

  const loadContext = async (
    conversation: AiConversation,
  ): Promise<AiConversationContext> => {
    const pending = contextSaveChain.current;
    if (pending) return pending;
    const cached = queryClient.getQueryData<AiConversationContext>(
      AI_QUERY_KEYS.context(conversation.id),
    );
    if (cached) return cached;
    return queryClient.fetchQuery({
      queryKey: AI_QUERY_KEYS.context(conversation.id),
      queryFn: () => getAiConversationContext(conversation.id),
    });
  };

  const saveContext = async (
    transform: (current: AiConversationContext) => AiConversationContext,
  ): Promise<AiConversationContext> => {
    lastContextTransformRef.current = transform;
    setContextSaveFailed(false);
    const conversation = await ensureConversation();
    const previous = contextSaveChain.current;
    const operation = (previous ?? loadContext(conversation))
      .catch(() => getAiConversationContext(conversation.id))
      .then((current) => {
        const next = transform(current);
        return updateContext.mutateAsync({
          conversationId: conversation.id,
          data: {
            expectedRevision: current.revision,
            includeCurrentDocument: next.includeCurrentDocument,
            currentDocumentDescendants: next.currentDocumentDescendants,
            sources: next.sources.map((source) => ({
              sourceType: source.sourceType,
              sourceId: source.sourceId,
              descendants: source.descendants,
            })),
            fileIds: next.fileIds,
            attachmentIds: next.attachmentIds,
          },
        });
      });
    contextSaveChain.current = operation;
    try {
      const result = await operation;
      setContextSaveFailed(false);
      return result;
    } catch (error) {
      setContextSaveFailed(true);
      notifications.show({
        message: resolveAiErrorMessage(
          t,
          i18n,
          error?.["response"]?.data?.code,
        ),
        color: "red",
      });
      throw error;
    } finally {
      if (contextSaveChain.current === operation) {
        contextSaveChain.current = null;
      }
    }
  };

  const retryDraftSave = async () => {
    if (!activeConversation) return;
    setDraftStatus("saving");
    try {
      await updateConversation.mutateAsync({
        conversationId: activeConversation.id,
        data: { draft },
      });
      setDraftStatus("saved");
    } catch {
      setDraftStatus("error");
    }
  };

  const retryContextSave = async () => {
    const transform = lastContextTransformRef.current;
    if (!transform) return;
    try {
      await saveContext(transform);
    } catch {
      // The inline retry remains available after a repeated failure.
    }
  };

  const trackRunActivity = (run: {
    id: string;
    conversationId: string;
    status: AiStreamingRun["status"];
  }) => {
    if (!pageId) return;
    setActivity((current) => ({
      ...current,
      [run.id]: {
        runId: run.id,
        conversationId: run.conversationId,
        pageId,
        pageTitle: documentTitle,
        pageHref: window.location.pathname,
        status: run.status,
        unread: false,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const submit = async (content: string) => {
    const normalizedContent = content.trim();
    if (
      !normalizedContent ||
      (!documentContext?.canWrite && !agentMode) ||
      !editor ||
      sendMessage.isPending ||
      Boolean(pendingRun) ||
      !selectedFilesAreReady
    ) {
      if (!editor) {
        notifications.show({
          message: t("ai.editorUnavailable"),
          color: "red",
        });
      } else if (!selectedFilesAreReady) {
        notifications.show({
          message: t("ai.fileUploading"),
          color: "blue",
        });
      }
      return;
    }

    try {
      const conversation = await ensureConversation();
      const savedContext = await loadContext(conversation);
      const editorContext = captureAiEditorContext(
        editor,
        documentContext.pageId,
      );
      const result = await sendMessage.mutateAsync({
        conversationId: conversation.id,
        content: normalizedContent,
        pageId: documentContext.pageId,
        clientRequestId: crypto.randomUUID(),
        contextRevision: savedContext.revision,
        useSpaceSearch:
          useSpaceSearch && availabilityQuery.data?.retrievalAvailable === true,
        editorContext,
        pageTitle: documentTitle,
        pageHref: window.location.pathname,
      });

      setEditorContexts((current) => ({
        ...current,
        [conversation.id]: editorContext,
        [result.run.id]: editorContext,
        [result.assistantMessage.id]: editorContext,
      }));
      setDraft("");
      updateConversation.mutate({
        conversationId: conversation.id,
        data: { draft: "" },
      });
    } catch (error) {
      if (
        error?.["response"]?.data?.code === "ai_context_resolved_source_limit"
      ) {
        setContextManagerOpened(true);
      }
      notifications.show({
        message: resolveAiErrorMessage(
          t,
          i18n,
          error?.["response"]?.data?.code,
        ),
        color: "red",
      });
    }
  };

  const handleQuickCommand = (prompt: string) => void submit(prompt);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit(draft);
    }
  };

  const selectConversation = (conversationId: string | null) => {
    if (!pageId || !conversationId) {
      return;
    }
    const select = () => {
      setActiveByPage((current) => ({ ...current, [pageId]: conversationId }));
      touchConversation(conversationId);
    };
    if (isLocalDraft && draft.trim()) {
      modals.openConfirmModal({
        title: t("ai.agent.discardDraft"),
        children: <Text size="sm">{t("ai.agent.discardDraftConfirm")}</Text>,
        labels: {
          confirm: t("ai.agent.discard"),
          cancel: t("ai.cancel"),
        },
        confirmProps: { color: "red" },
        onConfirm: select,
      });
      return;
    }
    select();
  };

  const createNewConversation = () => {
    if (!pageId) {
      return;
    }
    const beginDraft = () => {
      if (localDraftKey) {
        sessionStorage.removeItem(localDraftKey);
        draftHydratedFor.current = `local:${localDraftKey}`;
      }
      ensureConversationRef.current = null;
      setActiveByPage((current) => ({ ...current, [pageId]: null }));
      setDraft("");
      setDraftStatus("idle");
      setUseSpaceSearch(false);
      setAgentMode(
        availabilityQuery.data?.agentAvailable === true &&
          availabilityQuery.data?.canUse !== true,
      );
      setContextSaveFailed(false);
      contextSaveChain.current = null;
    };
    if (draft.trim()) {
      modals.openConfirmModal({
        title: t("ai.agent.discardDraft"),
        children: <Text size="sm">{t("ai.agent.discardDraftConfirm")}</Text>,
        labels: {
          confirm: t("ai.agent.discard"),
          cancel: t("ai.cancel"),
        },
        confirmProps: { color: "red" },
        onConfirm: beginDraft,
      });
      return;
    }
    beginDraft();
  };

  const confirmDeleteConversation = () => {
    if (!activeConversation) {
      return;
    }
    modals.openConfirmModal({
      title: t("ai.deleteChat"),
      children: <Text size="sm">{t("ai.deleteChatConfirm")}</Text>,
      labels: { confirm: t("ai.delete"), cancel: t("ai.cancel") },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        await deleteConversation.mutateAsync(activeConversation.id);
        if (pageId) {
          setActiveByPage((current) => {
            const next = { ...current };
            delete next[pageId];
            return next;
          });
        }
      },
    });
  };

  const saveRename = async () => {
    if (!activeConversation || !renameValue.trim()) {
      return;
    }
    try {
      await updateConversation.mutateAsync({
        conversationId: activeConversation.id,
        data: { title: renameValue.trim() },
      });
      setRenameOpened(false);
    } catch {
      notifications.show({
        message: t("ai.renameChatFailed"),
        color: "red",
      });
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    try {
      const conversation = await ensureConversation();
      const batch = await uploadFilesMutation.mutateAsync({
        conversationId: conversation.id,
        files,
        idempotencyKey: crypto.randomUUID(),
      });
      const uploadedIds = batch.files.map((file) => file.id);
      await saveContext((current) => ({
        ...current,
        fileIds: [...new Set([...current.fileIds, ...uploadedIds])].slice(
          0,
          10,
        ),
      }));
    } catch (error) {
      notifications.show({
        message: resolveAiErrorMessage(
          t,
          i18n,
          error?.["response"]?.data?.code ?? "ai_file_upload_failed",
        ),
        color: "red",
      });
    }
  };

  const toggleSpaceSearch = (checked: boolean) => {
    setUseSpaceSearch(checked);
    if (activeConversation) {
      updateConversation.mutate({
        conversationId: activeConversation.id,
        data: { useSpaceSearch: checked },
      });
    }
  };

  const toggleAgentMode = (checked: boolean) => {
    setAgentMode(checked);
    if (activeConversation) {
      updateConversation.mutate(
        {
          conversationId: activeConversation.id,
          data: { agentMode: checked },
        },
        {
          onError: (error) => {
            setAgentMode(!checked);
            notifications.show({
              message: resolveAiErrorMessage(
                t,
                i18n,
                error?.["response"]?.data?.code,
              ),
              color: "red",
            });
          },
        },
      );
    }
  };

  const toggleCurrentDocument = (included: boolean) =>
    saveContext((current) => {
      const duplicate = current.sources.find(
        (source) => source.pageId === pageId,
      );
      return {
        ...current,
        includeCurrentDocument: included,
        currentDocumentDescendants:
          included &&
          duplicate &&
          current.currentDocumentDescendants.mode === "none"
            ? duplicate.descendants
            : current.currentDocumentDescendants,
        sources: included
          ? current.sources
              .filter((source) => source.pageId !== pageId)
              .map((source, position) => ({ ...source, position }))
          : current.sources,
      };
    });

  const setCurrentDocumentDescendants = (descendants: AiDescendantSelection) =>
    saveContext((current) => ({
      ...current,
      currentDocumentDescendants: descendants,
    }));

  const addContextSource = (source: AiContextSource) =>
    saveContext((current) => ({
      ...current,
      sources: [
        ...current.sources,
        { ...source, position: current.sources.length },
      ]
        .filter(
          (item, index, all) =>
            (!current.includeCurrentDocument || item.pageId !== pageId) &&
            all.findIndex((candidate) => candidate.pageId === item.pageId) ===
              index,
        )
        .slice(0, current.limits.manualRoots),
    }));

  const removeContextSource = (source: AiContextSource) =>
    saveContext((current) => ({
      ...current,
      sources: current.sources
        .filter((item) => item.pageId !== source.pageId)
        .map((item, position) => ({ ...item, position })),
    }));

  const setContextSourceDescendants = (
    source: AiContextSource,
    descendants: AiDescendantSelection,
  ) =>
    saveContext((current) => ({
      ...current,
      sources: current.sources.map((item) =>
        item.pageId === source.pageId ? { ...item, descendants } : item,
      ),
    }));

  const toggleContextFile = (fileId: string, included: boolean) =>
    saveContext((current) => ({
      ...current,
      fileIds: included
        ? [...new Set([...current.fileIds, fileId])].slice(0, 10)
        : current.fileIds.filter((id) => id !== fileId),
    }));

  const toggleContextAttachment = (attachmentId: string, included: boolean) =>
    saveContext((current) => ({
      ...current,
      attachmentIds: included
        ? [...new Set([...current.attachmentIds, attachmentId])].slice(0, 20)
        : current.attachmentIds.filter((id) => id !== attachmentId),
    }));

  const removeChatFile = (fileId: string, fileName: string) => {
    modals.openConfirmModal({
      title: t("ai.deleteFile"),
      children: (
        <Text size="sm">
          {t("ai.ux.deleteFileConfirm", { name: fileName })}
        </Text>
      ),
      labels: { confirm: t("ai.delete"), cancel: t("ai.cancel") },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await saveContext((current) => ({
            ...current,
            fileIds: current.fileIds.filter((id) => id !== fileId),
          }));
          await deleteFile.mutateAsync(fileId);
        } catch {
          // saveContext already exposes a recoverable error to the user.
        }
      },
    });
  };

  const selectedContextPageIds = useMemo(() => {
    const ids = new Set(
      (context?.sources ?? []).map((source) => source.pageId),
    );
    if ((context?.includeCurrentDocument ?? true) && pageId) ids.add(pageId);
    for (const source of context?.sources ?? []) {
      source.descendants.pageIds.forEach((id) => ids.add(id));
    }
    context?.currentDocumentDescendants.pageIds.forEach((id) => ids.add(id));
    return ids;
  }, [context, pageId]);
  const [{ isOver: isContextDropOver, isAllowed: isContextDropAllowed }, drop] =
    useDrop<
      { id?: string },
      TreeExternalDropResult,
      { isOver: boolean; isAllowed: boolean }
    >(
      () => ({
        accept: "NODE",
        canDrop: (item) => Boolean(item.id && findTreeNodeById(tree, item.id)),
        drop: (item) => {
          const result = createTreeExternalDropResult("ai-context");
          const node = item.id ? findTreeNodeById(tree, item.id) : undefined;
          if (!node || node.spaceId !== documentContext?.spaceId) {
            notifications.show({
              message: t("ai.context.crossSpaceRejected"),
              color: "orange",
            });
            return result;
          }

          const source = treeNodeToContextSource(node);
          if (!source) return result;
          if (selectedContextPageIds.has(source.pageId)) {
            notifications.show({ message: t("ai.context.alreadyAdded") });
            return result;
          }
          if (
            (context?.sources.length ?? 0) >=
            (context?.limits.manualRoots ?? 10)
          ) {
            notifications.show({
              message: t("ai.errorReason.contextSourceLimit"),
              color: "orange",
            });
            return result;
          }

          setPendingDroppedSource(source);
          setContextManagerOpened(true);
          return result;
        },
        collect: (monitor) => {
          const item = monitor.getItem<{ id?: string }>();
          const node = item?.id ? findTreeNodeById(tree, item.id) : undefined;
          const source = node ? treeNodeToContextSource(node) : undefined;
          return {
            isOver: monitor.isOver(),
            isAllowed: Boolean(
              monitor.canDrop() &&
                node &&
                node.spaceId === documentContext?.spaceId &&
                source &&
                !selectedContextPageIds.has(source.pageId) &&
                (context?.sources.length ?? 0) <
                  (context?.limits.manualRoots ?? 10),
            ),
          };
        },
      }),
      [
        context?.limits.manualRoots,
        context?.sources.length,
        documentContext?.spaceId,
        i18n,
        selectedContextPageIds,
        t,
        tree,
      ],
    );

  if (!documentContext) {
    return (
      <Stack align="center" justify="center" h="100%" p="lg">
        <IconMessagePlus size={36} />
        <Text size="sm" c="dimmed" ta="center">
          {resolveAiAssistantText(t, "openDocument", null)}
        </Text>
      </Stack>
    );
  }

  if (availabilityQuery.isLoading) {
    return (
      <Group justify="center" h="100%">
        <Loader size="sm" />
      </Group>
    );
  }

  if (
    shouldShowAiPanelLoadFailure(
      availabilityQuery.isError,
      conversationsQuery.isError,
      availabilityQuery.data?.canUse || availabilityQuery.data?.agentAvailable,
    )
  ) {
    return (
      <Stack align="center" justify="center" h="100%" p="md">
        <Alert
          icon={<IconAlertTriangle size={18} />}
          title={resolveAiAssistantText(
            t,
            "loadFailed",
            availabilityQuery.data?.assistantIdentity,
          )}
          color="red"
          w="100%"
        >
          <Button
            variant="light"
            color="red"
            size="compact-sm"
            mt="xs"
            onClick={() => {
              void availabilityQuery.refetch();
              void conversationsQuery.refetch();
            }}
          >
            {t("ai.tryAgain")}
          </Button>
        </Alert>
      </Stack>
    );
  }

  const availability = availabilityQuery.data;
  if (!availability?.canUse && !availability?.agentAvailable) {
    return (
      <Stack p="md">
        <Alert
          icon={<IconAlertTriangle size={18} />}
          title={resolveAiAssistantText(
            t,
            "unavailable",
            availability?.assistantIdentity,
          )}
          color="yellow"
        >
          {t(
            `ai.unavailableReason.${availability?.unavailableReason ?? "unknown"}`,
          )}
        </Alert>
      </Stack>
    );
  }

  const messages = sortAiMessagesChronologically(
    messagesQuery.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.items) ?? [],
  );
  const latestAssistantMessageId = messages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const spaceSearchReady = shouldShowAiRetrievalUi(
    availability.retrievalAvailable,
  );
  const quickCommands = mergeAiQuickCommands(
    DEFAULT_AI_QUICK_COMMANDS.map((command, position) => ({
      id: command.id,
      label: t(command.translationKey),
      prompt: t(command.promptTranslationKey),
      description: t(command.descriptionTranslationKey),
      enabled: true,
      position,
    })),
    availability.quickCommands ?? [],
  );
  const customQuickCommandIds = new Set(
    (availability.quickCommands ?? []).map((command) => command.id),
  );
  const visibleQuickCommands = quickCommands.filter((command) =>
    `${command.label} ${command.description ?? ""} ${command.prompt}`
      .toLocaleLowerCase(i18n.language)
      .includes(quickCommandQuery.trim().toLocaleLowerCase(i18n.language)),
  );
  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );
  const visibleConversations = conversations.filter((conversation) =>
    (conversation.title || t("ai.newChat"))
      .toLocaleLowerCase(i18n.language)
      .includes(historyQuery.trim().toLocaleLowerCase(i18n.language)),
  );
  const activeConversationTitle = activeConversation?.title || t("ai.newChat");

  return (
    <Stack
      ref={drop}
      gap="sm"
      h="100%"
      className={clsx(classes.panel, {
        [classes.panelDropActive]: isContextDropOver && isContextDropAllowed,
        [classes.panelDropRejected]: isContextDropOver && !isContextDropAllowed,
      })}
    >
      {isContextDropOver && (
        <Box
          className={clsx(
            classes.contextDropOverlay,
            isContextDropAllowed
              ? classes.contextDropAccepted
              : classes.contextDropRejected,
          )}
          aria-hidden
        >
          <IconPaperclip size={28} />
          <Text size="sm" fw={600}>
            {isContextDropAllowed
              ? t("ai.context.dropAccepted")
              : t("ai.context.dropRejected")}
          </Text>
        </Box>
      )}
      <Group gap="xs" wrap="nowrap" className={classes.conversationBar}>
        {isCompactMobile ? (
          <Button
            variant="default"
            flex={1}
            justify="space-between"
            rightSection={<IconChevronDown size={14} />}
            className={classes.mobileConversationButton}
            aria-label={t("ai.chatHistory")}
            onClick={() => setHistoryOpened(true)}
          >
            <Text size="sm" truncate>
              {activeConversationTitle}
            </Text>
          </Button>
        ) : (
          <Select
            aria-label={t("ai.chatHistory")}
            data={conversations.map((conversation) => ({
              value: conversation.id,
              label: conversation.title || t("ai.newChat"),
            }))}
            value={activeConversationId ?? null}
            onChange={selectConversation}
            placeholder={t("ai.newChat")}
            searchable
            allowDeselect={false}
            flex={1}
            size="sm"
            className={classes.conversationSelect}
            maxDropdownHeight={360}
            nothingFoundMessage={t("ai.ux.noChatsFound")}
            renderOption={({ option }) => {
              const conversation = conversationById.get(option.value);
              return (
                <Box className={classes.conversationOption}>
                  <Text size="sm" truncate>
                    {option.label}
                  </Text>
                  {conversation && (
                    <Text size="xs" c="dimmed">
                      {new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: "medium",
                      }).format(
                        new Date(
                          conversation.lastOpenedAt || conversation.updatedAt,
                        ),
                      )}
                    </Text>
                  )}
                </Box>
              );
            }}
          />
        )}
        <Tooltip label={t("ai.newChat")} withArrow>
          <ActionIcon
            variant="default"
            size={36}
            aria-label={t("ai.newChat")}
            loading={createConversation.isPending}
            onClick={() => void createNewConversation()}
          >
            <IconPlus size={18} />
          </ActionIcon>
        </Tooltip>
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="default"
              size={36}
              aria-label={t("ai.chatActions")}
              disabled={!activeConversation}
            >
              <IconDots size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconPencil size={15} />}
              onClick={() => {
                setRenameValue(activeConversation?.title ?? "");
                setRenameOpened(true);
              }}
            >
              {t("ai.renameChat")}
            </Menu.Item>
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={15} />}
              onClick={confirmDeleteConversation}
            >
              {t("ai.deleteChat")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <Box className={classes.messagesRegion}>
        <ScrollArea
          viewportRef={viewportRef}
          className={classes.messages}
          scrollbarSize={6}
          type="auto"
          onScrollPositionChange={({ y }) => {
            const viewport = viewportRef.current;
            if (!viewport) return;
            const isNearBottom = isAiChatNearBottom({
              scrollHeight: viewport.scrollHeight,
              scrollTop: y,
              clientHeight: viewport.clientHeight,
            });
            followOutputRef.current = isNearBottom;
            setShowJumpToLatest(!isNearBottom);
          }}
        >
          <Stack gap="sm" p="xs">
            {activeConversation && messagesQuery.isLoading && (
              <Stack gap="sm" py="md" aria-label={t("ai.ux.loading")}>
                <Skeleton height={70} radius="md" />
                <Skeleton height={112} radius="md" />
                <Skeleton height={54} radius="md" />
              </Stack>
            )}
            {activeConversation && messagesQuery.isError && (
              <Alert
                icon={<IconAlertTriangle size={18} />}
                title={t("ai.messagesLoadFailed")}
                color="red"
              >
                <Button
                  variant="light"
                  color="red"
                  size="compact-sm"
                  mt="xs"
                  onClick={() => void messagesQuery.refetch()}
                >
                  {t("ai.tryAgain")}
                </Button>
              </Alert>
            )}
            {messagesQuery.hasNextPage && (
              <Button
                variant="subtle"
                size="compact-sm"
                loading={messagesQuery.isFetchingNextPage}
                onClick={() => void messagesQuery.fetchNextPage()}
              >
                {t("ai.loadOlder")}
              </Button>
            )}
            {messages.length === 0 &&
              !pendingRun &&
              !messagesQuery.isLoading &&
              !messagesQuery.isError && (
                <Stack align="center" py="xl">
                  <IconMessagePlus size={36} />
                  <Text fw={500}>{t("ai.startConversation")}</Text>
                  <Text size="sm" c="dimmed" ta="center">
                    {t("ai.startConversationDescription")}
                  </Text>
                </Stack>
              )}

            {messages.map((message) => {
              const run =
                activeRuns.find((item) => item.messageId === message.id) ??
                (pendingRun?.messageId === message.id ? pendingRun : undefined);
              const runIsActive = Boolean(
                run &&
                  ["queued", "running", "awaiting_approval"].includes(
                    run.status,
                  ),
              );
              const renderedMessage = runIsActive
                ? {
                    ...message,
                    content: run?.content || message.content,
                    reasoning: run?.reasoning ?? message.reasoning ?? "",
                    status: "streaming" as const,
                  }
                : message;
              const runId = run?.runId ?? message.runId;

              return (
                <AiMessageCard
                  key={message.id}
                  message={renderedMessage}
                  editor={editor}
                  documentContext={documentContext}
                  editorContext={
                    message.applyContext ??
                    editorContexts[message.id] ??
                    (runId ? editorContexts[runId] : undefined) ??
                    editorContexts[message.conversationId]
                  }
                  onRetry={
                    runId &&
                    !pendingRun &&
                    message.id === latestAssistantMessageId
                      ? () =>
                          retryRun.mutate(
                            {
                              runId,
                              clientRequestId: crypto.randomUUID(),
                            },
                            { onSuccess: trackRunActivity },
                          )
                      : undefined
                  }
                  onRegenerate={
                    message.role === "assistant" &&
                    !pendingRun &&
                    message.id === latestAssistantMessageId
                      ? () =>
                          regenerateMessage.mutate(
                            {
                              messageId: message.id,
                              clientRequestId: crypto.randomUUID(),
                            },
                            { onSuccess: trackRunActivity },
                          )
                      : undefined
                  }
                  showRetrievalStatus={spaceSearchReady}
                />
              );
            })}

            {pendingRun &&
              !messages.some(
                (message) => message.id === pendingRun.messageId,
              ) && (
                <AiStreamingPlaceholder
                  run={pendingRun}
                  generatingLabel={t("ai.generating")}
                  reasoningLabel={t("ai.ux.reasoningInProgress")}
                />
              )}

            {pendingRun?.status === "awaiting_approval" && (
              <Alert
                icon={<IconRobot size={18} />}
                title={t("ai.agent.approvalTitle")}
                color="blue"
              >
                {pendingRunQuery.isLoading ? (
                  <Loader size="xs" />
                ) : pendingApproval ? (
                  <Stack gap="xs">
                    <Text size="sm">
                      {t(`ai.agent.tool.${pendingApproval.toolName}`, {
                        defaultValue: pendingApproval.toolName,
                      })}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("ai.agent.approvalDescription")}
                    </Text>
                    <AiApprovalPreview step={pendingApproval} />
                    <Group gap="xs">
                      <Button
                        size="compact-sm"
                        loading={approveStep.isPending}
                        disabled={rejectStep.isPending}
                        onClick={() =>
                          approveStep.mutate(
                            {
                              runId: pendingRun.runId,
                              stepId: pendingApproval.id,
                            },
                            {
                              onError: (error) =>
                                notifications.show({
                                  message: resolveAiErrorMessage(
                                    t,
                                    i18n,
                                    error?.["response"]?.data?.code,
                                  ),
                                  color: "red",
                                }),
                            },
                          )
                        }
                      >
                        {t("ai.agent.approve")}
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="default"
                        loading={rejectStep.isPending}
                        disabled={approveStep.isPending}
                        onClick={() =>
                          rejectStep.mutate(
                            {
                              runId: pendingRun.runId,
                              stepId: pendingApproval.id,
                            },
                            {
                              onError: (error) =>
                                notifications.show({
                                  message: resolveAiErrorMessage(
                                    t,
                                    i18n,
                                    error?.["response"]?.data?.code,
                                  ),
                                  color: "red",
                                }),
                            },
                          )
                        }
                      >
                        {t("ai.agent.reject")}
                      </Button>
                    </Group>
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    {t("ai.agent.loadingProposal")}
                  </Text>
                )}
              </Alert>
            )}
          </Stack>
        </ScrollArea>
        {showJumpToLatest && (
          <Tooltip label={t("ai.ux.jumpToLatest")} withArrow>
            <ActionIcon
              className={classes.jumpToLatest}
              size={36}
              radius="xl"
              variant="filled"
              aria-label={t("ai.ux.jumpToLatest")}
              onClick={() => {
                const viewport = viewportRef.current;
                if (!viewport) return;
                followOutputRef.current = true;
                viewport.scrollTo({
                  top: viewport.scrollHeight,
                  behavior: reduceMotion ? "auto" : "smooth",
                });
                setShowJumpToLatest(false);
              }}
            >
              <IconArrowDown size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Box>

      <Box className={classes.composer}>
        <Group gap={4} wrap="nowrap" className={classes.composerToolbar}>
          {isCompactMobile ? (
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconSparkles size={16} />}
              disabled={Boolean(pendingRun)}
              className={classes.toolbarButton}
              aria-label={t("ai.settings.quickCommands")}
              onClick={() => setQuickCommandsOpened(true)}
            >
              <span className={classes.toolbarButtonLabel}>
                {t("ai.settings.quickCommands")}
              </span>
            </Button>
          ) : (
            <Menu position="top-start" withinPortal>
              <Menu.Target>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconSparkles size={16} />}
                  rightSection={<IconChevronDown size={13} />}
                  disabled={Boolean(pendingRun)}
                  className={classes.toolbarButton}
                  aria-label={t("ai.settings.quickCommands")}
                >
                  <span className={classes.toolbarButtonLabel}>
                    {t("ai.settings.quickCommands")}
                  </span>
                </Button>
              </Menu.Target>
              <Menu.Dropdown className={classes.quickCommandsMenu}>
                <TextInput
                  value={quickCommandQuery}
                  onChange={(event) =>
                    setQuickCommandQuery(event.currentTarget.value)
                  }
                  placeholder={t("ai.ux.searchCommands")}
                  leftSection={<IconSearch size={14} />}
                  size="xs"
                  mb="xs"
                  onKeyDown={(event) => event.stopPropagation()}
                />
                {visibleQuickCommands.map((command) => (
                  <Tooltip
                    key={command.id}
                    label={command.description || command.prompt}
                    position="right"
                    withArrow
                  >
                    <Menu.Item
                      leftSection={<IconSparkles size={15} />}
                      rightSection={
                        <Badge size="xs" variant="light" color="gray">
                          {customQuickCommandIds.has(command.id)
                            ? t("ai.ux.customCommand")
                            : t("ai.ux.builtInCommand")}
                        </Badge>
                      }
                      onClick={() => handleQuickCommand(command.prompt)}
                      aria-description={command.description || command.prompt}
                    >
                      {command.label}
                    </Menu.Item>
                  </Tooltip>
                ))}
                {visibleQuickCommands.length === 0 && (
                  <Text size="xs" c="dimmed" ta="center" py="sm">
                    {t("ai.ux.noCommandsFound")}
                  </Text>
                )}
              </Menu.Dropdown>
            </Menu>
          )}

          {spaceSearchReady && (
            <Menu position="top-start" withinPortal>
              <Menu.Target>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconSearch size={16} />}
                  rightSection={
                    useSpaceSearch ? <IconCheck size={13} /> : undefined
                  }
                  disabled={Boolean(pendingRun)}
                  className={classes.toolbarButton}
                  aria-label={t("ai.searchSpace")}
                >
                  <span className={classes.toolbarButtonLabel}>
                    {t("ai.searchSpace")}
                  </span>
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item closeMenuOnClick={false}>
                  <Checkbox
                    checked={useSpaceSearch}
                    label={t("ai.spaceSearchToggle")}
                    onChange={(event) =>
                      toggleSpaceSearch(event.currentTarget.checked)
                    }
                  />
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}

          {availability.agentAvailable && (
            <Menu position="top-start" withinPortal>
              <Menu.Target>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconRobot size={16} />}
                  rightSection={agentMode ? <IconCheck size={13} /> : undefined}
                  disabled={Boolean(pendingRun)}
                  className={classes.toolbarButton}
                  aria-label={t("ai.agent.mode")}
                >
                  <span className={classes.toolbarButtonLabel}>
                    {t("ai.agent.mode")}
                  </span>
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item closeMenuOnClick={false}>
                  <Checkbox
                    checked={agentMode}
                    label={t("ai.agent.modeToggle")}
                    description={t("ai.agent.modeDescription")}
                    onChange={(event) =>
                      toggleAgentMode(event.currentTarget.checked)
                    }
                  />
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}

          <AiContextPicker
            conversationId={activeConversationId}
            documentPageId={documentContext.pageId}
            documentTitle={documentTitle}
            currentDocumentAvailable={
              availability.currentDocumentAvailable ?? true
            }
            includeCurrentDocument={context?.includeCurrentDocument ?? true}
            currentDocumentDescendants={
              context?.currentDocumentDescendants ?? {
                mode: "none",
                pageIds: [],
              }
            }
            sources={context?.sources ?? []}
            resolvedSourceCount={
              context?.resolvedSourceCount ??
              (availability.currentDocumentAvailable === false ? 0 : 1)
            }
            limits={context?.limits ?? { manualRoots: 10, resolvedSources: 50 }}
            fileIds={context?.fileIds ?? []}
            attachmentIds={context?.attachmentIds ?? []}
            chatFiles={chatFiles}
            pageAttachments={pageAttachments}
            loadingFiles={filesQuery.isLoading}
            saving={updateContext.isPending}
            saveFailed={contextSaveFailed}
            opened={contextManagerOpened}
            onOpenedChange={setContextManagerOpened}
            pendingSource={pendingDroppedSource}
            onPendingSourceHandled={() => setPendingDroppedSource(null)}
            onToggleCurrentDocument={toggleCurrentDocument}
            onSetCurrentDocumentDescendants={setCurrentDocumentDescendants}
            onAddSource={addContextSource}
            onRemoveSource={removeContextSource}
            onSetSourceDescendants={setContextSourceDescendants}
            onToggleFile={toggleContextFile}
            onToggleAttachment={toggleContextAttachment}
            onUpload={uploadFiles}
            onDeleteFile={removeChatFile}
            onRetrySave={retryContextSave}
            onPrepareConversation={ensureConversation}
          />
        </Group>

        <Textarea
          aria-label={t("ai.messagePlaceholder")}
          placeholder={t("ai.messagePlaceholder")}
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setDraftStatus(activeConversation ? "saving" : "idle");
          }}
          onKeyDown={handleComposerKeyDown}
          minRows={2}
          maxRows={8}
          autosize
          className={classes.messageInput}
        />

        <Group
          justify="space-between"
          gap="xs"
          wrap="nowrap"
          className={classes.composerFooter}
        >
          {pendingRun ? (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {pendingRun.status === "awaiting_approval"
                ? t("ai.agent.awaitingApproval")
                : t("ai.generating")}
            </Text>
          ) : draftStatus === "error" ? (
            <Button
              variant="subtle"
              color="red"
              size="compact-xs"
              onClick={() => void retryDraftSave()}
            >
              {t("ai.ux.draftSaveFailed")}
            </Button>
          ) : (
            <Text size="xs" c="dimmed" lineClamp={1} role="status">
              {draftStatus === "saving"
                ? t("ai.ux.draftSaving")
                : draftStatus === "saved"
                  ? t("ai.ux.draftSaved")
                  : t("ai.sendShortcut")}
            </Text>
          )}

          {pendingRun ? (
            <Button
              size="compact-sm"
              color="red"
              variant="light"
              leftSection={<IconPlayerStop size={15} />}
              loading={cancelRun.isPending}
              disabled={Boolean(pendingRun.cancelRequestedAt)}
              onClick={() =>
                cancelRun.mutate(pendingRun.runId, {
                  onError: (error) => {
                    notifications.show({
                      message: resolveAiErrorMessage(
                        t,
                        i18n,
                        error?.["response"]?.data?.code,
                      ),
                      color: "red",
                    });
                  },
                })
              }
            >
              {cancelRun.isPending || pendingRun.cancelRequestedAt
                ? t("ai.stopping")
                : t("ai.stop")}
            </Button>
          ) : (
            <Tooltip label={t("ai.send")} withArrow>
              <ActionIcon
                size={36}
                variant="filled"
                aria-label={t("ai.send")}
                disabled={
                  !draft.trim() ||
                  sendMessage.isPending ||
                  !selectedFilesAreReady ||
                  Boolean(pendingRun)
                }
                loading={sendMessage.isPending}
                onClick={() => void submit(draft)}
              >
                <IconSend size={17} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Box>

      <Modal
        opened={renameOpened}
        onClose={() => setRenameOpened(false)}
        title={t("ai.renameChat")}
        closeButtonProps={{ "aria-label": t("Close") }}
        centered
      >
        <TextInput
          value={renameValue}
          onChange={(event) => setRenameValue(event.currentTarget.value)}
          label={t("ai.chatName")}
          maxLength={255}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveRename();
            }
          }}
        />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setRenameOpened(false)}>
            {t("ai.cancel")}
          </Button>
          <Button
            leftSection={<IconCheck size={16} />}
            disabled={!renameValue.trim()}
            loading={updateConversation.isPending}
            onClick={() => void saveRename()}
          >
            {t("ai.save")}
          </Button>
        </Group>
      </Modal>

      <Drawer
        opened={Boolean(isCompactMobile && historyOpened)}
        onClose={() => setHistoryOpened(false)}
        title={t("ai.chatHistory")}
        closeButtonProps={{ "aria-label": t("Close") }}
        position="bottom"
        size="70dvh"
        transitionProps={{ duration: reduceMotion ? 0 : 180 }}
      >
        <Stack gap="sm">
          <TextInput
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.currentTarget.value)}
            placeholder={t("ai.chatHistory")}
            leftSection={<IconSearch size={15} />}
          />
          <ScrollArea.Autosize mah="calc(70dvh - 110px)">
            <Stack gap={4}>
              {visibleConversations.map((conversation) => (
                <Button
                  key={conversation.id}
                  variant={
                    conversation.id === activeConversationId
                      ? "light"
                      : "subtle"
                  }
                  color="gray"
                  justify="flex-start"
                  onClick={() => {
                    selectConversation(conversation.id);
                    setHistoryOpened(false);
                  }}
                >
                  <Box ta="start" style={{ minWidth: 0 }}>
                    <Text size="sm" truncate>
                      {conversation.title || t("ai.newChat")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: "medium",
                      }).format(
                        new Date(
                          conversation.lastOpenedAt || conversation.updatedAt,
                        ),
                      )}
                    </Text>
                  </Box>
                </Button>
              ))}
              {visibleConversations.length === 0 && (
                <Text size="sm" c="dimmed" ta="center" py="lg">
                  {t("ai.ux.noChatsFound")}
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Drawer>

      <Drawer
        opened={Boolean(isCompactMobile && quickCommandsOpened)}
        onClose={() => setQuickCommandsOpened(false)}
        title={t("ai.settings.quickCommands")}
        closeButtonProps={{ "aria-label": t("Close") }}
        position="bottom"
        size="75dvh"
        transitionProps={{ duration: reduceMotion ? 0 : 180 }}
      >
        <Stack gap="sm">
          <TextInput
            value={quickCommandQuery}
            onChange={(event) =>
              setQuickCommandQuery(event.currentTarget.value)
            }
            placeholder={t("ai.ux.searchCommands")}
            leftSection={<IconSearch size={15} />}
          />
          <ScrollArea.Autosize mah="calc(75dvh - 110px)">
            <Stack gap={6}>
              {visibleQuickCommands.map((command) => (
                <Button
                  key={command.id}
                  variant="light"
                  justify="space-between"
                  leftSection={<IconSparkles size={15} />}
                  rightSection={
                    <Badge size="xs" variant="light" color="gray">
                      {customQuickCommandIds.has(command.id)
                        ? t("ai.ux.customCommand")
                        : t("ai.ux.builtInCommand")}
                    </Badge>
                  }
                  onClick={() => {
                    handleQuickCommand(command.prompt);
                    setQuickCommandsOpened(false);
                  }}
                >
                  <Text size="sm" truncate>
                    {command.label}
                  </Text>
                </Button>
              ))}
              {visibleQuickCommands.length === 0 && (
                <Text size="sm" c="dimmed" ta="center" py="lg">
                  {t("ai.ux.noCommandsFound")}
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Drawer>
    </Stack>
  );
}

function AiStreamingPlaceholder({
  run,
  generatingLabel,
  reasoningLabel,
}: {
  run: AiStreamingRun;
  generatingLabel: string;
  reasoningLabel: string;
}) {
  return (
    <Alert color="blue" icon={<Loader size="xs" />} aria-live="polite">
      <Stack gap="xs">
        {run.reasoning && <AiReasoningDisclosure reasoning={run.reasoning} />}
        <Text size="sm">
          {run.content || (run.reasoning ? reasoningLabel : generatingLabel)}
        </Text>
      </Stack>
    </Alert>
  );
}
