import { VisuallyHidden } from "@mantine/core";
import type { Editor } from "@tiptap/core";
import { IconBook } from "@tabler/icons-react";
import clsx from "clsx";
import { type CSSProperties, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import classes from "./page-reading-time.module.css";
import { estimateReadingTime } from "./reading-time";

interface PageReadingTimeProps {
  editor: Editor | null;
  enabled: boolean;
  pageId?: string;
  className?: string;
}

type ReadingTimeStyle = CSSProperties & {
  "--reading-time-color-progress": string;
};

export function PageReadingTime({
  editor,
  enabled,
  pageId,
  className,
}: PageReadingTimeProps) {
  const { t } = useTranslation();
  const [wordCount, setWordCount] = useState(0);
  const editorPageId = (editor?.storage as { pageId?: string } | undefined)
    ?.pageId;
  const hasCurrentEditor = Boolean(
    editor && (!pageId || editorPageId === pageId),
  );

  useEffect(() => {
    if (!enabled || !hasCurrentEditor || !editor) {
      setWordCount(0);
      return;
    }

    let debounceHandle: number | undefined;
    let idleHandle: number | undefined;
    const calculate = () => {
      if (!editor.isDestroyed) {
        setWordCount(editor.storage?.characterCount?.words?.() ?? 0);
      }
    };
    const scheduleUpdate = () => {
      window.clearTimeout(debounceHandle);
      debounceHandle = window.setTimeout(calculate, 750);
    };

    if (typeof requestIdleCallback === "function") {
      idleHandle = requestIdleCallback(calculate, { timeout: 1500 });
    } else {
      debounceHandle = window.setTimeout(calculate, 0);
    }
    editor.on("update", scheduleUpdate);

    return () => {
      editor.off("update", scheduleUpdate);
      window.clearTimeout(debounceHandle);
      if (idleHandle !== undefined) {
        cancelIdleCallback(idleHandle);
      }
    };
  }, [editor, enabled, hasCurrentEditor]);

  if (!enabled || !hasCurrentEditor) {
    return null;
  }

  const estimate = estimateReadingTime(wordCount);
  const label =
    estimate.kind === "less-than-minute"
      ? t("readingTime.lessThanMinute")
      : estimate.kind === "over-limit"
        ? t("readingTime.overThirtyMinutes")
        : t("readingTime.minutes", { count: estimate.minutes });
  const style: ReadingTimeStyle = {
    "--reading-time-color-progress": `${estimate.colorProgress}%`,
  };

  return (
    <div className={clsx(classes.readingTime, className)} style={style}>
      <VisuallyHidden>{t("Estimated reading time")}: </VisuallyHidden>
      <IconBook
        aria-hidden="true"
        className={classes.icon}
        focusable="false"
        stroke={1.75}
      />
      <span>{label}</span>
    </div>
  );
}
