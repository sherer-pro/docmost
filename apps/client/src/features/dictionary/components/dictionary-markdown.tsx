import DOMPurify from "dompurify";
import { marked } from "marked";
import { Box } from "@mantine/core";
import { useMemo } from "react";
import classes from "./dictionary.module.css";

interface DictionaryMarkdownProps {
  markdown: string;
  compact?: boolean;
}

export function DictionaryMarkdown({
  markdown,
  compact = false,
}: DictionaryMarkdownProps) {
  const html = useMemo(() => {
    const parsedMarkdown = `${marked.parse(markdown || "")}`;
    return DOMPurify.sanitize(parsedMarkdown);
  }, [markdown]);

  return (
    <Box
      className={compact ? classes.markdownCompact : classes.markdown}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
