import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import cx from "clsx";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getTagLabel, getValidTagValue } from "@docmost/editor-ext";
import classes from "./tag-view.module.css";

interface PopoverPosition {
  top: number;
  left: number;
}

export default function TagView(props: NodeViewProps) {
  const { t } = useTranslation();
  const targetRef = useRef<HTMLSpanElement | null>(null);
  const [popover, setPopover] = useState<PopoverPosition | null>(null);
  const value = getValidTagValue(props.node.attrs.value);
  const description =
    value === "tbd" ? t("Tag TBD description") : t("Tag TODO description");

  const showDescription = () => {
    const target = targetRef.current;
    if (!target) {
      return;
    }

    const rect = target.getBoundingClientRect();
    setPopover({
      top: Math.min(rect.bottom + 8, window.innerHeight - 12),
      left: Math.min(rect.left, window.innerWidth - 372),
    });
  };

  const hideDescription = () => setPopover(null);

  return (
    <NodeViewWrapper
      as="span"
      className={cx(classes.tag, classes[value], {
        [classes.selected]: props.selected,
      })}
      data-tag-value={value}
      onBlur={hideDescription}
      onClick={showDescription}
      onFocus={showDescription}
      onMouseEnter={showDescription}
      onMouseLeave={hideDescription}
    >
      <span ref={targetRef} className={classes.label}>
        {getTagLabel(value)}
      </span>
      {popover &&
        createPortal(
          <div
            className={classes.descriptionPopover}
            style={{ top: popover.top, left: Math.max(12, popover.left) }}
          >
            {description}
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  );
}
