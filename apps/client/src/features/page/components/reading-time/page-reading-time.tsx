import { VisuallyHidden } from "@mantine/core";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import clsx from "clsx";
import type { CSSProperties } from "react";
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
  const wordCount = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) =>
      currentEditor?.storage?.characterCount?.words?.() ?? 0,
  });
  const editorPageId = (editor?.storage as { pageId?: string } | undefined)
    ?.pageId;
  const hasCurrentEditor = Boolean(
    editor && (!pageId || editorPageId === pageId),
  );

  if (!enabled || !hasCurrentEditor) {
    return null;
  }

  const estimate = estimateReadingTime(wordCount ?? 0);
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
      {label}
    </div>
  );
}
