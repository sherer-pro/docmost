import { useContext, useEffect, useMemo, useState } from "react";
import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ActionIcon, Group, Menu, Paper, Text, Tooltip } from "@mantine/core";
import {
  IconDots,
  IconExternalLink,
  IconLinkOff,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import TransclusionContent from "../transclusion/transclusion-content";
import NoAccessPlaceholder from "../transclusion/no-access-placeholder";
import NotFoundPlaceholder from "../transclusion/not-found-placeholder";
import {
  PageEmbedDepthContext,
  usePageEmbedLookup,
} from "./page-embed-lookup-context";
import {
  detachPageEmbed,
  hashProseMirrorJson,
} from "@/features/page-template/services/page-template-api";
import classes from "./page-embed.module.css";
import type { TransclusionClipboardStorage } from "@/features/editor/extensions/transclusion-clipboard";
import { syncPageEmbedClipboardResolution } from "./page-embed-clipboard";

export default function PageEmbedView({
  editor,
  node,
  deleteNode,
}: NodeViewProps) {
  const { t } = useTranslation();
  const sourcePageId = node.attrs.sourcePageId as string | null;
  const referenceNodeId = node.attrs.id as string | null;
  const { result, refresh, maxDepth } = usePageEmbedLookup(sourcePageId);
  useEffect(() => {
    if (!sourcePageId || !referenceNodeId) return;
    const storage = (editor.storage as any).transclusionClipboard as
      | TransclusionClipboardStorage
      | undefined;
    if (!storage) return;
    return syncPageEmbedClipboardResolution({
      storage,
      sourcePageId,
      referenceNodeId,
      result,
      maxDepth,
    });
  }, [editor, maxDepth, referenceNodeId, result, sourcePageId]);
  const ancestry = useContext(PageEmbedDepthContext);
  const [pending, setPending] = useState(false);
  const unavailableByGraph =
    !sourcePageId ||
    (maxDepth !== null && ancestry.depth >= maxDepth) ||
    ancestry.visited.has(sourcePageId);
  const nextAncestry = useMemo(() => {
    const visited = new Set(ancestry.visited);
    if (sourcePageId) visited.add(sourcePageId);
    return { depth: ancestry.depth + 1, visited };
  }, [ancestry.depth, ancestry.visited, sourcePageId]);
  // @ts-ignore host editors expose their page id through storage
  const consumerPageId = editor.storage?.pageId as string | undefined;

  const handleDetach = async () => {
    if (!consumerPageId || !referenceNodeId) return;
    setPending(true);
    try {
      await detachPageEmbed({
        consumerPageId,
        referenceNodeId,
        baseContentHash: await hashProseMirrorJson(editor.getJSON()),
      });
      notifications.show({ message: t("Embedded page detached") });
    } catch {
      notifications.show({
        color: "red",
        message: t("The page changed. Refresh and try again."),
      });
    } finally {
      setPending(false);
    }
  };

  const available =
    result && !unavailableByGraph && !("status" in result) ? result : null;

  return (
    <NodeViewWrapper contentEditable={false} className={classes.wrapper}>
      <Paper withBorder radius="md" className={classes.card}>
        <Group justify="space-between" wrap="nowrap" className={classes.header}>
          <Group gap="xs" wrap="nowrap" className={classes.titleGroup}>
            <Text aria-hidden>{available?.icon || "📄"}</Text>
            <Text fw={600} lineClamp={1}>
              {available?.title || t("Embedded page")}
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Tooltip label={t("Refresh")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={t("Refresh")}
                onClick={() => refresh()}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            {available && (
              <Tooltip label={t("Open source page")}>
                <ActionIcon
                  component={Link}
                  to={`/p/${available.slugId}`}
                  variant="subtle"
                  color="gray"
                  size="lg"
                  aria-label={t("Open source page")}
                >
                  <IconExternalLink size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            {editor.isEditable && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="lg"
                    aria-label={t("Embedded page actions")}
                  >
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconLinkOff size={15} />}
                    onClick={handleDetach}
                    disabled={pending || !consumerPageId || !referenceNodeId}
                  >
                    {t("Detach embedded page")}
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={15} />}
                    onClick={() => deleteNode()}
                  >
                    {t("Remove from page")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Group>
        <div className={classes.content}>
          {unavailableByGraph ? (
            <NotFoundPlaceholder />
          ) : !result ? (
            <div className={classes.loading} />
          ) : "status" in result ? (
            result.status === "no_access" || result.status === "disabled" ? (
              <NoAccessPlaceholder />
            ) : (
              <NotFoundPlaceholder />
            )
          ) : (
            <PageEmbedDepthContext.Provider value={nextAncestry}>
              <TransclusionContent content={result.content} />
            </PageEmbedDepthContext.Provider>
          )}
        </div>
      </Paper>
    </NodeViewWrapper>
  );
}
