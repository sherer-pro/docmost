import { NodeViewContent, NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCheck,
  IconCopy,
  IconDots,
  IconLinkOff,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import classes from "./transclusion.module.css";
import SyncBlockReferencesDropdown from "@/features/transclusion/components/sync-block-references-dropdown";
import {
  buildSyncedBlockClipboardPayload,
  writeTransclusionClipboard,
} from "@/features/editor/extensions/transclusion-clipboard";
import { useReferencesQuery } from "@/features/transclusion/queries/transclusion-query";
import type {
  TransclusionDeletionGuardStorage,
  TransclusionSourceState,
} from "@/features/editor/extensions/transclusion-deletion-guard";

export default function TransclusionView(props: NodeViewProps) {
  const { editor, node, deleteNode } = props;
  const { t } = useTranslation();
  const [openMenus, setOpenMenus] = useState(0);
  const trackOpen = (open: boolean) =>
    setOpenMenus((n) => Math.max(0, n + (open ? 1 : -1)));

  const isEditable = editor.isEditable;
  // @ts-ignore - editor.storage.pageId is set by the host editor (page-editor.tsx onCreate)
  const sourcePageId: string | undefined = editor.storage?.pageId;
  const transclusionId: string | null = node.attrs.id ?? null;
  const referencesQuery = useReferencesQuery(
    sourcePageId ?? null,
    transclusionId,
    isEditable,
  );
  const sourceState: TransclusionSourceState = referencesQuery.data
    ? referencesQuery.data.hasReferences === true
      ? "referenced"
      : referencesQuery.data.hasReferences === false
        ? "unreferenced"
        : "unknown"
    : referencesQuery.isError
      ? "error"
      : "unknown";
  const sourceDeletionBlocked = sourceState !== "unreferenced";
  const sourceDeletionHint =
    sourceState === "referenced"
      ? t("Delete or unsync all copies before removing this synced block.")
      : t(
          "Could not verify synced block copies. Refresh the page and try again.",
        );

  useEffect(() => {
    if (!isEditable || !transclusionId) return;
    const storage = (editor.storage as any)
      .transclusionDeletionGuard as TransclusionDeletionGuardStorage;
    storage?.sourceStates.set(transclusionId, sourceState);

    return () => {
      if (storage?.sourceStates.get(transclusionId) === sourceState) {
        storage.sourceStates.delete(transclusionId);
      }
    };
  }, [editor, isEditable, sourceState, transclusionId]);

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!sourcePageId || !transclusionId) return;
    const payload = buildSyncedBlockClipboardPayload({
      editor,
      content: node.content,
      sourcePageId,
      transclusionId,
      strings: {
        label: t("Synced block"),
        unavailable: t("Synced block content unavailable"),
      },
    });
    try {
      await writeTransclusionClipboard(payload);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
    notifications.show({
      message: t("Copied. Paste on any page to embed this synced block."),
    });
  };

  const handleUnsync = () => {
    editor.chain().focus().unsyncTransclusionSource().run();
  };

  return (
    <NodeViewWrapper
      className={classes.transclusionWrap}
      data-editable={isEditable ? "true" : "false"}
      data-menu-open={openMenus > 0 ? "true" : "false"}
      data-id={transclusionId ?? undefined}
      data-type="transclusionSource"
    >
      {isEditable && (
        <div
          className={classes.transclusionControls}
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
        >
          {sourcePageId && transclusionId && (
            <SyncBlockReferencesDropdown
              sourcePageId={sourcePageId}
              transclusionId={transclusionId}
              currentPageId={sourcePageId}
              mode="source"
              onOpenChange={trackOpen}
            />
          )}

          <span className={classes.controlsDivider} />

          <Tooltip label={copied ? t("Copied") : t("Copy synced block")}>
            <ActionIcon
              variant="subtle"
              color={copied ? "teal" : "gray"}
              size="sm"
              onClick={handleCopy}
              disabled={!sourcePageId || !transclusionId}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>

          <Menu position="bottom-end" withinPortal onChange={trackOpen}>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm">
                <IconDots size={14} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconLinkOff size={14} />}
                onClick={handleUnsync}
                disabled={sourceDeletionBlocked}
                title={sourceDeletionBlocked ? sourceDeletionHint : undefined}
              >
                {t("Unsync")}
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => deleteNode()}
                disabled={sourceDeletionBlocked}
                title={sourceDeletionBlocked ? sourceDeletionHint : undefined}
              >
                {t("Delete synced block")}
              </Menu.Item>
              {sourceDeletionBlocked && (
                <Menu.Label>{sourceDeletionHint}</Menu.Label>
              )}
            </Menu.Dropdown>
          </Menu>
        </div>
      )}

      <NodeViewContent />
    </NodeViewWrapper>
  );
}
