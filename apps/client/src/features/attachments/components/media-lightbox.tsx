import { useEffect } from "react";
import { Anchor, Group, Text } from "@mantine/core";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { buildAttachmentFileUrl } from "@docmost/editor-ext";
import { ImagePreviewModal } from "@/features/editor/components/common/image-preview-modal";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";

export interface PreviewAttachment {
  id: string;
  fileName: string;
  mimeType: string | null;
  fileExt: string | null;
}

export function MediaLightbox({
  files,
  index,
  onChange,
  onClose,
}: {
  files: PreviewAttachment[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const file = files[index];
  useEffect(() => {
    if (!file) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target as HTMLElement)?.closest(
          "input,textarea,audio,video,iframe,[contenteditable=true]",
        )
      )
        return;
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        onChange(index - 1);
      }
      if (event.key === "ArrowRight" && index < files.length - 1) {
        event.preventDefault();
        onChange(index + 1);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keydown", escape, true);
    };
  }, [file, files.length, index, onChange, onClose]);
  if (!file) return null;
  const url = buildAttachmentFileUrl(file.id, file.fileName);
  const image = file.mimeType?.startsWith("image/") && file.fileExt !== ".svg";
  return (
    <ImagePreviewModal
      opened
      onClose={onClose}
      title={file.fileName}
      zoomable={Boolean(image)}
      previewKey={file.id}
      toolbar={
        <Group justify="space-between" mb="sm">
          <Group>
            <AccessibleActionIcon
              label={t("dbBoard.previous")}
              disabled={index === 0}
              onClick={() => onChange(index - 1)}
            >
              <IconArrowLeft size={18} />
            </AccessibleActionIcon>
            <Text size="sm">
              {index + 1} / {files.length}
            </Text>
            <AccessibleActionIcon
              label={t("Next")}
              disabled={index === files.length - 1}
              onClick={() => onChange(index + 1)}
            >
              <IconArrowRight size={18} />
            </AccessibleActionIcon>
          </Group>
          <Anchor href={url} download={file.fileName}>
            {t("attachmentGallery.download")}
          </Anchor>
        </Group>
      }
    >
      {image ? (
        <img
          src={url}
          alt={file.fileName}
          style={{ maxWidth: "100%", maxHeight: "75vh", objectFit: "contain" }}
        />
      ) : file.mimeType?.startsWith("video/") ? (
        <video
          key={file.id}
          src={url}
          controls
          preload="metadata"
          style={{ width: "100%", maxHeight: "75vh" }}
        />
      ) : file.mimeType?.startsWith("audio/") ? (
        <audio
          key={file.id}
          src={url}
          controls
          preload="metadata"
          style={{ width: "100%" }}
        />
      ) : file.mimeType === "application/pdf" ? (
        <iframe
          title={file.fileName}
          src={url}
          style={{ width: "100%", height: "70vh", border: 0 }}
        />
      ) : (
        <Text>{t("attachmentGallery.noPreview")}</Text>
      )}
    </ImagePreviewModal>
  );
}
