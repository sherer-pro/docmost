import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Menu,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconDots,
  IconMessagePlus,
  IconPencil,
  IconPlayerStop,
  IconPlus,
  IconSearch,
  IconSend,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useAtomValue, useSetAtom } from "jotai";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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
  aiLastEditorContextAtom,
  aiStreamingRunsAtom,
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
} from "@/features/ai/queries/ai-query.ts";
import {
  AiConversation,
  AiConversationContext,
  AiContextSource,
  AiMessage,
  AiStreamingRun,
} from "@/features/ai/types/ai.types.ts";
import { captureAiEditorContext } from "@/features/ai/utils/editor-context.ts";
import { AiMessageCard } from "./ai-message-card.tsx";
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

export function AiPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const documentContext = useAtomValue(aiDocumentContextAtom);
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
  const editorContexts = useAtomValue(aiLastEditorContextAtom);
  const setEditorContexts = useSetAtom(aiLastEditorContextAtom);
  const pageId = documentContext?.pageId;
  const spaceId = documentContext?.spaceId;
  const conversationsQuery = useAiConversationsQuery(pageId);
  const availabilityQuery = useAiSpaceStatusQuery(spaceId, pageId);
  const [activeByPage, setActiveByPage] = useState<Record<string, string>>({});
  const activeConversationId = pageId ? activeByPage[pageId] : undefined;
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
  const [renameOpened, setRenameOpened] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const draftHydratedFor = useRef<string | null>(null);
  const draftSaveChain = useRef<Promise<unknown>>(Promise.resolve());
  const contextSaveChain = useRef<Promise<AiConversationContext> | null>(null);
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
    activeRuns.find((run) => ["queued", "running"].includes(run.status)) ??
    (persistedActiveRun && !persistedRunState ? persistedActiveRun : undefined);
  const chatFiles = filesQuery.data ?? [];
  const pageAttachments = pageAttachmentsQuery.data ?? [];
  const context = contextQuery.data;
  const selectedFilesAreReady = (context?.fileIds ?? []).every((fileId) =>
    chatFiles.some((file) => file.id === fileId && file.status === "ready"),
  );
  const documentTitle =
    liveDocumentTitle || documentContext?.title?.trim() || t("ai.untitled");

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
    if (!pageId || activeByPage[pageId] || conversations.length === 0) {
      return;
    }
    const latest = getLatestAiConversation(conversations);
    if (latest) {
      setActiveByPage((current) => ({ ...current, [pageId]: latest.id }));
      touchConversation(latest.id);
    }
  }, [activeByPage, conversations, pageId, touchConversation]);

  useEffect(() => {
    if (!activeConversation) {
      setDraft("");
      setUseSpaceSearch(false);
      draftHydratedFor.current = null;
      contextSaveChain.current = null;
      return;
    }
    draftHydratedFor.current = activeConversation.id;
    setDraft(activeConversation.draft ?? "");
    setUseSpaceSearch(Boolean(activeConversation.useSpaceSearch));
    contextSaveChain.current = null;
  }, [activeConversation?.id]);

  useEffect(() => {
    if (
      !activeConversation ||
      draftHydratedFor.current !== activeConversation.id ||
      draft === (activeConversation.draft ?? "")
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      draftSaveChain.current = draftSaveChain.current
        .catch(() => undefined)
        .then(() =>
          updateConversation.mutateAsync({
            conversationId: activeConversation.id,
            data: { draft },
          }),
        );
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [activeConversation, draft, updateConversation]);

  useEffect(() => {
    followOutputRef.current = true;
  }, [activeConversationId]);

  useEffect(() => {
    if (!followOutputRef.current) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (viewport && followOutputRef.current) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeConversationId,
    messagesQuery.data?.pages[0]?.items.at(-1)?.id,
    pendingRun?.content,
  ]);

  const ensureConversation = async (): Promise<AiConversation> => {
    if (activeConversation) {
      return activeConversation;
    }
    if (!pageId) {
      throw new Error("Page context is missing");
    }

    const conversation = await createConversation.mutateAsync({
      pageId,
      clientRequestId: crypto.randomUUID(),
      useSpaceSearch: false,
    });
    setActiveByPage((current) => ({ ...current, [pageId]: conversation.id }));
    return conversation;
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
            sources: next.sources.map((source) => ({
              sourceType: source.sourceType,
              sourceId: source.sourceId,
            })),
            fileIds: next.fileIds,
            attachmentIds: next.attachmentIds,
          },
        });
      });
    contextSaveChain.current = operation;
    try {
      return await operation;
    } finally {
      if (contextSaveChain.current === operation) {
        contextSaveChain.current = null;
      }
    }
  };

  const submit = async (content: string) => {
    const normalizedContent = content.trim();
    if (
      !normalizedContent ||
      !documentContext?.canWrite ||
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
    setActiveByPage((current) => ({ ...current, [pageId]: conversationId }));
    touchConversation(conversationId);
  };

  const createNewConversation = async () => {
    if (!pageId) {
      return;
    }
    try {
      const conversation = await createConversation.mutateAsync({
        pageId,
        clientRequestId: crypto.randomUUID(),
        useSpaceSearch: false,
      });
      setActiveByPage((current) => ({ ...current, [pageId]: conversation.id }));
    } catch {
      notifications.show({ message: t("ai.createChatFailed"), color: "red" });
    }
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

  const toggleCurrentDocument = (included: boolean) =>
    saveContext((current) => ({
      ...current,
      includeCurrentDocument: included,
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
            all.findIndex(
              (candidate) =>
                candidate.sourceType === item.sourceType &&
                candidate.sourceId === item.sourceId,
            ) === index,
        )
        .slice(0, 10),
    }));

  const removeContextSource = (source: AiContextSource) =>
    saveContext((current) => ({
      ...current,
      sources: current.sources
        .filter(
          (item) =>
            !(
              item.sourceType === source.sourceType &&
              item.sourceId === source.sourceId
            ),
        )
        .map((item, position) => ({ ...item, position })),
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

  const removeChatFile = (fileId: string) => {
    void saveContext((current) => ({
      ...current,
      fileIds: current.fileIds.filter((id) => id !== fileId),
    })).finally(() => deleteFile.mutate(fileId));
  };

  const selectedSourceIdentities = useMemo(
    () =>
      new Set(
        (context?.sources ?? []).map(
          (source) => `${source.sourceType}:${source.sourceId}`,
        ),
      ),
    [context?.sources],
  );
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
          if (
            selectedSourceIdentities.has(
              `${source.sourceType}:${source.sourceId}`,
            )
          ) {
            notifications.show({ message: t("ai.context.alreadyAdded") });
            return result;
          }
          if ((context?.sources.length ?? 0) >= 10) {
            notifications.show({
              message: t("ai.errorReason.contextSourceLimit"),
              color: "orange",
            });
            return result;
          }

          void addContextSource(source).catch((error) => {
            notifications.show({
              message: resolveAiErrorMessage(
                t,
                i18n,
                error?.["response"]?.data?.code,
              ),
              color: "red",
            });
          });
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
                !selectedSourceIdentities.has(
                  `${source.sourceType}:${source.sourceId}`,
                ) &&
                (context?.sources.length ?? 0) < 10,
            ),
          };
        },
      }),
      [
        addContextSource,
        context?.sources.length,
        documentContext?.spaceId,
        i18n,
        selectedSourceIdentities,
        t,
        tree,
      ],
    );

  if (!documentContext) {
    return (
      <Stack align="center" justify="center" h="100%" p="lg">
        <IconMessagePlus size={36} />
        <Text size="sm" c="dimmed" ta="center">
          {t("ai.openDocument")}
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
      availabilityQuery.data?.canUse,
    )
  ) {
    return (
      <Stack align="center" justify="center" h="100%" p="md">
        <Alert
          icon={<IconAlertTriangle size={18} />}
          title={t("ai.loadFailed")}
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
  if (!availability?.canUse) {
    return (
      <Stack p="md">
        <Alert
          icon={<IconAlertTriangle size={18} />}
          title={t("ai.unavailable")}
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
      <Group gap="xs" wrap="nowrap" className={classes.conversationBar}>
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
        />
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

      <ScrollArea
        viewportRef={viewportRef}
        className={classes.messages}
        scrollbarSize={6}
        type="auto"
        onScrollPositionChange={({ y }) => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          followOutputRef.current = isAiChatNearBottom({
            scrollHeight: viewport.scrollHeight,
            scrollTop: y,
            clientHeight: viewport.clientHeight,
          });
        }}
      >
        <Stack gap="sm" p="xs">
          {activeConversation && messagesQuery.isLoading && (
            <Group justify="center" py="xl">
              <Loader size="sm" />
            </Group>
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
              run && ["queued", "running"].includes(run.status),
            );
            const renderedMessage = runIsActive
              ? {
                  ...message,
                  content: run?.content || message.content,
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
                        retryRun.mutate({
                          runId,
                          clientRequestId: crypto.randomUUID(),
                        })
                    : undefined
                }
                onRegenerate={
                  message.role === "assistant" &&
                  !pendingRun &&
                  message.id === latestAssistantMessageId
                    ? () =>
                        regenerateMessage.mutate({
                          messageId: message.id,
                          clientRequestId: crypto.randomUUID(),
                        })
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
              />
            )}
        </Stack>
      </ScrollArea>

      <Box className={classes.composer}>
        <Group gap={4} wrap="nowrap" className={classes.composerToolbar}>
          <Menu position="top-start" withinPortal>
            <Menu.Target>
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconSparkles size={16} />}
                rightSection={<IconChevronDown size={13} />}
                disabled={Boolean(pendingRun)}
                className={classes.toolbarButton}
              >
                {t("ai.settings.quickCommands")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown className={classes.quickCommandsMenu}>
              {quickCommands.map((command) => (
                <Tooltip
                  key={command.id}
                  label={command.description || command.prompt}
                  position="right"
                  withArrow
                >
                  <Menu.Item
                    leftSection={<IconSparkles size={15} />}
                    onClick={() => handleQuickCommand(command.prompt)}
                    aria-description={command.description || command.prompt}
                  >
                    {command.label}
                  </Menu.Item>
                </Tooltip>
              ))}
            </Menu.Dropdown>
          </Menu>

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
                >
                  {t("ai.searchSpace")}
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

          <AiContextPicker
            conversationId={activeConversationId}
            spaceId={documentContext.spaceId}
            documentTitle={documentTitle}
            includeCurrentDocument={context?.includeCurrentDocument ?? true}
            sources={context?.sources ?? []}
            fileIds={context?.fileIds ?? []}
            attachmentIds={context?.attachmentIds ?? []}
            chatFiles={chatFiles}
            pageAttachments={pageAttachments}
            loadingFiles={filesQuery.isLoading}
            saving={updateContext.isPending}
            onToggleCurrentDocument={toggleCurrentDocument}
            onAddSource={addContextSource}
            onRemoveSource={removeContextSource}
            onToggleFile={toggleContextFile}
            onToggleAttachment={toggleContextAttachment}
            onUpload={uploadFiles}
            onDeleteFile={removeChatFile}
          />
        </Group>

        <Textarea
          aria-label={t("ai.messagePlaceholder")}
          placeholder={t("ai.messagePlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
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
          <Text size="xs" c="dimmed" lineClamp={1}>
            {pendingRun ? t("ai.generating") : t("ai.sendShortcut")}
          </Text>

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
    </Stack>
  );
}

function AiStreamingPlaceholder({
  run,
  generatingLabel,
}: {
  run: AiStreamingRun;
  generatingLabel: string;
}) {
  return (
    <Alert color="blue" icon={<Loader size="xs" />} aria-live="polite">
      {run.content || generatingLabel}
    </Alert>
  );
}
