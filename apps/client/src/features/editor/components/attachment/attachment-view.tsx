import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Group, Text, Paper, ActionIcon, Loader } from "@mantine/core";
import { getFileUrl } from "@/lib/config.ts";
import {
  IconDownload,
  IconPaperclip,
  IconLayoutList,
  IconFileTypography,
} from "@tabler/icons-react";
import { useHover } from "@mantine/hooks";
import { formatBytes } from "@/lib";
import { useTranslation } from "react-i18next";

type AttachmentDisplayMode = "file" | "embed";

/**
 * Проверяет, что вложение можно отображать как встроенный PDF.
 * Поддерживаем оба варианта определения: MIME-тип и расширение имени файла.
 */
function isPdfAttachment(mime?: string, name?: string): boolean {
  const normalizedMime = mime?.toLowerCase();
  const normalizedName = name?.toLowerCase();

  return (
    normalizedMime === "application/pdf" || normalizedName?.endsWith(".pdf") === true
  );
}

export default function AttachmentView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { node, selected } = props;
  const { url, name, size, mime, displayMode = "file" } = node.attrs;
  const { hovered, ref } = useHover();

  const isPdf = isPdfAttachment(mime, name);
  const fileUrl = url ? getFileUrl(url) : "";

  /**
   * Переключает режим показа PDF между карточкой файла и встроенным preview.
   */
  const toggleDisplayMode = () => {
    const nextMode: AttachmentDisplayMode = displayMode === "embed" ? "file" : "embed";
    props.updateAttributes({ displayMode: nextMode });
  };

  const shouldShowActions = Boolean(url) && (selected || hovered);
  const shouldRenderEmbed = Boolean(url) && isPdf && displayMode === "embed";

  return (
    <NodeViewWrapper>
      <Paper withBorder p="4px" ref={ref} data-drag-handle>
        {shouldRenderEmbed ? (
          <>
            <Group justify="space-between" gap="sm" wrap="nowrap" mb="xs">
              <Text component="span" size="sm" truncate="end" style={{ minWidth: 0, flex: 1 }}>
                {name}
              </Text>

              {shouldShowActions && (
                <Group gap="xs" wrap="nowrap">
                  <ActionIcon
                    variant="default"
                    aria-label={t("Show as file")}
                    onClick={toggleDisplayMode}
                  >
                    <IconLayoutList size={18} />
                  </ActionIcon>

                  <a href={fileUrl} target="_blank" rel="noreferrer">
                    <ActionIcon variant="default" aria-label="download file">
                      <IconDownload size={18} />
                    </ActionIcon>
                  </a>
                </Group>
              )}
            </Group>

            <div className="attachment-pdf-embed">
              <iframe
                src={fileUrl}
                title={name || t("PDF preview")}
                loading="lazy"
                className="attachment-pdf-embed__frame"
              />
            </div>
          </>
        ) : (
          <Group
            justify="space-between"
            gap="xl"
            style={{ cursor: "pointer" }}
            wrap="nowrap"
            h={25}
          >
            <Group wrap="nowrap" gap="sm" style={{ minWidth: 0, flex: 1 }}>
              {url ? (
                <IconPaperclip size={20} style={{ flexShrink: 0 }} />
              ) : (
                <Loader size={20} style={{ flexShrink: 0 }} />
              )}

              <Text component="span" size="md" truncate="end" style={{ minWidth: 0 }}>
                {url ? name : t("Uploading {{name}}", { name })}
              </Text>

              <Text component="span" size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                {formatBytes(size)}
              </Text>
            </Group>

            {shouldShowActions && (
              <Group gap="xs" wrap="nowrap">
                {isPdf && (
                  <ActionIcon
                    variant="default"
                    aria-label={t("Show embedded preview")}
                    onClick={toggleDisplayMode}
                  >
                    <IconFileTypography size={18} />
                  </ActionIcon>
                )}

                <a href={fileUrl} target="_blank" rel="noreferrer">
                  <ActionIcon variant="default" aria-label="download file">
                    <IconDownload size={18} />
                  </ActionIcon>
                </a>
              </Group>
            )}
          </Group>
        )}
      </Paper>
    </NodeViewWrapper>
  );
}
