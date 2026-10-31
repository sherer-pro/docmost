import { useEffect, useMemo, useRef, useState } from "react";
import { EditorProvider } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { Group, Modal, Text } from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsMaximize,
  IconPointer,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { createReadOnlyExtensions } from "../../extensions/extensions";
import { Footnotes } from "../footnote/footnotes";
import { TransclusionLookupProvider } from "../transclusion/transclusion-lookup-context";
import { PageReferenceProvider } from "../mention/page-reference-context";
import { DocumentReadOnlyContext } from "../database-embed/database-embed-context";
import { buildPresentationSlides } from "./presentation-slides";
import classes from "./presentation-modal.module.css";

export default function PresentationModal({
  content,
  title,
  pageId,
  onClose,
}: {
  content: JSONContent;
  title: string;
  pageId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const slides = useMemo(
    () => buildPresentationSlides(content, title),
    [content, title],
  );
  const [index, setIndex] = useState(0);
  const [pointer, setPointer] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const laser = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const extensions = useMemo(() => createReadOnlyExtensions({}), []);
  const close = () => {
    if (document.fullscreenElement === root.current)
      void document.exitFullscreen().catch(() => {});
    onClose();
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target as Element)?.closest('[role="tablist"]')
      )
        return;
      if (
        (event.target as Element)?.closest(
          'input,textarea,select,video,audio,[contenteditable="true"]',
        )
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (document.fullscreenElement)
          void document.exitFullscreen().catch(() => {});
        else onClose();
      } else if (
        event.key === "ArrowRight" ||
        event.key === "PageDown" ||
        (event.key === " " &&
          !(event.target as Element)?.closest('button,a,[role="tab"]'))
      ) {
        event.preventDefault();
        setIndex((value) => Math.min(slides.length - 1, value + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setIndex(event.key === "Home" ? 0 : slides.length - 1);
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [onClose, slides.length]);
  useEffect(() => {
    viewport.current?.scrollTo(0, 0);
  }, [index]);
  return (
    <Modal
      opened
      onClose={close}
      fullScreen
      title={t("docBlocks.presentation")}
      closeOnEscape={false}
      withCloseButton={false}
      padding="md"
    >
      <div
        ref={root}
        className={classes.root}
        onPointerMove={(event) => {
          if (pointer && laser.current)
            laser.current.style.transform = `translate(${event.clientX - 9}px, ${event.clientY - 9}px)`;
        }}
      >
        <div
          ref={viewport}
          className={classes.slide}
          role="region"
          aria-label={t("docBlocks.slideNumber", {
            number: index + 1,
            total: slides.length,
          })}
        >
          <DocumentReadOnlyContext.Provider value>
            <PageReferenceProvider>
              <TransclusionLookupProvider>
                <EditorProvider
                  key={index}
                  editable={false}
                  immediatelyRender
                  extensions={extensions}
                  content={slides[index].content}
                  onCreate={({ editor }) => {
                    (editor.storage as any).pageId = pageId;
                  }}
                >
                  <Footnotes />
                </EditorProvider>
              </TransclusionLookupProvider>
            </PageReferenceProvider>
          </DocumentReadOnlyContext.Provider>
        </div>
        <Group justify="space-between" className={classes.controls} wrap="wrap">
          <Group gap="xs" wrap="nowrap">
            <AccessibleActionIcon
              label={t("docBlocks.previousSlide")}
              disabled={index === 0}
              onClick={() => setIndex((value) => value - 1)}
              variant="subtle"
            >
              <IconArrowLeft size={20} />
            </AccessibleActionIcon>
            <Text size="sm" aria-live="polite">
              {index + 1} / {slides.length}
            </Text>
            <AccessibleActionIcon
              label={t("docBlocks.nextSlide")}
              disabled={index === slides.length - 1}
              onClick={() => setIndex((value) => value + 1)}
              variant="subtle"
            >
              <IconArrowRight size={20} />
            </AccessibleActionIcon>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <AccessibleActionIcon
              label={t("docBlocks.pointer")}
              aria-pressed={pointer}
              onClick={() => setPointer((value) => !value)}
              variant={pointer ? "light" : "subtle"}
            >
              <IconPointer size={20} />
            </AccessibleActionIcon>
            <AccessibleActionIcon
              label={t("docBlocks.fullscreen")}
              disabled={!document.fullscreenEnabled}
              onClick={() => {
                if (document.fullscreenElement)
                  void document.exitFullscreen().catch(() => {});
                else void root.current?.requestFullscreen().catch(() => {});
              }}
              variant="subtle"
            >
              <IconArrowsMaximize size={20} />
            </AccessibleActionIcon>
            <AccessibleActionIcon
              label={t("Close")}
              onClick={close}
              variant="subtle"
            >
              <IconX size={20} />
            </AccessibleActionIcon>
          </Group>
        </Group>
        {pointer && (
          <div
            ref={laser}
            className={classes.pointer}
            aria-hidden="true"
            data-presentation-pointer
          />
        )}
      </div>
    </Modal>
  );
}
