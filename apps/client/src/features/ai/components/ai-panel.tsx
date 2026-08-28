import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Drawer,
  FileButton,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconBook,
  IconBrain,
  IconBriefcase,
  IconCheck,
  IconChevronDown,
  IconCode,
  IconDots,
  IconEye,
  IconEyeOff,
  IconLanguage,
  IconFileText,
  IconMessageCircle,
  IconMessagePlus,
  IconPaperclip,
  IconPencil,
  IconPlayerStop,
  IconPlus,
  IconRobot,
  IconSearch,
  IconSend,
  IconSparkles,
  IconStar,
  IconTemplate,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import type { Editor } from "@tiptap/core";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
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
  aiActiveConversationByPageAtom,
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
  useAiAssistantProfilesQuery,
  useAiAssistantProfilePreferencesQuery,
  useUpdateAiAssistantProfilePreferencesMutation,
} from "@/features/ai/queries/ai-query.ts";
import {
  AiConversation,
  AiAssistantProfileIcon,
  AiConversationContext,
  AiContextSource,
  AiDescendantSelection,
  AiMessage,
  AiStreamingRun,
} from "@/features/ai/types/ai.types.ts";
import { captureAiEditorContext } from "@/features/ai/utils/editor-context.ts";
import { AiMessageCard } from "./ai-message-card.tsx";
import { AiMarkdownComposer } from "./ai-markdown-composer.tsx";
import { insertMarkdownAtSelection } from "./ai-markdown-composer.extensions.ts";
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
import { AiComposerShell } from "./ai-composer-shell.tsx";
import {
  AI_LEGACY_SPACE_PROFILE_VALUE,
  type AiComposerProfileOption,
  matchesAiComposerProfileOption,
  resolveActiveAiComposerProfileOptionLabel,
  resolveAiComposerProfileDescription,
  resolveAiComposerProfileLabel,
  shouldShowHiddenActiveAiComposerProfileOption,
  shouldShowUnavailableAiComposerProfileOption,
} from "./ai-profile-display.ts";
import { AiProfileOptionContent } from "./ai-profile-option-content.tsx";
import AiExternalMcpOptInControl from "@/features/ai-external-mcp/components/ai-external-mcp-opt-in-control.tsx";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
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
import {
  AI_CHAT_FILE_ACCEPT,
  isSupportedAiChatFileName,
} from "@/features/ai/utils/ai-files.ts";
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
  const hasCoarsePointer = useMediaQuery("(pointer: coarse)");
  const useLargeComposerTargets = isCompactMobile || hasCoarsePointer;
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
  const profilesQuery = useAiAssistantProfilesQuery(spaceId);
  const profilePreferencesQuery =
    useAiAssistantProfilePreferencesQuery(spaceId);
  const updateProfilePreferences =
    useUpdateAiAssistantProfilePreferencesMutation(spaceId ?? "");
  const [activeByPage, setActiveByPage] = useAtom(
    aiActiveConversationByPageAtom,
  );
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
  const [assistantProfileId, setAssistantProfileId] = useState<string | null>(
    null,
  );
  const [profilePickerOpened, setProfilePickerOpened] = useState(false);
  const [profileQuery, setProfileQuery] = useState("");
  const [composerProfileQuery, setComposerProfileQuery] = useState("");
  const [renameOpened, setRenameOpened] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [quickCommandQuery, setQuickCommandQuery] = useState("");
  const [quickCommandsOpened, setQuickCommandsOpened] = useState(false);
  const [slashCommandIndex, setSlashCommandIndex] = useState(0);
  const [composerEditor, setComposerEditor] = useState<Editor | null>(null);
  const [markdownLinkOpened, setMarkdownLinkOpened] = useState(false);
  const [markdownLinkHref, setMarkdownLinkHref] = useState("");
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
  const skipLocalDraftWriteFor = useRef<string | null>(null);
  const ensureConversationRef = useRef<Promise<AiConversation> | null>(null);
  const draftSaveChain = useRef<Promise<unknown>>(Promise.resolve());
  const contextSaveChain = useRef<Promise<AiConversationContext> | null>(null);
  const lastContextTransformRef = useRef<
    ((current: AiConversationContext) => AiConversationContext) | null
  >(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contextTriggerRef = useRef<HTMLButtonElement | null>(null);
  const followOutputRef = useRef(true);

  const activeRuns = useMemo(
    () =>
      Object.values(streamingRuns).filter(
        (run) => run.conversationId === activeConversationId,
      ),
    [activeConversationId, streamingRuns],
  );
  const activeRunByMessageId = useMemo(
    () =>
      new Map(
        activeRuns
          .filter((run) => run.messageId)
          .map((run) => [run.messageId!, run]),
      ),
    [activeRuns],
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
      !localDraftKey ||
      activeByPage[pageId] !== undefined ||
      conversationsQuery.isLoading
    ) {
      return;
    }
    if (readAiLocalDraft(sessionStorage, localDraftKey) !== null) {
      setActiveByPage((current) => ({ ...current, [pageId]: null }));
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
    localDraftKey,
    pageId,
    touchConversation,
  ]);

  useEffect(() => {
    if (!activeConversation) {
      if (!isLocalDraft || !localDraftKey) {
        return;
      }
      if (profilesQuery.isLoading) return;
      const marker = `local:${localDraftKey}`;
      if (draftHydratedFor.current !== marker) {
        const saved = readAiLocalDraft(sessionStorage, localDraftKey);
        const defaultAgentMode =
          availabilityQuery.data?.agentAvailable === true &&
          availabilityQuery.data?.canUse !== true;
        setDraft(saved?.text ?? "");
        setUseSpaceSearch(saved?.useSpaceSearch ?? false);
        setAgentMode(saved?.agentMode ?? defaultAgentMode);
        const fallbackProfileId =
          profilesQuery.data?.preferredProfileId ??
          profilesQuery.data?.defaultProfileId ??
          null;
        const savedProfileId = saved?.assistantProfileId;
        const savedProfileAvailable =
          savedProfileId === null ||
          (typeof savedProfileId === "string" &&
            profilesQuery.data?.items.some(
              (profile) =>
                profile.id === savedProfileId &&
                profile.availability === "available",
            ));
        setAssistantProfileId(
          saved && savedProfileAvailable ? savedProfileId : fallbackProfileId,
        );
        skipLocalDraftWriteFor.current = marker;
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
    setAssistantProfileId(activeConversation.assistantProfile.id);
    contextSaveChain.current = null;
    setContextSaveFailed(false);
  }, [
    activeConversation,
    availabilityQuery.data?.agentAvailable,
    availabilityQuery.data?.canUse,
    isLocalDraft,
    localDraftKey,
    profilesQuery.data?.defaultProfileId,
    profilesQuery.data?.items,
    profilesQuery.data?.preferredProfileId,
    profilesQuery.isLoading,
  ]);

  useEffect(() => {
    if (
      !isLocalDraft ||
      !localDraftKey ||
      draftHydratedFor.current !== `local:${localDraftKey}`
    ) {
      return;
    }
    if (skipLocalDraftWriteFor.current === `local:${localDraftKey}`) {
      skipLocalDraftWriteFor.current = null;
      return;
    }
    writeAiLocalDraft(sessionStorage, localDraftKey, {
      text: draft,
      useSpaceSearch,
      agentMode,
      assistantProfileId,
    });
  }, [
    agentMode,
    assistantProfileId,
    draft,
    isLocalDraft,
    localDraftKey,
    useSpaceSearch,
  ]);

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

  const ensureConversation = async (
    profileId = assistantProfileId,
    requestedAgentMode = agentMode,
  ): Promise<AiConversation> => {
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
        agentMode: requestedAgentMode,
        assistantProfileId: profileId,
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

  const submit = async (
    content: string,
    preparedConversation?: AiConversation,
  ) => {
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
      const conversation = preparedConversation ?? (await ensureConversation());
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

  const handleQuickCommand = (prompt: string) => {
    if (!composerEditor) return;
    if (!insertMarkdownAtSelection(composerEditor.view, prompt)) return;

    composerEditor.commands.focus();
    setQuickCommandsOpened(false);
  };

  const selectConversation = (conversationId: string | null) => {
    if (!pageId || !conversationId) {
      return;
    }
    const select = () => {
      if (localDraftKey) {
        sessionStorage.removeItem(localDraftKey);
      }
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
        writeAiLocalDraft(sessionStorage, localDraftKey, {
          text: "",
          useSpaceSearch: false,
          agentMode:
            availabilityQuery.data?.agentAvailable === true &&
            availabilityQuery.data?.canUse !== true,
          assistantProfileId:
            profilesQuery.data?.preferredProfileId ??
            profilesQuery.data?.defaultProfileId ??
            null,
        });
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
      setAssistantProfileId(
        profilesQuery.data?.preferredProfileId ??
          profilesQuery.data?.defaultProfileId ??
          null,
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
    if (files.some((file) => !isSupportedAiChatFileName(file.name))) {
      notifications.show({
        message: t("ai.errorReason.unsupportedFileType"),
        color: "red",
      });
      return;
    }
    try {
      const conversation = await ensureConversation();
      const batch = await uploadFilesMutation.mutateAsync({
        conversationId: conversation.id,
        files,
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
    const previous = useSpaceSearch;
    setUseSpaceSearch(checked);
    if (activeConversation) {
      updateConversation.mutate(
        {
          conversationId: activeConversation.id,
          data: { useSpaceSearch: checked },
        },
        {
          onError: (error) => {
            setUseSpaceSearch(previous);
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

  const toggleAgentMode = (checked: boolean) => {
    if (
      checked &&
      activeConversation?.assistantProfile.source === "assistant_profile" &&
      activeConversation.assistantProfile.availability !== "available"
    ) {
      notifications.show({
        message: t("ai.profiles.unavailable"),
        color: "yellow",
      });
      return;
    }
    const profile = profilesQuery.data?.items.find(
      (item) => item.id === assistantProfileId,
    );
    if (checked && profile && !profile.agent.available) {
      notifications.show({
        message: t(`ai.profiles.agentReason.${profile.agent.reason}`),
        color: "yellow",
      });
      return;
    }
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

  const runComposerCommand = (command: (editor: Editor) => void) => {
    if (!composerEditor) return;
    command(composerEditor);
  };

  const openMarkdownLink = () => {
    const href = composerEditor?.getAttributes("link").href;
    setMarkdownLinkHref(typeof href === "string" ? href : "");
    setMarkdownLinkOpened(true);
  };

  const saveMarkdownLink = () => {
    const href = markdownLinkHref.trim();
    if (!composerEditor || !href) return;
    composerEditor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href })
      .run();
    setMarkdownLinkOpened(false);
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
  const allAvailableProfiles = (profilesQuery.data?.items ?? []).filter(
    (profile) => profile.availability === "available",
  );
  const hiddenProfileIds = new Set(
    profilePreferencesQuery.data?.hiddenProfileIds ?? [],
  );
  const availableProfiles = allAvailableProfiles.filter(
    (profile) => !hiddenProfileIds.has(profile.id),
  );
  const selectedProfile = allAvailableProfiles.find(
    (profile) => profile.id === assistantProfileId,
  );
  const profileAgentAvailable =
    activeConversation?.assistantProfile.source === "assistant_profile" &&
    activeConversation.assistantProfile.availability !== "available"
      ? false
      : selectedProfile
        ? selectedProfile.agent.available
        : availability.agentAvailable;
  const latestAssistantMessageId = messages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const spaceSearchReady = shouldShowAiRetrievalUi(
    availability.retrievalAvailable,
  );
  const profileQuickCommands = activeConversation
    ? activeConversation.assistantProfile.quickCommands
    : selectedProfile?.quickCommands;
  const effectiveCustomQuickCommands =
    profileQuickCommands ?? availability.quickCommands ?? [];
  const quickCommands = mergeAiQuickCommands(
    DEFAULT_AI_QUICK_COMMANDS.map((command, position) => ({
      id: command.id,
      label: t(command.translationKey),
      prompt: t(command.promptTranslationKey),
      description: t(command.descriptionTranslationKey),
      enabled: true,
      position,
    })),
    effectiveCustomQuickCommands,
  );
  const customQuickCommandIds = new Set(
    effectiveCustomQuickCommands.map((command) => command.id),
  );
  const visibleQuickCommands = quickCommands.filter((command) =>
    `${command.label} ${command.description ?? ""} ${command.prompt}`
      .toLocaleLowerCase(i18n.language)
      .includes(quickCommandQuery.trim().toLocaleLowerCase(i18n.language)),
  );
  const visibleConversations = conversations.filter((conversation) =>
    (conversation.title || t("ai.newChat"))
      .toLocaleLowerCase(i18n.language)
      .includes(historyQuery.trim().toLocaleLowerCase(i18n.language)),
  );
  const activeConversationTitle = activeConversation?.title || t("ai.newChat");
  const activeHiddenProfile = shouldShowHiddenActiveAiComposerProfileOption(
    activeConversation?.assistantProfile.id,
    allAvailableProfiles.map((profile) => profile.id),
    availableProfiles.map((profile) => profile.id),
  )
    ? allAvailableProfiles.find(
        (profile) => profile.id === activeConversation?.assistantProfile.id,
      )
    : null;
  const activeHiddenProfileOption = activeHiddenProfile
    ? {
        value: activeHiddenProfile.id,
        label: resolveActiveAiComposerProfileOptionLabel(
          activeConversation?.assistantProfile ?? {},
          activeHiddenProfile,
        ),
        description: resolveAiComposerProfileDescription(
          activeConversation?.assistantProfile.description ??
            activeHiddenProfile.description,
          t("ai.profiles.noDescription"),
        ),
      }
    : null;
  const activeSnapshotProfileOption =
    shouldShowUnavailableAiComposerProfileOption(
      activeConversation?.assistantProfile.id,
      allAvailableProfiles.map((profile) => profile.id),
    )
      ? {
          value: activeConversation!.assistantProfile.id!,
          label: `${activeConversation.assistantProfile.name ?? t("ai.profiles.unavailable")} · v${activeConversation.assistantProfile.version ?? "?"} · ${t("ai.profiles.unavailable")}`,
          description: resolveAiComposerProfileDescription(
            activeConversation.assistantProfile.description,
            t("ai.profiles.noDescription"),
          ),
          disabled: true,
        }
      : null;
  const profileOptions: AiComposerProfileOption[] = [
    {
      value: AI_LEGACY_SPACE_PROFILE_VALUE,
      label: t("ai.profiles.spaceAssistant"),
      description: t("ai.profiles.spaceAssistantDescription"),
    },
    ...availableProfiles.map((profile) => ({
      value: profile.id,
      label: `${profile.name} · v${profile.version}`,
      description: resolveAiComposerProfileDescription(
        profile.description,
        t("ai.profiles.noDescription"),
      ),
    })),
    ...(activeHiddenProfileOption ? [activeHiddenProfileOption] : []),
    ...(activeSnapshotProfileOption ? [activeSnapshotProfileOption] : []),
  ];
  const currentProfileValue =
    assistantProfileId ?? AI_LEGACY_SPACE_PROFILE_VALUE;
  const currentProfileLabel = resolveAiComposerProfileLabel({
    activeProfile: activeConversation?.assistantProfile,
    assistantProfileId,
    options: profileOptions,
    spaceAssistantLabel: t("ai.profiles.spaceAssistant"),
    unavailableLabel: t("ai.profiles.unavailable"),
  });
  const visibleComposerProfileOptions = profileOptions.filter((option) =>
    matchesAiComposerProfileOption(option, composerProfileQuery, i18n.language),
  );
  const visibleMobileProfileOptions = profileOptions.filter((option) =>
    matchesAiComposerProfileOption(option, profileQuery, i18n.language),
  );
  const showComposerProfileControl = Boolean(
    profilesQuery.data?.enabled && profileOptions.length > 1,
  );

  const beginLocalDraftWithProfile = (profileId: string | null) => {
    if (!pageId) return;
    ensureConversationRef.current = null;
    setActiveByPage((current) => ({ ...current, [pageId]: null }));
    setAssistantProfileId(profileId);
    const profile = availableProfiles.find((item) => item.id === profileId);
    const nextAgentMode = profile
      ? agentMode && profile.agent.available
      : agentMode && availability.agentAvailable;
    if (agentMode !== nextAgentMode) {
      setAgentMode(false);
    }
    if (localDraftKey) {
      writeAiLocalDraft(sessionStorage, localDraftKey, {
        text: draft,
        useSpaceSearch,
        agentMode: nextAgentMode,
        assistantProfileId: profileId,
      });
      draftHydratedFor.current = `local:${localDraftKey}`;
    }
  };

  const chooseAssistantProfile = (value: string | null) => {
    const profileId = value === AI_LEGACY_SPACE_PROFILE_VALUE ? null : value;
    if (profileId === assistantProfileId) return;
    if (!activeConversation) {
      beginLocalDraftWithProfile(profileId);
      return;
    }
    if (messages.length === 0 && !pendingRun) {
      updateConversation.mutate(
        {
          conversationId: activeConversation.id,
          data: { assistantProfileId: profileId },
        },
        {
          onSuccess: (conversation) => {
            setAssistantProfileId(conversation.assistantProfile.id);
            if (
              conversation.agentMode &&
              conversation.assistantProfile.id &&
              !availableProfiles.find(
                (profile) => profile.id === conversation.assistantProfile.id,
              )?.agent.available
            ) {
              setAgentMode(false);
            }
          },
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
      );
      return;
    }
    modals.openConfirmModal({
      title: t("ai.profiles.startNewTitle"),
      children: <Text size="sm">{t("ai.profiles.startNewDescription")}</Text>,
      labels: { confirm: t("ai.profiles.startNew"), cancel: t("ai.cancel") },
      onConfirm: () => beginLocalDraftWithProfile(profileId),
    });
  };

  const saveProfilePreferences = (
    preferredProfileId: string | null,
    nextHiddenProfileIds: string[],
  ) => {
    updateProfilePreferences.mutate(
      { preferredProfileId, hiddenProfileIds: nextHiddenProfileIds },
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
    );
  };

  const togglePreferredProfile = (profileId: string) => {
    saveProfilePreferences(
      profilePreferencesQuery.data?.preferredProfileId === profileId
        ? null
        : profileId,
      profilePreferencesQuery.data?.hiddenProfileIds ?? [],
    );
  };

  const hideProfile = (profileId: string) => {
    const nextHiddenProfileIds = [
      ...new Set([
        ...(profilePreferencesQuery.data?.hiddenProfileIds ?? []),
        profileId,
      ]),
    ];
    saveProfilePreferences(
      profilePreferencesQuery.data?.preferredProfileId === profileId
        ? null
        : (profilePreferencesQuery.data?.preferredProfileId ?? null),
      nextHiddenProfileIds,
    );
    if (!activeConversation && assistantProfileId === profileId) {
      const fallback = availableProfiles.find(
        (profile) =>
          profile.id !== profileId &&
          profile.id === profilesQuery.data?.defaultProfileId,
      );
      beginLocalDraftWithProfile(fallback?.id ?? null);
    }
  };

  const showHiddenProfiles = () => {
    saveProfilePreferences(
      profilePreferencesQuery.data?.preferredProfileId ?? null,
      [],
    );
  };

  const startProfile = async (profileId: string) => {
    const profile = availableProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    beginLocalDraftWithProfile(profile.id);
    composerEditor?.commands.focus();
    if (!profile.autoStart || !profile.launchMessage) return;
    try {
      const conversation = await ensureConversation(
        profile.id,
        agentMode && profile.agent.available,
      );
      setDraft(profile.launchMessage);
      await submit(profile.launchMessage, conversation);
    } catch (error) {
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

  const composerContextItems = [
    ...((context?.includeCurrentDocument ?? true)
      ? [
          {
            id: "current-document",
            label: documentTitle,
            icon: <IconBook size={14} />,
            removeLabel: t("ai.context.removeSource"),
            remove: () => toggleCurrentDocument(false),
          },
        ]
      : []),
    ...(context?.sources ?? []).map((source) => ({
      id: `source:${source.id}`,
      label: source.title,
      icon: <IconFileText size={14} />,
      removeLabel: t("ai.context.removeSource"),
      remove: () => removeContextSource(source),
    })),
    ...(context?.fileIds ?? []).map((fileId) => {
      const file = chatFiles.find((item) => item.id === fileId);
      return {
        id: `file:${fileId}`,
        label: file?.name ?? t("ai.uploadedFiles"),
        icon:
          file?.status === "processing" || file?.status === "pending" ? (
            <Loader size={12} />
          ) : (
            <IconPaperclip size={14} />
          ),
        removeLabel: t("ai.context.removeSource"),
        remove: () => toggleContextFile(fileId, false),
      };
    }),
    ...(context?.attachmentIds ?? []).map((attachmentId) => {
      const attachment = pageAttachments.find(
        (item) => item.id === attachmentId,
      );
      return {
        id: `attachment:${attachmentId}`,
        label: attachment?.fileName ?? t("ai.pageAttachments"),
        icon: <IconPaperclip size={14} />,
        removeLabel: t("ai.context.removeSource"),
        remove: () => toggleContextAttachment(attachmentId, false),
      };
    }),
  ];
  const visibleComposerContextItems = composerContextItems.slice(0, 3);
  const hiddenComposerContextCount = Math.max(
    0,
    composerContextItems.length - visibleComposerContextItems.length,
  );

  const activeTextBlock =
    composerEditor?.state.selection.$from.parent.textContent ?? "";
  const slashTrigger = activeTextBlock.match(/^\/(.*)$/);
  const slashQuery = slashTrigger?.[1].trim().toLocaleLowerCase(i18n.language);
  const slashCommands = [
    ...quickCommands.map((command) => ({
      id: `template:${command.id}`,
      label: command.label,
      description: command.description || t("ai.composer.templates"),
      icon: <IconSparkles size={15} />,
      run: () => {
        if (!composerEditor) return;
        insertMarkdownAtSelection(composerEditor.view, command.prompt);
      },
    })),
    {
      id: "format:bold",
      label: t("ai.composer.bold"),
      description: t("ai.composer.formatting"),
      icon: <IconCode size={15} />,
      run: () => composerEditor?.chain().focus().toggleBold().run(),
    },
    {
      id: "format:bullet-list",
      label: t("ai.composer.bulletList"),
      description: t("ai.composer.formatting"),
      icon: <IconCode size={15} />,
      run: () => composerEditor?.chain().focus().toggleBulletList().run(),
    },
    {
      id: "format:quote",
      label: t("ai.composer.quote"),
      description: t("ai.composer.formatting"),
      icon: <IconCode size={15} />,
      run: () => composerEditor?.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "format:code-block",
      label: t("ai.composer.codeBlock"),
      description: t("ai.composer.formatting"),
      icon: <IconCode size={15} />,
      run: () => composerEditor?.chain().focus().toggleCodeBlock().run(),
    },
  ];
  const visibleSlashCommands = slashCommands.filter((command) =>
    `${command.label} ${command.description}`
      .toLocaleLowerCase(i18n.language)
      .includes(slashQuery ?? ""),
  );
  const displayedSlashCommands = visibleSlashCommands.slice(0, 8);
  const slashMenuOpened = Boolean(slashTrigger);
  const activeSlashCommandIndex = Math.min(
    slashCommandIndex,
    Math.max(0, displayedSlashCommands.length - 1),
  );

  const selectSlashCommand = (index = activeSlashCommandIndex) => {
    const command = displayedSlashCommands[index];
    if (!composerEditor || !slashTrigger || !command) return;
    const { from } = composerEditor.state.selection;
    composerEditor
      .chain()
      .focus()
      .deleteRange({ from: from - slashTrigger[0].length, to: from })
      .run();
    command.run();
    setSlashCommandIndex(0);
  };

  const handleComposerKeyDown = (event: KeyboardEvent) => {
    if (!slashMenuOpened) {
      return false;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      composerEditor?.commands.deleteRange({
        from: composerEditor.state.selection.from - slashTrigger![0].length,
        to: composerEditor.state.selection.from,
      });
      setSlashCommandIndex(0);
      return true;
    }
    if (displayedSlashCommands.length === 0) {
      if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
        event.preventDefault();
        return true;
      }
      return false;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashCommandIndex(
        (activeSlashCommandIndex + 1) % displayedSlashCommands.length,
      );
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashCommandIndex(
        (activeSlashCommandIndex - 1 + displayedSlashCommands.length) %
          displayedSlashCommands.length,
      );
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectSlashCommand();
      return true;
    }
    return false;
  };

  return (
    <Stack
      ref={drop}
      gap="sm"
      h="100%"
      data-testid="ai-panel"
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
          <Menu
            position="bottom-start"
            withinPortal
            offset={8}
            onOpen={() => setHistoryQuery("")}
          >
            <Menu.Target>
              <Button
                variant="subtle"
                flex={1}
                justify="space-between"
                rightSection={<IconChevronDown size={14} />}
                className={classes.conversationHistoryButton}
                aria-label={t("ai.chatHistory")}
              >
                <Text size="sm" truncate>
                  {activeConversationTitle}
                </Text>
              </Button>
            </Menu.Target>
            <Menu.Dropdown className={classes.conversationHistoryMenu}>
              <TextInput
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.currentTarget.value)}
                placeholder={t("ai.chatHistory")}
                leftSection={<IconSearch size={14} />}
                size="xs"
                m="xs"
                onKeyDown={(event) => event.stopPropagation()}
              />
              <ScrollArea.Autosize mah={360} type="auto">
                {visibleConversations.map((conversation) => (
                  <Menu.Item
                    key={conversation.id}
                    leftSection={
                      conversation.assistantProfile.icon ? (
                        <AssistantProfileIcon
                          icon={conversation.assistantProfile.icon}
                          size={15}
                        />
                      ) : (
                        <IconMessageCircle size={15} />
                      )
                    }
                    rightSection={
                      conversation.id === activeConversationId ? (
                        <IconCheck size={15} />
                      ) : null
                    }
                    onClick={() => selectConversation(conversation.id)}
                  >
                    <Box className={classes.conversationOption}>
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
                  </Menu.Item>
                ))}
                {visibleConversations.length === 0 && (
                  <Text size="sm" c="dimmed" ta="center" py="lg">
                    {t("ai.ux.noChatsFound")}
                  </Text>
                )}
              </ScrollArea.Autosize>
            </Menu.Dropdown>
          </Menu>
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
          viewportProps={{
            tabIndex: 0,
            "aria-label": t("ai.title"),
          }}
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
                <Stack align="center" py="xl" className={classes.emptyState}>
                  <Box className={classes.emptyProfileIcon}>
                    {selectedProfile ? (
                      <AssistantProfileIcon
                        icon={selectedProfile.icon}
                        size={24}
                      />
                    ) : (
                      <IconRobot size={24} />
                    )}
                  </Box>
                  <Text fw={600} size="lg">
                    {currentProfileLabel}
                  </Text>
                  <Text size="sm" c="dimmed" ta="center">
                    {selectedProfile?.description ||
                      t("ai.startConversationDescription")}
                  </Text>
                  <Box className={classes.emptyQuickCommands}>
                    {selectedProfile?.autoStart && (
                      <Button
                        variant="light"
                        leftSection={<IconSparkles size={15} />}
                        justify="flex-start"
                        className={classes.emptyQuickCommand}
                        onClick={() => void startProfile(selectedProfile.id)}
                      >
                        <Text size="sm" truncate>
                          {t("ai.profiles.start")}
                        </Text>
                      </Button>
                    )}
                    {quickCommands.slice(0, 4).map((command) => (
                      <Button
                        key={command.id}
                        variant="default"
                        leftSection={<IconSparkles size={15} />}
                        justify="flex-start"
                        className={classes.emptyQuickCommand}
                        onClick={() => handleQuickCommand(command.prompt)}
                      >
                        <Text size="sm" truncate>
                          {command.label}
                        </Text>
                      </Button>
                    ))}
                  </Box>
                </Stack>
              )}

            {messages.map((message) => {
              const run =
                activeRunByMessageId.get(message.id) ??
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
        <AiComposerShell
          contextRail={
            <>
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
                limits={
                  context?.limits ?? { manualRoots: 10, resolvedSources: 50 }
                }
                fileIds={context?.fileIds ?? []}
                attachmentIds={context?.attachmentIds ?? []}
                chatFiles={chatFiles}
                pageAttachments={pageAttachments}
                loadingFiles={filesQuery.isLoading}
                saving={updateContext.isPending}
                saveFailed={contextSaveFailed}
                showTrigger={false}
                returnFocusRef={contextTriggerRef}
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
              {(composerContextItems.length > 0 || useSpaceSearch) && (
                <Group gap={6} wrap="nowrap" className={classes.contextChipRow}>
                  {visibleComposerContextItems.map((item) => (
                    <Button
                      key={item.id}
                      variant="light"
                      color="gray"
                      size="compact-xs"
                      leftSection={item.icon}
                      rightSection={<IconX size={12} />}
                      className={classes.contextChip}
                      aria-label={`${item.removeLabel}: ${item.label}`}
                      disabled={updateContext.isPending || Boolean(pendingRun)}
                      onClick={() => void item.remove()}
                    >
                      <span className={classes.contextChipLabel}>
                        {item.label}
                      </span>
                    </Button>
                  ))}
                  {hiddenComposerContextCount > 0 && (
                    <Button
                      variant="subtle"
                      color="gray"
                      size="compact-xs"
                      className={classes.contextOverflowChip}
                      onClick={() => setContextManagerOpened(true)}
                    >
                      +{hiddenComposerContextCount}
                    </Button>
                  )}
                  {useSpaceSearch && (
                    <Button
                      variant="light"
                      size="compact-xs"
                      leftSection={<IconSearch size={14} />}
                      rightSection={<IconX size={12} />}
                      className={classes.contextChip}
                      aria-pressed="true"
                      aria-label={t("ai.searchSpace")}
                      disabled={Boolean(pendingRun)}
                      onClick={() => toggleSpaceSearch(false)}
                    >
                      <span className={classes.contextChipLabel}>
                        {t("ai.composer.spaceSearchShort")}
                      </span>
                    </Button>
                  )}
                </Group>
              )}
            </>
          }
          editor={
            <AiMarkdownComposer
              value={draft}
              ariaLabel={t("ai.messagePlaceholder")}
              placeholder={
                context?.includeCurrentDocument === false
                  ? t("ai.composer.genericPlaceholder")
                  : t("ai.messagePlaceholder")
              }
              onEditorChange={setComposerEditor}
              onChange={(nextDraft) => {
                setDraft(nextDraft);
                setDraftStatus(activeConversation ? "saving" : "idle");
              }}
              onKeyDown={handleComposerKeyDown}
              onSubmit={() => void submit(draft)}
            />
          }
          commandPalette={
            slashMenuOpened ? (
              <Paper
                withBorder
                shadow="md"
                className={classes.slashPalette}
                role="listbox"
                aria-label={t("ai.ux.searchCommands")}
              >
                {displayedSlashCommands.length > 0 ? (
                  displayedSlashCommands.map((command, index) => (
                    <Button
                      key={command.id}
                      variant={
                        index === activeSlashCommandIndex ? "light" : "subtle"
                      }
                      color="gray"
                      justify="flex-start"
                      leftSection={command.icon}
                      className={classes.slashCommand}
                      role="option"
                      aria-selected={index === activeSlashCommandIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectSlashCommand(index)}
                    >
                      <Box ta="start" style={{ minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {command.label}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {command.description}
                        </Text>
                      </Box>
                    </Button>
                  ))
                ) : (
                  <Text size="sm" c="dimmed" ta="center" py="sm">
                    {t("ai.ux.noCommandsFound")}
                  </Text>
                )}
              </Paper>
            ) : null
          }
        >
          <Group
            justify="flex-start"
            gap="xs"
            wrap="nowrap"
            className={classes.composerFooter}
            data-testid="ai-composer-footer"
            data-busy={pendingRun ? "true" : undefined}
          >
            {isCompactMobile ? (
              <ActionIcon
                ref={contextTriggerRef}
                variant="subtle"
                size={44}
                radius="xl"
                aria-label={t("ai.composer.add")}
                disabled={Boolean(pendingRun)}
                className={classes.composerAddButton}
                onClick={() => setQuickCommandsOpened(true)}
              >
                <IconPlus size={20} />
              </ActionIcon>
            ) : (
              <Menu position="top-start" withinPortal offset={10}>
                <Menu.Target>
                  <ActionIcon
                    ref={contextTriggerRef}
                    variant="subtle"
                    size={useLargeComposerTargets ? 44 : 36}
                    radius="xl"
                    aria-label={t("ai.composer.add")}
                    disabled={Boolean(pendingRun)}
                    className={classes.composerAddButton}
                  >
                    <IconPlus size={20} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown className={classes.composerAddMenu}>
                  <Menu.Label>{t("ai.composer.addToMessage")}</Menu.Label>
                  <FileButton
                    accept={AI_CHAT_FILE_ACCEPT}
                    multiple
                    onChange={(files) => void uploadFiles(files)}
                  >
                    {(fileButtonProps) => (
                      <Menu.Item
                        {...fileButtonProps}
                        leftSection={<IconPaperclip size={16} />}
                      >
                        {t("ai.attachFiles")}
                      </Menu.Item>
                    )}
                  </FileButton>
                  <Menu.Item
                    leftSection={<IconBook size={16} />}
                    onClick={() => setContextManagerOpened(true)}
                  >
                    {t("ai.context.managerTitle")}
                  </Menu.Item>
                  {spaceSearchReady && (
                    <Menu.Item
                      leftSection={<IconSearch size={16} />}
                      rightSection={
                        useSpaceSearch ? <IconCheck size={15} /> : null
                      }
                      onClick={() => toggleSpaceSearch(!useSpaceSearch)}
                    >
                      {t("ai.searchSpace")}
                    </Menu.Item>
                  )}
                  <Menu.Divider />
                  <Menu.Sub>
                    <Menu.Sub.Target>
                      <Menu.Sub.Item leftSection={<IconTemplate size={16} />}>
                        {t("ai.composer.templates")}
                      </Menu.Sub.Item>
                    </Menu.Sub.Target>
                    <Menu.Sub.Dropdown className={classes.quickCommandsMenu}>
                      {quickCommands.slice(0, 10).map((command) => (
                        <Menu.Item
                          key={command.id}
                          leftSection={<IconSparkles size={15} />}
                          onClick={() => handleQuickCommand(command.prompt)}
                        >
                          {command.label}
                        </Menu.Item>
                      ))}
                    </Menu.Sub.Dropdown>
                  </Menu.Sub>
                  <Menu.Sub>
                    <Menu.Sub.Target>
                      <Menu.Sub.Item leftSection={<IconCode size={16} />}>
                        {t("ai.composer.formatting")}
                      </Menu.Sub.Item>
                    </Menu.Sub.Target>
                    <Menu.Sub.Dropdown className={classes.composerMenu}>
                      <Menu.Item
                        onClick={() =>
                          runComposerCommand((editor) =>
                            editor.chain().focus().toggleBold().run(),
                          )
                        }
                      >
                        {t("ai.composer.bold")}
                      </Menu.Item>
                      <Menu.Item
                        onClick={() =>
                          runComposerCommand((editor) =>
                            editor.chain().focus().toggleBulletList().run(),
                          )
                        }
                      >
                        {t("ai.composer.bulletList")}
                      </Menu.Item>
                      <Menu.Item
                        onClick={() =>
                          runComposerCommand((editor) =>
                            editor.chain().focus().toggleBlockquote().run(),
                          )
                        }
                      >
                        {t("ai.composer.quote")}
                      </Menu.Item>
                      <Menu.Item
                        onClick={() =>
                          runComposerCommand((editor) =>
                            editor.chain().focus().toggleCodeBlock().run(),
                          )
                        }
                      >
                        {t("ai.composer.codeBlock")}
                      </Menu.Item>
                      <Menu.Item onClick={openMarkdownLink}>
                        {t("ai.composer.addLink")}
                      </Menu.Item>
                    </Menu.Sub.Dropdown>
                  </Menu.Sub>
                </Menu.Dropdown>
              </Menu>
            )}

            {showComposerProfileControl && (
              <Group
                gap={4}
                wrap="nowrap"
                className={classes.composerProfileGroup}
              >
                {isCompactMobile ? (
                  <Tooltip label={currentProfileLabel} withArrow>
                    <Button
                      variant="default"
                      size="compact-sm"
                      leftSection={
                        selectedProfile ? (
                          <AssistantProfileIcon
                            icon={selectedProfile.icon}
                            size={16}
                          />
                        ) : (
                          <IconRobot size={16} />
                        )
                      }
                      aria-label={t("ai.profiles.selectorLabel")}
                      onClick={() => setProfilePickerOpened(true)}
                      className={classes.composerProfileButton}
                    >
                      <span className={classes.composerResponsiveLabel}>
                        {currentProfileLabel}
                      </span>
                    </Button>
                  </Tooltip>
                ) : (
                  <Menu
                    position="top-start"
                    withinPortal
                    offset={8}
                    width={360}
                    onOpen={() => setComposerProfileQuery("")}
                  >
                    <Menu.Target>
                      <Tooltip label={currentProfileLabel} withArrow>
                        <Button
                          variant="default"
                          size="compact-sm"
                          leftSection={
                            selectedProfile ? (
                              <AssistantProfileIcon
                                icon={selectedProfile.icon}
                                size={16}
                              />
                            ) : activeConversation?.assistantProfile.icon ? (
                              <AssistantProfileIcon
                                icon={activeConversation.assistantProfile.icon}
                                size={16}
                              />
                            ) : (
                              <IconRobot size={16} />
                            )
                          }
                          rightSection={<IconChevronDown size={13} />}
                          disabled={Boolean(pendingRun)}
                          aria-label={t("ai.profiles.selectorLabel")}
                          className={classes.composerProfileButton}
                        >
                          <span className={classes.composerProfileLabel}>
                            {currentProfileLabel}
                          </span>
                        </Button>
                      </Tooltip>
                    </Menu.Target>
                    <Menu.Dropdown className={classes.composerProfileMenu}>
                      <Menu.Label>{t("ai.profiles.selectorLabel")}</Menu.Label>
                      {profileOptions.length > 6 && (
                        <TextInput
                          value={composerProfileQuery}
                          onChange={(event) =>
                            setComposerProfileQuery(event.currentTarget.value)
                          }
                          placeholder={t("ai.profiles.search")}
                          leftSection={<IconSearch size={14} />}
                          size="xs"
                          mx="xs"
                          mb="xs"
                          onKeyDown={(event) => event.stopPropagation()}
                        />
                      )}
                      {visibleComposerProfileOptions.map((option) => {
                        const profile = allAvailableProfiles.find(
                          (item) => item.id === option.value,
                        );

                        return (
                          <Menu.Item
                            key={option.value}
                            leftSection={
                              profile ? (
                                <AssistantProfileIcon
                                  icon={profile.icon}
                                  size={16}
                                />
                              ) : (
                                <IconRobot size={16} />
                              )
                            }
                            rightSection={
                              option.value === currentProfileValue ? (
                                <IconCheck size={15} />
                              ) : null
                            }
                            disabled={option.disabled}
                            data-selected={option.value === currentProfileValue}
                            className={classes.composerProfileMenuItem}
                            onClick={() => {
                              if (option.value !== currentProfileValue) {
                                chooseAssistantProfile(option.value);
                              }
                            }}
                          >
                            <AiProfileOptionContent
                              label={option.label}
                              description={
                                option.description ??
                                t("ai.profiles.noDescription")
                              }
                            />
                          </Menu.Item>
                        );
                      })}
                      {visibleComposerProfileOptions.length === 0 && (
                        <Text size="xs" c="dimmed" ta="center" py="sm">
                          {t("ai.profiles.noneFound")}
                        </Text>
                      )}
                      {(selectedProfile ||
                        (profilePreferencesQuery.data?.hiddenProfileIds
                          .length ?? 0) > 0) && (
                        <>
                          <Menu.Divider />
                          <Menu.Label>
                            {t("ai.profiles.preferences")}
                          </Menu.Label>
                        </>
                      )}
                      {selectedProfile && (
                        <>
                          <Menu.Item
                            leftSection={<IconStar size={15} />}
                            disabled={updateProfilePreferences.isPending}
                            onClick={() =>
                              togglePreferredProfile(selectedProfile.id)
                            }
                          >
                            {profilePreferencesQuery.data
                              ?.preferredProfileId === selectedProfile.id
                              ? t("ai.profiles.clearPreferred")
                              : t("ai.profiles.makePreferred")}
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconEyeOff size={15} />}
                            disabled={updateProfilePreferences.isPending}
                            onClick={() => hideProfile(selectedProfile.id)}
                          >
                            {t("ai.profiles.hide")}
                          </Menu.Item>
                        </>
                      )}
                      {(profilePreferencesQuery.data?.hiddenProfileIds.length ??
                        0) > 0 && (
                        <Menu.Item
                          leftSection={<IconEye size={15} />}
                          disabled={updateProfilePreferences.isPending}
                          onClick={showHiddenProfiles}
                        >
                          {t("ai.profiles.showHidden")}
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            )}

            {profileAgentAvailable && (
              <Menu position="top-start" withinPortal>
                <Menu.Target>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    leftSection={
                      agentMode ? (
                        <IconRobot size={16} />
                      ) : (
                        <IconMessageCircle size={16} />
                      )
                    }
                    rightSection={<IconChevronDown size={13} />}
                    disabled={
                      Boolean(pendingRun) || updateConversation.isPending
                    }
                    className={classes.composerModeButton}
                    aria-label={t("ai.composer.mode")}
                  >
                    <span className={classes.composerResponsiveLabel}>
                      {agentMode ? t("ai.agent.mode") : t("ai.composer.chat")}
                    </span>
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>{t("ai.composer.mode")}</Menu.Label>
                  <Menu.Item
                    leftSection={<IconMessageCircle size={16} />}
                    rightSection={!agentMode ? <IconCheck size={15} /> : null}
                    onClick={() => toggleAgentMode(false)}
                  >
                    {t("ai.composer.chat")}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconRobot size={16} />}
                    rightSection={agentMode ? <IconCheck size={15} /> : null}
                    onClick={() => toggleAgentMode(true)}
                  >
                    {t("ai.agent.mode")}
                  </Menu.Item>
                  <Menu.Divider />
                  <Text size="xs" c="dimmed" px="sm" py={4} maw={260}>
                    {t("ai.agent.modeDescription")}
                  </Text>
                </Menu.Dropdown>
              </Menu>
            )}

            {agentMode && spaceId && availability.externalMcp?.available && (
              <AiExternalMcpOptInControl
                spaceId={spaceId}
                revocationOnly={Boolean(pendingRun)}
              />
            )}

            <Box className={classes.composerStatus}>
              {pendingRun ? (
                <Text
                  size="xs"
                  c="dimmed"
                  lineClamp={1}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className={classes.composerRunStatus}
                  data-testid="ai-composer-run-status"
                >
                  {pendingRun.status === "awaiting_approval"
                    ? t("ai.agent.awaitingApproval")
                    : t("ai.generating")}
                </Text>
              ) : isCompactMobile && draftStatus === "error" ? (
                <AccessibleActionIcon
                  label={t("ai.ux.draftSaveFailed")}
                  color="red"
                  variant="subtle"
                  size={44}
                  minTargetSize={44}
                  onClick={() => void retryDraftSave()}
                >
                  <IconAlertTriangle size={18} />
                </AccessibleActionIcon>
              ) : isCompactMobile &&
                (draftStatus === "saving" || draftStatus === "saved") ? (
                <VisuallyHidden>
                  <span role="status" aria-live="polite">
                    {draftStatus === "saving"
                      ? t("ai.ux.draftSaving")
                      : t("ai.ux.draftSaved")}
                  </span>
                </VisuallyHidden>
              ) : isCompactMobile ? null : draftStatus === "error" ? (
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
                  {draftStatus === "saving" ? (
                    t("ai.ux.draftSaving")
                  ) : draftStatus === "saved" ? (
                    t("ai.ux.draftSaved")
                  ) : (
                    <>
                      <span className={classes.sendShortcutFull}>
                        {t("ai.composer.sendShortcut")}
                      </span>
                      <span className={classes.sendShortcutShort}>
                        {t("ai.composer.sendShortcutShort")}
                      </span>
                    </>
                  )}
                </Text>
              )}
            </Box>

            {pendingRun ? (
              <AccessibleActionIcon
                label={t("ai.stop")}
                size={useLargeComposerTargets ? 44 : 40}
                minTargetSize={useLargeComposerTargets ? 44 : 40}
                radius="xl"
                color="red"
                variant="filled"
                className={classes.sendButton}
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
                <IconPlayerStop size={17} />
              </AccessibleActionIcon>
            ) : (
              <AccessibleActionIcon
                label={t("ai.send")}
                size={useLargeComposerTargets ? 44 : 40}
                minTargetSize={useLargeComposerTargets ? 44 : 40}
                radius="xl"
                variant="filled"
                className={classes.sendButton}
                disabled={
                  !draft.trim() ||
                  sendMessage.isPending ||
                  !selectedFilesAreReady
                }
                loading={sendMessage.isPending}
                onClick={() => void submit(draft)}
              >
                <IconSend size={18} />
              </AccessibleActionIcon>
            )}
          </Group>
        </AiComposerShell>
      </Box>

      <Modal
        opened={markdownLinkOpened}
        onClose={() => setMarkdownLinkOpened(false)}
        title={t("ai.composer.addLink")}
        closeButtonProps={{ "aria-label": t("Close") }}
        centered
        size="sm"
      >
        <TextInput
          value={markdownLinkHref}
          onChange={(event) => setMarkdownLinkHref(event.currentTarget.value)}
          label={t("URL")}
          placeholder="https://example.com"
          type="url"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              saveMarkdownLink();
            }
          }}
        />
        <Group justify="flex-end" mt="lg">
          <Button
            variant="default"
            onClick={() => setMarkdownLinkOpened(false)}
          >
            {t("Cancel")}
          </Button>
          <Button
            disabled={!markdownLinkHref.trim()}
            onClick={saveMarkdownLink}
          >
            {t("Save")}
          </Button>
        </Group>
      </Modal>

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
        opened={Boolean(isCompactMobile && profilePickerOpened)}
        onClose={() => setProfilePickerOpened(false)}
        title={t("ai.profiles.selectorLabel")}
        closeButtonProps={{ "aria-label": t("Close") }}
        position="bottom"
        size="100dvh"
        transitionProps={{ duration: reduceMotion ? 0 : 180 }}
      >
        <Stack gap="sm">
          <TextInput
            value={profileQuery}
            onChange={(event) => setProfileQuery(event.currentTarget.value)}
            placeholder={t("ai.profiles.search")}
            leftSection={<IconSearch size={15} />}
            autoFocus
          />
          {visibleMobileProfileOptions.map((option) => {
            const profile = allAvailableProfiles.find(
              (item) => item.id === option.value,
            );
            const visibleProfile = availableProfiles.find(
              (item) => item.id === option.value,
            );

            return (
              <Group key={option.value} gap={4} wrap="nowrap" align="stretch">
                <Button
                  variant={
                    option.value === currentProfileValue ? "light" : "subtle"
                  }
                  justify="flex-start"
                  leftSection={
                    profile ? (
                      <AssistantProfileIcon icon={profile.icon} size={16} />
                    ) : (
                      <IconRobot size={16} />
                    )
                  }
                  rightSection={
                    option.value === currentProfileValue ? (
                      <IconCheck size={15} />
                    ) : null
                  }
                  disabled={option.disabled}
                  className={classes.mobileProfileOptionButton}
                  onClick={() => {
                    if (option.value !== currentProfileValue) {
                      chooseAssistantProfile(option.value);
                    }
                    setProfilePickerOpened(false);
                  }}
                  style={{ flex: 1 }}
                >
                  <AiProfileOptionContent
                    label={option.label}
                    description={
                      option.description ?? t("ai.profiles.noDescription")
                    }
                  />
                </Button>
                {visibleProfile && (
                  <>
                    <AccessibleActionIcon
                      variant={
                        profilePreferencesQuery.data?.preferredProfileId ===
                        visibleProfile.id
                          ? "light"
                          : "subtle"
                      }
                      label={
                        profilePreferencesQuery.data?.preferredProfileId ===
                        visibleProfile.id
                          ? t("ai.profiles.clearPreferred")
                          : t("ai.profiles.makePreferred")
                      }
                      onClick={() => togglePreferredProfile(visibleProfile.id)}
                      disabled={updateProfilePreferences.isPending}
                    >
                      <IconStar size={16} />
                    </AccessibleActionIcon>
                    <AccessibleActionIcon
                      variant="subtle"
                      label={t("ai.profiles.hide")}
                      onClick={() => hideProfile(visibleProfile.id)}
                      disabled={updateProfilePreferences.isPending}
                    >
                      <IconEyeOff size={16} />
                    </AccessibleActionIcon>
                  </>
                )}
              </Group>
            );
          })}
          {visibleMobileProfileOptions.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="lg">
              {t("ai.profiles.noneFound")}
            </Text>
          )}
          {(profilePreferencesQuery.data?.hiddenProfileIds.length ?? 0) > 0 && (
            <Button
              variant="subtle"
              justify="flex-start"
              leftSection={<IconEye size={16} />}
              onClick={showHiddenProfiles}
              loading={updateProfilePreferences.isPending}
            >
              {t("ai.profiles.showHidden")}
            </Button>
          )}
        </Stack>
      </Drawer>

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
                    {conversation.assistantProfile.name && (
                      <Group gap={4} wrap="nowrap">
                        {conversation.assistantProfile.icon && (
                          <AssistantProfileIcon
                            icon={conversation.assistantProfile.icon}
                            size={12}
                          />
                        )}
                        <Text size="xs" c="dimmed" truncate>
                          {conversation.assistantProfile.name} · v
                          {conversation.assistantProfile.version}
                          {conversation.assistantProfile.availability !==
                          "available"
                            ? ` · ${t("ai.profiles.unavailable")}`
                            : ""}
                        </Text>
                      </Group>
                    )}
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
        title={t("ai.composer.addToMessage")}
        closeButtonProps={{ "aria-label": t("Close") }}
        position="bottom"
        size="75dvh"
        transitionProps={{ duration: reduceMotion ? 0 : 180 }}
      >
        <Stack gap="sm">
          <Group grow>
            <FileButton
              accept={AI_CHAT_FILE_ACCEPT}
              multiple
              onChange={(files) => {
                setQuickCommandsOpened(false);
                void uploadFiles(files);
              }}
            >
              {(fileButtonProps) => (
                <Button
                  {...fileButtonProps}
                  variant="light"
                  leftSection={<IconPaperclip size={17} />}
                >
                  {t("ai.attachFiles")}
                </Button>
              )}
            </FileButton>
            <Button
              variant="light"
              leftSection={<IconBook size={17} />}
              onClick={() => {
                setQuickCommandsOpened(false);
                setContextManagerOpened(true);
              }}
            >
              {t("ai.context.managerTitle")}
            </Button>
          </Group>
          {spaceSearchReady && (
            <Button
              variant={useSpaceSearch ? "light" : "default"}
              leftSection={<IconSearch size={17} />}
              rightSection={useSpaceSearch ? <IconCheck size={16} /> : null}
              onClick={() => toggleSpaceSearch(!useSpaceSearch)}
            >
              {t("ai.searchSpace")}
            </Button>
          )}
          <Text size="xs" fw={600} c="dimmed">
            {t("ai.composer.templates")}
          </Text>
          <TextInput
            value={quickCommandQuery}
            onChange={(event) =>
              setQuickCommandQuery(event.currentTarget.value)
            }
            placeholder={t("ai.ux.searchCommands")}
            leftSection={<IconSearch size={15} />}
          />
          <ScrollArea.Autosize mah="calc(75dvh - 250px)">
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
          <Text size="xs" fw={600} c="dimmed">
            {t("ai.composer.formatting")}
          </Text>
          <Group grow>
            <Button
              variant="default"
              onClick={() => {
                setQuickCommandsOpened(false);
                runComposerCommand((editor) =>
                  editor.chain().focus().toggleBold().run(),
                );
              }}
            >
              {t("ai.composer.bold")}
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setQuickCommandsOpened(false);
                runComposerCommand((editor) =>
                  editor.chain().focus().toggleBulletList().run(),
                );
              }}
            >
              {t("ai.composer.bulletList")}
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </Stack>
  );
}

function AssistantProfileIcon({
  icon,
  size,
}: {
  icon: AiAssistantProfileIcon;
  size: number;
}) {
  const props = { size, "aria-hidden": true } as const;
  switch (icon) {
    case "robot":
      return <IconRobot {...props} />;
    case "brain":
      return <IconBrain {...props} />;
    case "book":
      return <IconBook {...props} />;
    case "briefcase":
      return <IconBriefcase {...props} />;
    case "code":
      return <IconCode {...props} />;
    case "language":
      return <IconLanguage {...props} />;
    case "search":
      return <IconSearch {...props} />;
    default:
      return <IconSparkles {...props} />;
  }
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
