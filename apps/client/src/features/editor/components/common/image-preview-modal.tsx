import type { ReactNode } from "react";
import { Modal } from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  IconArrowsMaximize,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import {
  MAX_PREVIEW_SCALE,
  MIN_PREVIEW_SCALE,
  usePreviewZoom,
} from "./use-preview-zoom";
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
      {opened && <ZoomablePreview>{children}</ZoomablePreview>}
    </Modal>
  );
}

function ZoomablePreview({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const zoom = usePreviewZoom();
  const { scale, x, y } = zoom.transform;

  return (
    <>
      <div
        ref={zoom.viewportRef}
        className={classes.viewport}
        role="region"
        aria-label={t("Image preview")}
        tabIndex={0}
        data-zoomed={scale > 1 || undefined}
        data-dragging={zoom.dragging || undefined}
        {...zoom.handlers}
      >
        <div
          className={classes.media}
          style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
        >
          {children}
        </div>
      </div>
      <div className={classes.toolbar}>
        <AccessibleActionIcon
          label={t("Zoom out")}
          variant="default"
          size={44}
          minTargetSize={44}
          disabled={scale <= MIN_PREVIEW_SCALE}
          onClick={zoom.zoomOut}
        >
          <IconZoomOut size={20} />
        </AccessibleActionIcon>
        <output className={classes.scale}>{Math.round(scale * 100)}%</output>
        <AccessibleActionIcon
          label={t("Zoom in")}
          variant="default"
          size={44}
          minTargetSize={44}
          disabled={scale >= MAX_PREVIEW_SCALE}
          onClick={zoom.zoomIn}
        >
          <IconZoomIn size={20} />
        </AccessibleActionIcon>
        <AccessibleActionIcon
          label={t("Reset zoom")}
          variant="default"
          size={44}
          minTargetSize={44}
          onClick={zoom.reset}
        >
          <IconArrowsMaximize size={20} />
        </AccessibleActionIcon>
        <span className={classes.hint}>
          {t("Use Alt + wheel or pinch to zoom")}
        </span>
      </div>
    </>
  );
}
