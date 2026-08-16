import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import cx from "clsx";
import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  getBuiltInTagDefinition,
  getTagColor,
  getTagLabel,
  getValidTagValue,
  isBuiltInTagValue,
  type TagOptions,
} from "@docmost/editor-ext";
import classes from "./tag-view.module.css";
import tagColorClasses from "@/components/ui/tag-colors.module.css";

interface PopoverPosition {
  top: number;
  left: number;
}

export default function TagView(props: NodeViewProps) {
  const { t } = useTranslation();
  const targetRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchActionRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number>();
  const popoverId = useId();
  const [popover, setPopover] = useState<PopoverPosition | null>(null);
  const value = getValidTagValue(props.node.attrs.value);
  const definition = getBuiltInTagDefinition(value);
  const color = getTagColor(value);
  const description = definition
    ? t(definition.descriptionKey)
    : t("Unknown tag description");
  const onSearch = (props.extension.options as TagOptions).onSearch;
  const canSearch = isBuiltInTagValue(value) && typeof onSearch === "function";

  const cancelScheduledHide = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };

  const showDescription = () => {
    cancelScheduledHide();
    const target = targetRef.current;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    setPopover({
      top: Math.min(rect.bottom + 8, window.innerHeight - 12),
      left: Math.min(rect.left, window.innerWidth - 372),
    });
  };

  const hideDescription = () => {
    cancelScheduledHide();
    setPopover(null);
  };

  const scheduleHide = () => {
    cancelScheduledHide();
    closeTimerRef.current = window.setTimeout(() => setPopover(null), 120);
  };

  useEffect(() => () => cancelScheduledHide(), []);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hideDescription();
      targetRef.current?.parentElement?.focus();
      return;
    }

    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    showDescription();
    if (canSearch) {
      window.requestAnimationFrame(() => searchActionRef.current?.focus());
    }
  };

  const handleBlur = (event: FocusEvent) => {
    if (
      event.relatedTarget instanceof Node &&
      popoverRef.current?.contains(event.relatedTarget)
    ) {
      return;
    }
    scheduleHide();
  };

  const handleSearch = () => {
    if (!canSearch) return;
    onSearch(value);
    hideDescription();
  };

  return (
    <NodeViewWrapper
      as="span"
      className={cx(classes.tag, tagColorClasses[color], {
        [classes.selected]: props.selected,
      })}
      aria-controls={popover ? popoverId : undefined}
      aria-describedby={popover ? popoverId : undefined}
      aria-expanded={canSearch ? Boolean(popover) : undefined}
      aria-haspopup={canSearch ? "dialog" : undefined}
      data-tag-value={value}
      role="button"
      tabIndex={0}
      onBlur={handleBlur}
      onClick={showDescription}
      onFocus={showDescription}
      onKeyDown={handleKeyDown}
      onMouseEnter={showDescription}
      onMouseLeave={scheduleHide}
    >
      <span ref={targetRef} className={classes.label}>
        {getTagLabel(value)}
      </span>
      {popover &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role={canSearch ? "dialog" : "tooltip"}
            aria-label={canSearch ? t("Tag actions") : undefined}
            className={classes.descriptionPopover}
            style={{ top: popover.top, left: Math.max(12, popover.left) }}
            onBlur={handleBlur}
            onMouseEnter={cancelScheduledHide}
            onMouseLeave={scheduleHide}
          >
            <div className={classes.descriptionText}>{description}</div>
            {canSearch && (
              <button
                ref={searchActionRef}
                type="button"
                className={classes.searchAction}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleSearch();
                }}
              >
                {t("Find this tag in the space")}
              </button>
            )}
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  );
}
