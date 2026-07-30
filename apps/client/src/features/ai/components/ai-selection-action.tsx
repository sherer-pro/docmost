import {
  ActionIcon,
  Alert,
  Button,
  Drawer,
  Group,
  Loader,
  Paper,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconPlayerStop,
  IconReplace,
  IconSparkles,
} from "@tabler/icons-react";
import { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@mantine/hooks";
import { socketAtom } from "@/features/websocket/atoms/socket-atom.ts";
import { DEFAULT_AI_QUICK_COMMANDS } from "@/features/ai/constants/quick-commands.ts";
import {
  useAiSpaceStatusQuery,
  useCancelAiEditorActionMutation,
  useCreateAiEditorActionMutation,
} from "@/features/ai/queries/ai-query.ts";
import {
  getAiEditorAction,
  getAiSpaceStatus,
} from "@/features/ai/services/ai-service.ts";
import {
  AiEditorActionDeltaEvent,
  AiEditorActionRun,
  AiEditorActionStatusEvent,
  AiEditorContext,
} from "@/features/ai/types/ai.types.ts";
import {
  captureAiEditorContext,
  isEditorContextCurrent,
} from "@/features/ai/utils/editor-context.ts";
import {
  mergeAiQuickCommands,
  resolveAiErrorMessage,
} from "@/features/ai/utils/ai-policies.ts";
import { sanitizeAiMarkdown } from "@/features/ai/utils/ai-markdown.ts";
import classes from "@/features/editor/components/bubble-menu/bubble-menu.module.css";

type ApplyMode = "replace" | "before" | "after";

interface AiSelectionActionButtonProps {
  editor: Editor;
  pageId: string;
  spaceId: string;
  compact?: boolean;
}

export function AiSelectionActionButton({
  editor,
  pageId,
  spaceId,
}: AiSelectionActionButtonProps) {
  const { t, i18n } = useTranslation();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const socket = useAtomValue(socketAtom);
  const availability = useAiSpaceStatusQuery(spaceId, pageId);
  const createAction = useCreateAiEditorActionMutation();
  const cancelAction = useCancelAiEditorActionMutation();
  const [opened, setOpened] = useState(false);
  const [snapshot, setSnapshot] = useState<AiEditorContext | null>(null);
  const [run, setRun] = useState<AiEditorActionRun | null>(null);
  const [selectedDescription, setSelectedDescription] = useState("");

  const commands = useMemo(
    () =>
      mergeAiQuickCommands(
        DEFAULT_AI_QUICK_COMMANDS.map((command, position) => ({
          id: command.id,
          label: t(command.translationKey),
          prompt: t(command.promptTranslationKey),
          description: t(command.descriptionTranslationKey),
          enabled: true,
          position,
        })),
        availability.data?.quickCommands ?? [],
      ),
    [availability.data?.quickCommands, t],
  );

  useEffect(() => {
    if (!socket || !run) return;
    const handleDelta = async (
      raw: AiEditorActionDeltaEvent | { data: AiEditorActionDeltaEvent },
    ) => {
      const event = unwrapEvent(raw);
      if (event.runId !== run.id) return;
      if (event.sequence <= run.sequence) return;
      if (event.sequence !== run.sequence + 1) {
        const recovered = await getAiEditorAction(run.id);
        setRun(recovered);
        return;
      }
      setRun((current) =>
        current
          ? {
              ...current,
              response: current.response + event.delta,
              sequence: event.sequence,
              status: "running",
            }
          : current,
      );
    };
    const handleStatus = async (
      raw: AiEditorActionStatusEvent | { data: AiEditorActionStatusEvent },
    ) => {
      const event = unwrapEvent(raw);
      if (event.runId !== run.id || event.sequence <= run.sequence) return;
      const recovered = await getAiEditorAction(run.id);
      setRun(recovered);
    };
    socket.on("ai:editor-action.delta", handleDelta);
    socket.on("ai:editor-action.status", handleStatus);
    return () => {
      socket.off("ai:editor-action.delta", handleDelta);
      socket.off("ai:editor-action.status", handleStatus);
    };
  }, [run, socket]);

  const open = () => {
    const captured = captureAiEditorContext(editor, pageId);
    if (!captured.selection.text.trim()) {
      notifications.show({
        message: t("ai.errorReason.editorSelectionRequired"),
        color: "orange",
      });
      return;
    }
    setSnapshot(captured);
    setRun(null);
    setSelectedDescription("");
    setOpened(true);
  };

  const execute = async (command: (typeof commands)[number]) => {
    if (!snapshot) return;
    setSelectedDescription(command.description || command.prompt);
    try {
      const created = await createAction.mutateAsync({
        pageId,
        clientRequestId: crypto.randomUUID(),
        commandId: command.id,
        instruction: command.prompt,
        selection: snapshot.selection,
        snapshotHash: snapshot.documentHash,
      });
      setRun(created);
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

  const copy = async () => {
    if (!run?.response) return;
    await navigator.clipboard.writeText(run.response);
    notifications.show({ message: t("ai.copied") });
  };

  const apply = (mode: ApplyMode) => {
    if (!snapshot || !run?.response) return;
    if (mode !== "replace") {
      void confirmApply(mode);
      return;
    }
    modals.openConfirmModal({
      title: t("ai.selection.applyTitle"),
      children: <Text size="sm">{t(`ai.selection.confirm.${mode}`)}</Text>,
      labels: { confirm: t("ai.apply"), cancel: t("ai.cancel") },
      onConfirm: () => void confirmApply(mode),
    });
  };

  const confirmApply = async (mode: ApplyMode) => {
    if (!snapshot || !run?.response) return;
    try {
      const currentAvailability = await getAiSpaceStatus(spaceId, pageId);
      if (!currentAvailability.editorActionsAvailable) {
        throw new Error("not-writable");
      }
      if (!isEditorContextCurrent(editor, pageId, snapshot)) {
        notifications.show({
          message: t("ai.errorReason.editorContextStale"),
          color: "orange",
        });
        return;
      }
      const html = sanitizeAiMarkdown(run.response);
      if (mode === "replace") {
        editor
          .chain()
          .focus()
          .insertContentAt(
            {
              from: snapshot.selection.from,
              to: snapshot.selection.to,
            },
            html,
          )
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContentAt(
            mode === "before" ? snapshot.selection.from : snapshot.selection.to,
            html,
          )
          .run();
      }
      notifications.show({ message: t("ai.applied") });
      setOpened(false);
    } catch {
      notifications.show({
        message: t("ai.applyUnavailable"),
        color: "red",
      });
    }
  };

  const completed = run?.status === "completed" && Boolean(run.response);
  const active = run && ["queued", "running"].includes(run.status);
  const contextCurrent = snapshot
    ? isEditorContextCurrent(editor, pageId, snapshot)
    : false;

  const content = (
    <Stack gap="sm">
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed" mb={4}>
          {t("ai.selection.selectedText")}
        </Text>
        <Text size="sm" lineClamp={6}>
          {snapshot?.selection.text}
        </Text>
      </Paper>

      {!run && (
        <ScrollArea.Autosize mah={320}>
          <Stack gap={6}>
            {commands.map((command) => (
              <Tooltip
                key={command.id}
                label={command.description || command.prompt}
                position="right"
                withArrow
              >
                <Button
                  variant="light"
                  justify="flex-start"
                  leftSection={<IconSparkles size={15} />}
                  loading={createAction.isPending}
                  onClick={() => void execute(command)}
                >
                  <Stack gap={0} align="flex-start">
                    <Text size="sm">{command.label}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {command.description || command.prompt}
                    </Text>
                  </Stack>
                </Button>
              </Tooltip>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}

      {selectedDescription && (
        <Text size="xs" c="dimmed">
          {selectedDescription}
        </Text>
      )}
      {run && (
        <Paper withBorder p="sm" aria-live="polite">
          {run.response ? (
            <Text style={{ whiteSpace: "pre-wrap" }}>{run.response}</Text>
          ) : active ? (
            <Group gap="xs" role="status">
              <Loader size="xs" type="dots" />
              <Text size="sm">{t("ai.generating")}</Text>
            </Group>
          ) : null}
          {run.status === "failed" && (
            <Alert color="red" mt="xs">
              {resolveAiErrorMessage(t, i18n, run.errorCode)}
            </Alert>
          )}
        </Paper>
      )}

      <Group justify="space-between" wrap="wrap">
        {active ? (
          <Button
            color="red"
            variant="light"
            leftSection={<IconPlayerStop size={15} />}
            loading={cancelAction.isPending}
            onClick={async () => {
              if (!run) return;
              setRun(await cancelAction.mutateAsync(run.id));
            }}
          >
            {t("ai.stop")}
          </Button>
        ) : (
          <span />
        )}
        {completed && (
          <Group gap="xs" wrap="wrap">
            <Button
              variant="subtle"
              leftSection={<IconCopy size={15} />}
              onClick={() => void copy()}
            >
              {t("ai.copy")}
            </Button>
            <Button
              variant="subtle"
              leftSection={<IconArrowUp size={15} />}
              disabled={!contextCurrent}
              onClick={() => apply("before")}
            >
              {t("ai.selection.insertBefore")}
            </Button>
            <Button
              variant="subtle"
              leftSection={<IconArrowDown size={15} />}
              disabled={!contextCurrent}
              onClick={() => apply("after")}
            >
              {t("ai.selection.insertAfter")}
            </Button>
            <Button
              leftSection={<IconReplace size={15} />}
              disabled={!contextCurrent}
              onClick={() => apply("replace")}
            >
              {t("ai.replaceSelection")}
            </Button>
          </Group>
        )}
      </Group>
      {completed && !contextCurrent && (
        <Alert color="orange">{t("ai.selection.staleCopyOnly")}</Alert>
      )}
    </Stack>
  );

  const trigger = (
    <Tooltip label={t("ai.selection.open")} withArrow withinPortal={false}>
      <ActionIcon
        variant="default"
        size="lg"
        radius="6px"
        aria-label={t("ai.selection.open")}
        style={{ border: "none" }}
        disabled={availability.data?.editorActionsAvailable === false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={open}
      >
        <IconSparkles size={16} stroke={2} />
      </ActionIcon>
    </Tooltip>
  );

  return (
    <>
      <Popover
        opened={!isMobile && opened}
        onChange={setOpened}
        position="bottom-end"
        width={440}
        shadow="lg"
        withinPortal
        trapFocus
        transitionProps={{ duration: reduceMotion ? 0 : 160 }}
      >
        <Popover.Target>{trigger}</Popover.Target>
        {!isMobile && (
          <Popover.Dropdown>
            <Text fw={600} size="sm" mb="sm">
              {t("ai.selection.title")}
            </Text>
            {content}
          </Popover.Dropdown>
        )}
      </Popover>
      {isMobile && (
        <Drawer
          opened={opened}
          onClose={() => setOpened(false)}
          title={t("ai.selection.title")}
          closeButtonProps={{ "aria-label": t("Close") }}
          position="bottom"
          size="85dvh"
          padding="md"
          trapFocus
          transitionProps={{ duration: reduceMotion ? 0 : 180 }}
          styles={{
            content: {
              borderStartStartRadius: "var(--mantine-radius-lg)",
              borderStartEndRadius: "var(--mantine-radius-lg)",
            },
            body: {
              paddingBottom:
                "calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom))",
            },
          }}
        >
          {content}
        </Drawer>
      )}
    </>
  );
}

export function AiFixedSelectionBubble({
  editor,
  pageId,
  spaceId,
}: {
  editor: Editor;
  pageId: string;
  spaceId: string;
}) {
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: currentEditor, state }) => {
        const { from, to, empty } = state.selection;
        return (
          currentEditor.isEditable &&
          !empty &&
          Boolean(state.doc.textBetween(from, to, " ").trim())
        );
      }}
      options={{ placement: "top", offset: 8 }}
      style={{ zIndex: 201, position: "relative" }}
    >
      <div className={classes.bubbleMenu}>
        <AiSelectionActionButton
          editor={editor}
          pageId={pageId}
          spaceId={spaceId}
          compact
        />
      </div>
    </BubbleMenu>
  );
}

function unwrapEvent<T>(value: T | { data: T }): T {
  return value && typeof value === "object" && "data" in value
    ? (value as { data: T }).data
    : (value as T);
}
