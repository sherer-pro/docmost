import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { DictionaryMarkdown } from "./dictionary-markdown";
import { DictionaryTermModal } from "./dictionary-term-modal";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import classes from "./dictionary.module.css";

interface DictionaryHighlightLayerProps {
  terms: IDictionaryTerm[];
  children: ReactNode;
  spaceId?: string;
  canCreate?: boolean;
  enableSelectionCreate?: boolean;
}

interface PopoverState {
  term: IDictionaryTerm;
  top: number;
  left: number;
}

interface SelectionState {
  text: string;
  top: number;
  left: number;
}

export function DictionaryHighlightLayer({
  terms,
  children,
  spaceId,
  canCreate = false,
  enableSelectionCreate = false,
}: DictionaryHighlightLayerProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [initialTerm, setInitialTerm] = useState("");
  const [modalOpened, { open: openModal, close: closeModal }] =
    useDisclosure(false);
  const termsById = useMemo(
    () => new Map(terms.map((term) => [term.id, term])),
    [terms],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root || termsById.size === 0) {
      return;
    }

    const getHighlightElement = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return null;
      }

      return target.closest<HTMLElement>(".dictionary-highlight");
    };

    const showDefinition = (target: EventTarget | null) => {
      const element = getHighlightElement(target);
      const termId = element?.dataset.dictionaryTermId;
      const term = termId ? termsById.get(termId) : null;

      if (!element || !term) {
        return;
      }

      const rect = element.getBoundingClientRect();
      setPopover({
        term,
        top: Math.min(rect.bottom + 8, window.innerHeight - 12),
        left: Math.min(rect.left, window.innerWidth - 372),
      });
    };

    const hideDefinition = () => {
      setPopover(null);
    };
    const handleMouseOver = (event: Event) => showDefinition(event.target);
    const handleFocusIn = (event: Event) => showDefinition(event.target);
    const handleClick = (event: Event) => showDefinition(event.target);
    const handleLeave = (event: MouseEvent | FocusEvent) => {
      const currentHighlight = getHighlightElement(event.target);
      const nextHighlight = getHighlightElement(event.relatedTarget);

      if (currentHighlight && currentHighlight === nextHighlight) {
        return;
      }

      hideDefinition();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!getHighlightElement(event.target)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        hideDefinition();
        return;
      }

      if (!["Enter", " "].includes(event.key)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      showDefinition(event.target);
    };

    root.addEventListener("mouseover", handleMouseOver, true);
    root.addEventListener("focusin", handleFocusIn, true);
    root.addEventListener("click", handleClick, true);
    root.addEventListener("keydown", handleKeyDown, true);
    root.addEventListener("mouseout", handleLeave, true);
    root.addEventListener("focusout", handleLeave, true);

    return () => {
      root.removeEventListener("mouseover", handleMouseOver, true);
      root.removeEventListener("focusin", handleFocusIn, true);
      root.removeEventListener("click", handleClick, true);
      root.removeEventListener("keydown", handleKeyDown, true);
      root.removeEventListener("mouseout", handleLeave, true);
      root.removeEventListener("focusout", handleLeave, true);
    };
  }, [termsById]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !spaceId || !canCreate || !enableSelectionCreate) {
      return;
    }

    const handleSelection = () => {
      const selectedText = window.getSelection()?.toString().trim() ?? "";
      const selectionRange = window.getSelection()?.rangeCount
        ? window.getSelection()?.getRangeAt(0)
        : null;

      if (!selectedText || !selectionRange) {
        setSelection(null);
        return;
      }

      const container = selectionRange.commonAncestorContainer;
      const containerElement =
        container instanceof HTMLElement ? container : container.parentElement;

      if (!containerElement || !root.contains(containerElement)) {
        setSelection(null);
        return;
      }

      const rect = selectionRange.getBoundingClientRect();
      setSelection({
        text: selectedText,
        top: rect.bottom + 8,
        left: rect.left,
      });
    };

    document.addEventListener("selectionchange", handleSelection);
    return () => {
      document.removeEventListener("selectionchange", handleSelection);
    };
  }, [canCreate, enableSelectionCreate, spaceId]);

  const handleCreateFromSelection = () => {
    if (!selection) {
      return;
    }

    setInitialTerm(selection.text);
    setSelection(null);
    openModal();
  };

  return (
    <div ref={rootRef}>
      {children}

      {popover &&
        createPortal(
          <div
            role="tooltip"
            className={classes.definitionPopover}
            style={{ top: popover.top, left: Math.max(12, popover.left) }}
          >
            <DictionaryMarkdown
              markdown={popover.term.definitionMarkdown}
              compact
            />
          </div>,
          document.body,
        )}

      {selection &&
        spaceId &&
        canCreate &&
        enableSelectionCreate &&
        createPortal(
          <div
            className={classes.selectionPopover}
            style={{ top: selection.top, left: Math.max(12, selection.left) }}
          >
            <Button
              size="xs"
              variant="default"
              onClick={handleCreateFromSelection}
            >
              {t("Add to dictionary")}
            </Button>
          </div>,
          document.body,
        )}

      {spaceId && (
        <DictionaryTermModal
          opened={modalOpened}
          onClose={closeModal}
          spaceId={spaceId}
          initialTerm={initialTerm}
        />
      )}
    </div>
  );
}
