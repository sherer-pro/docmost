import type { ReactNode } from "react";
import { Modal } from "@mantine/core";
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
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={title}
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
