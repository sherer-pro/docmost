import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCopy,
  IconPlayerTrackNext,
  IconRefresh,
  IconReplace,
} from "@tabler/icons-react";
import { Editor } from "@tiptap/core";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import {
  AiApplyContext,
  AiEditorContext,
  AiMessage,
} from "@/features/ai/types/ai.types.ts";
import { AiDocumentContext } from "@/features/ai/types/ai.types.ts";
import { isEditorContextCurrent } from "@/features/ai/utils/editor-context.ts";
import {
  getAiApplyPolicy,
  getAiErrorTranslationKey,
  isAiMessageRetryable,
} from "@/features/ai/utils/ai-policies.ts";
import { AiMessageContent } from "./ai-message-content.tsx";
import { getAiSpaceStatus } from "@/features/ai/services/ai-service.ts";
import classes from "./ai-panel.module.css";

type ApplyMode = "replace" | "insert";

export function AiMessageCard({
  message,
  editor,
  documentContext,
  editorContext,
  onRetry,
  onRegenerate,
}: {
  message: AiMessage;
  editor: Editor | null;
  documentContext: AiDocumentContext | null;
  editorContext?: AiEditorContext | AiApplyContext;
  onRetry?: () => void;
  onRegenerate?: () => void;
}) {
  const { t } = useTranslation();
  const [applyMode, setApplyMode] = useState<ApplyMode | null>(null);
  const isAssistant = message.role === "assistant";
  const normalizedEditorContext = editorContext
    ? {
        pageId: editorContext.pageId,
        documentHash:
          "documentHash" in editorContext
            ? editorContext.documentHash
            : editorContext.snapshotHash,
      }
    : undefined;
  const selection = editorContext?.selection ?? null;
  const hasContent = Boolean(message.content.trim());
  const canApply = Boolean(
    isAssistant &&
      message.status === "completed" &&
      message.content.trim() &&
      editor &&
      documentContext?.canWrite &&
      editorContext &&
      editorContext.pageId === documentContext?.pageId,
  );
  const contextIsCurrent = useMemo(
    () =>
      Boolean(
        editor &&
          documentContext &&
          isEditorContextCurrent(
            editor,
            documentContext.pageId,
            normalizedEditorContext,
          ),
      ),
    [
      documentContext,
      editor,
      editorContext,
      message.updatedAt,
      normalizedEditorContext?.documentHash,
    ],
  );
  const applyPolicy = getAiApplyPolicy(contextIsCurrent, selection);

  if (message.accessRestricted) {
    return (
      <Paper p="sm" radius="md" withBorder className={classes.assistantMessage}>
        <Text size="sm" c="dimmed">
          {t("ai.accessRestricted")}
        </Text>
      </Paper>
    );
  }

  const copyContent = async () => {
    await navigator.clipboard.writeText(message.content);
    notifications.show({ message: t("ai.copied") });
  };

  const confirmApply = async () => {
    if (
      !editor ||
      !documentContext?.canWrite ||
      !editorContext ||
      editorContext.pageId !== documentContext.pageId ||
      !applyMode
    ) {
      notifications.show({
        message: t("ai.applyUnavailable"),
        color: "red",
      });
      setApplyMode(null);
      return;
    }

    try {
      const availability = await getAiSpaceStatus(
        documentContext.spaceId,
        documentContext.pageId,
      );
      if (!availability.canUse) {
        throw new Error("Page is not writable");
      }
    } catch {
      notifications.show({
        message: t("ai.applyUnavailable"),
        color: "red",
      });
      setApplyMode(null);
      return;
    }

    const current = isEditorContextCurrent(
      editor,
      documentContext.pageId,
      normalizedEditorContext,
    );
    const currentApplyPolicy = getAiApplyPolicy(current, selection);
    if (applyMode === "replace" && !currentApplyPolicy.canReplace) {
      notifications.show({
        message: t("ai.documentChanged"),
        color: "orange",
      });
      setApplyMode(null);
      return;
    }

    const html = DOMPurify.sanitize(String(marked.parse(message.content)));
    if (applyMode === "replace" && selection) {
      editor
        .chain()
        .focus()
        .insertContentAt(
          {
            from: selection.from,
            to: selection.to,
          },
          html,
        )
        .run();
    } else if (current && selection) {
      editor
        .chain()
        .focus()
        .insertContentAt(selection.to, html)
        .run();
    } else {
      editor.chain().focus().insertContent(html).run();
    }

    notifications.show({ message: t("ai.applied") });
    setApplyMode(null);
  };

  return (
    <Paper
      p="sm"
      radius="md"
      withBorder={isAssistant}
      className={isAssistant ? classes.assistantMessage : classes.userMessage}
      aria-live={
        isAssistant && message.status === "streaming" ? "polite" : undefined
      }
      aria-busy={
        isAssistant && message.status === "streaming" ? true : undefined
      }
    >
      <Stack gap="xs">
        {hasContent && (
          <AiMessageContent
            content={message.content}
            sources={message.sources}
          />
        )}
        {message.status === "streaming" && (
          <Group
            gap={7}
            wrap="nowrap"
            role="status"
            aria-label={t("ai.generating")}
            className={classes.generationIndicator}
          >
            <Loader size="xs" type="dots" />
            <Text size="xs" c="dimmed">
              {t("ai.generating")}
            </Text>
          </Group>
        )}

        {message.status === "failed" && (
          <Alert
            icon={<IconAlertTriangle size={17} />}
            title={t("ai.generationFailed")}
            color="red"
            variant="light"
            p="xs"
          >
            <Text size="xs">
              {t(getAiErrorTranslationKey(message.errorCode))}
            </Text>
          </Alert>
        )}
        {message.status === "cancelled" && (
          <Text size="xs" c="dimmed" role="status">
            {t("ai.generationStopped")}
          </Text>
        )}
        {message.retrievalOutcome === "failed" && (
          <Text size="xs" c="orange">
            {t("ai.retrievalFallbackUsed")}
          </Text>
        )}
        {message.retrievalOutcome === "empty" && (
          <Text size="xs" c="dimmed">
            {t("ai.retrievalNoResults")}
          </Text>
        )}

        <Group
          gap={4}
          wrap="wrap"
          justify={isAssistant ? "flex-start" : "flex-end"}
          className={classes.messageActions}
        >
          {hasContent && (
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<IconCopy size={14} />}
              onClick={() => void copyContent()}
            >
              {t("ai.copy")}
            </Button>
          )}
          {canApply && (
            <>
              {applyPolicy.hasRealSelection && (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  leftSection={<IconReplace size={14} />}
                  disabled={!contextIsCurrent}
                  onClick={() => setApplyMode("replace")}
                >
                  {t("ai.replaceSelection")}
                </Button>
              )}
              <Button
                variant="subtle"
                size="compact-xs"
                leftSection={<IconPlayerTrackNext size={14} />}
                onClick={() => setApplyMode("insert")}
              >
                {t("ai.insertAtCursor")}
              </Button>
            </>
          )}
          {isAiMessageRetryable(message.status) && onRetry && (
            <Button
              variant="light"
              color={message.status === "failed" ? "red" : undefined}
              size="compact-xs"
              leftSection={<IconRefresh size={14} />}
              onClick={onRetry}
            >
              {t("ai.retry")}
            </Button>
          )}
          {message.status === "completed" && isAssistant && onRegenerate && (
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<IconRefresh size={14} />}
              onClick={onRegenerate}
            >
              {t("ai.regenerate")}
            </Button>
          )}
        </Group>
      </Stack>

      <Modal
        opened={Boolean(applyMode)}
        onClose={() => setApplyMode(null)}
        title={t("ai.applyConfirmTitle")}
        centered
      >
        <Text size="sm">
          {applyMode === "replace"
            ? t("ai.replaceConfirm")
            : contextIsCurrent
              ? t("ai.insertConfirm")
              : t("ai.insertStaleConfirm")}
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setApplyMode(null)}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void confirmApply()}>{t("ai.apply")}</Button>
        </Group>
      </Modal>
    </Paper>
  );
}
