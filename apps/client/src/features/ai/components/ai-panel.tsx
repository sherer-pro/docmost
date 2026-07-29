import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  FileButton,
  Group,
  Indicator,
  Loader,
  Menu,
  Modal,
  Popover,
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
  IconFileText,
  IconMessagePlus,
  IconPaperclip,
  IconPencil,
  IconPlayerStop,
  IconPlus,
  IconSearch,
  IconSend,
  IconSparkles,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useAtomValue, useSetAtom } from "jotai";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
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
  shouldShowAiPanelLoadFailure,
  sortAiMessagesChronologically,
} from "@/features/ai/utils/ai-policies.ts";

export function AiPanel() {
  const { t } = useTranslation();
  const documentContext = useAtomValue(aiDocumentContextAtom);
  const editor = useAtomValue(pageEditorAtom);
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
  const filesQuery = useAiChatFilesQuery(activeConversationId);
  const pageAttachmentsQuery = useAiPageAttachmentsQuery(pageId);
  const createConversation = useCreateAiConversationMutation();
  const updateConversation = useUpdateAiConversationMutation(pageId);
  const { mutate: touchConversation } = useOpenAiConversationMutation(pageId);
  const deleteConversation = useDeleteAiConversationMutation(pageId);
  const sendMessage = useSendAiMessageMutation();
  const uploadFilesMutation = useUploadAiChatFilesMutation();
  const cancelRun = useCancelAiRunMutation();
  const retryRun = useRetryAiRunMutation(activeConversationId);
  const regenerateMessage =
    useRegenerateAiMessageMutation(activeConversationId);
  const deleteFile = useDeleteAiChatFileMutation(activeConversationId);
  const [draft, setDraft] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>(
    [],
  );
  const [useSpaceSearch, setUseSpaceSearch] = useState(false);
  const [renameOpened, setRenameOpened] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const draftHydratedFor = useRef<string | null>(null);
  const draftSaveChain = useRef<Promise<unknown>>(Promise.resolve());
  const viewportRef = useRef<HTMLDivElement | null>(null);

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
  const pendingRun =
    activeRuns.find((run) => ["queued", "running"].includes(run.status)) ??
    persistedActiveRun;
  const chatFiles = filesQuery.data ?? [];
  const pageAttachments = pageAttachmentsQuery.data ?? [];
  const selectedContextCount =
    selectedFileIds.length + selectedAttachmentIds.length;
  const selectedFilesAreReady = selectedFileIds.every((fileId) =>
    chatFiles.some((file) => file.id === fileId && file.status === "ready"),
  );

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
      return;
    }
    draftHydratedFor.current = activeConversation.id;
    setDraft(activeConversation.draft ?? "");
    setUseSpaceSearch(Boolean(activeConversation.useSpaceSearch));
    setSelectedFileIds([]);
    setSelectedAttachmentIds([]);
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
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  }, [messagesQuery.data?.pages[0]?.items.at(-1)?.id, pendingRun?.content]);

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
          message: t("Uploading file"),
          color: "blue",
        });
      }
      return;
    }

    try {
      const conversation = await ensureConversation();
      const editorContext = captureAiEditorContext(
        editor,
        documentContext.pageId,
      );
      const result = await sendMessage.mutateAsync({
        conversationId: conversation.id,
        content: normalizedContent,
        pageId: documentContext.pageId,
        clientRequestId: crypto.randomUUID(),
        useSpaceSearch:
          useSpaceSearch && availabilityQuery.data?.retrievalAvailable === true,
        fileIds: selectedFileIds,
        attachmentIds: selectedAttachmentIds,
        editorContext,
      });

      setEditorContexts((current) => ({
        ...current,
        [conversation.id]: editorContext,
        [result.run.id]: editorContext,
        [result.assistantMessage.id]: editorContext,
      }));
      setDraft("");
      setSelectedFileIds([]);
      setSelectedAttachmentIds([]);
      updateConversation.mutate({
        conversationId: conversation.id,
        data: { draft: "" },
      });
    } catch (error) {
      notifications.show({
        message: error?.["response"]?.data?.message ?? t("ai.sendFailed"),
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
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
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
      setSelectedFileIds((current) => [
        ...new Set([...current, ...batch.files.map((file) => file.id)]),
      ]);
    } catch (error) {
      notifications.show({
        message: error?.["response"]?.data?.message ?? t("ai.uploadFailed"),
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
            {t("Try again")}
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
    .find(
    (message) => message.role === "assistant",
  )?.id;
  const spaceSearchReady = availability.retrievalAvailable;
  const quickCommands = mergeAiQuickCommands(
    DEFAULT_AI_QUICK_COMMANDS.map((command, position) => ({
      id: command.id,
      label: t(command.translationKey),
      prompt: command.prompt,
      enabled: true,
      position,
    })),
    availability.quickCommands ?? [],
  );

  return (
    <Stack gap="sm" h="100%" className={classes.panel}>
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

      {!spaceSearchReady && useSpaceSearch && (
        <Alert color="yellow" py="xs">
          {t("ai.spaceSearchUnavailable")}
        </Alert>
      )}

      <ScrollArea
        viewportRef={viewportRef}
        className={classes.messages}
        scrollbarSize={6}
        type="auto"
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
                {t("Try again")}
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
                <Menu.Item
                  key={command.id}
                  leftSection={<IconSparkles size={15} />}
                  onClick={() => handleQuickCommand(command.prompt)}
                >
                  {command.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>

          <Menu position="top-start" withinPortal>
            <Menu.Target>
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={
                  useSpaceSearch && spaceSearchReady ? (
                    <IconSearch size={16} />
                  ) : (
                    <IconFileText size={16} />
                  )
                }
                rightSection={<IconChevronDown size={13} />}
                disabled={Boolean(pendingRun)}
                className={classes.toolbarButton}
              >
                {useSpaceSearch && spaceSearchReady
                  ? t("ai.searchSpace")
                  : t("ai.currentDocumentOnly")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconFileText size={15} />}
                rightSection={
                  !useSpaceSearch ? <IconCheck size={15} /> : undefined
                }
                onClick={() => toggleSpaceSearch(false)}
              >
                {t("ai.currentDocumentOnly")}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconSearch size={15} />}
                rightSection={
                  useSpaceSearch && spaceSearchReady ? (
                    <IconCheck size={15} />
                  ) : undefined
                }
                disabled={!spaceSearchReady}
                onClick={() => toggleSpaceSearch(true)}
              >
                {t("ai.searchSpace")}
              </Menu.Item>
              {!spaceSearchReady && (
                <Menu.Label>{t("ai.spaceSearchUnavailable")}</Menu.Label>
              )}
            </Menu.Dropdown>
          </Menu>

          <Popover width={300} position="top-end" shadow="md" withinPortal>
            <Popover.Target>
              <Indicator
                inline
                size={16}
                label={selectedContextCount}
                disabled={selectedContextCount === 0}
                offset={3}
              >
                <ActionIcon
                  variant="subtle"
                  size={34}
                  aria-label={t("ai.attachFiles")}
                >
                  <IconPaperclip size={18} />
                </ActionIcon>
              </Indicator>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="xs">
                <FileButton
                  onChange={(files) => void uploadFiles(files)}
                  accept=".pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp"
                  multiple
                >
                  {(props) => (
                    <Button
                      {...props}
                      variant="light"
                      size="sm"
                      fullWidth
                      leftSection={<IconUpload size={16} />}
                    >
                      {t("ai.attachFiles")}
                    </Button>
                  )}
                </FileButton>

                {filesQuery.isLoading && (
                  <Group justify="center" py="xs">
                    <Loader size="xs" />
                  </Group>
                )}

                {chatFiles.length > 0 && (
                  <>
                    <Divider
                      label={t("ai.uploadedFiles")}
                      labelPosition="left"
                    />
                    <Stack gap={4} className={classes.contextFileList}>
                      {chatFiles.map((file) => (
                        <Group
                          key={file.id}
                          gap={4}
                          wrap="nowrap"
                          className={classes.contextFileRow}
                        >
                          <Checkbox
                            size="xs"
                            checked={selectedFileIds.includes(file.id)}
                            disabled={file.status !== "ready"}
                            className={classes.contextFileCheckbox}
                            onChange={(event) =>
                              setSelectedFileIds((current) =>
                                event.currentTarget.checked
                                  ? [...new Set([...current, file.id])]
                                  : current.filter((id) => id !== file.id),
                              )
                            }
                            label={file.name}
                          />
                          {file.status !== "ready" && (
                            <Badge
                              variant="light"
                              color={file.status === "failed" ? "red" : "blue"}
                              size="xs"
                            >
                              {t(`ai.fileStatus.${file.status}`)}
                            </Badge>
                          )}
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size={28}
                            aria-label={t("ai.deleteFile")}
                            loading={deleteFile.isPending}
                            onClick={() => {
                              setSelectedFileIds((current) =>
                                current.filter((id) => id !== file.id),
                              );
                              deleteFile.mutate(file.id);
                            }}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Group>
                      ))}
                    </Stack>
                  </>
                )}

                {pageAttachments.length > 0 && (
                  <>
                    <Divider
                      label={t("ai.pageAttachments")}
                      labelPosition="left"
                    />
                    <Stack gap={6} className={classes.contextFileList}>
                      {pageAttachments.map((file) => (
                        <Checkbox
                          key={file.id}
                          size="xs"
                          checked={selectedAttachmentIds.includes(file.id)}
                          className={classes.contextFileCheckbox}
                          onChange={(event) =>
                            setSelectedAttachmentIds((current) =>
                              event.currentTarget.checked
                                ? [...new Set([...current, file.id])]
                                : current.filter((id) => id !== file.id),
                            )
                          }
                          label={file.fileName}
                        />
                      ))}
                    </Stack>
                  </>
                )}
              </Stack>
            </Popover.Dropdown>
          </Popover>
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
              onClick={() => cancelRun.mutate(pendingRun.runId)}
            >
              {t("ai.stop")}
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
            {t("Cancel")}
          </Button>
          <Button
            leftSection={<IconCheck size={16} />}
            disabled={!renameValue.trim()}
            loading={updateConversation.isPending}
            onClick={() => void saveRename()}
          >
            {t("Save")}
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
