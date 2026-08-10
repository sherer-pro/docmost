import type { ReactNode } from "react";
import { Modal } from "@mantine/core";
import { useTranslation } from "react-i18next";
import classes from "./image-preview-modal.module.css";

interface ImagePreviewModalProps {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}

export function ImagePreviewModal({
  opened,
  onClose,
  title,
  children,
}: ImagePreviewModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={title}
      closeButtonProps={{ "aria-label": t("Cancel") }}
      size="calc(100vw - var(--image-preview-modal-offset))"
      xOffset="var(--image-preview-modal-gutter)"
      yOffset="var(--image-preview-modal-gutter)"
      classNames={{
        root: classes.root,
        content: classes.content,
        body: classes.body,
      }}
    >
      <div className={classes.media}>{children}</div>
    </Modal>
  );
}
