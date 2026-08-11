import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import cx from "clsx";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  getBuiltInTagDefinition,
  getTagColor,
  getTagLabel,
  getValidTagValue,
} from "@docmost/editor-ext";
import classes from "./tag-view.module.css";

interface PopoverPosition {
  top: number;
  left: number;
}

export default function TagView(props: NodeViewProps) {
  const { t } = useTranslation();
  const targetRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();
  const [popover, setPopover] = useState<PopoverPosition | null>(null);
  const value = getValidTagValue(props.node.attrs.value);
  const definition = getBuiltInTagDefinition(value);
  const color = getTagColor(value);
  const description = definition
    ? t(definition.descriptionKey)
    : t("Unknown tag description");

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

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hideDescription();
      return;
    }

    if (!["Enter", " "].includes(event.key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    showDescription();
  };

  return (
    <NodeViewWrapper
      as="span"
      className={cx(classes.tag, classes[color], {
        [classes.selected]: props.selected,
      })}
      aria-describedby={popover ? tooltipId : undefined}
      data-tag-value={value}
      role="button"
      tabIndex={0}
      onBlur={hideDescription}
      onClick={showDescription}
      onFocus={showDescription}
      onKeyDown={handleKeyDown}
      onMouseEnter={showDescription}
      onMouseLeave={hideDescription}
    >
      <span ref={targetRef} className={classes.label}>
        {getTagLabel(value)}
      </span>
      {popover &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className={classes.descriptionPopover}
            style={{ top: popover.top, left: Math.max(12, popover.left) }}
          >
            <div className={classes.descriptionText}>{description}</div>
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  );
}
