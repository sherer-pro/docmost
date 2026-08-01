import DOMPurify from "dompurify";
import { htmlToMarkdown, markdownToHtml } from "@docmost/editor-ext";

const MARKDOWN_PASTE_PATTERNS = [
  /(^|\n)\s{0,3}(?:#{1,6}\s+|>\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/,
  /(?:\*\*|__)[^\n]+(?:\*\*|__)/,
  /(?:^|[^*])\*[^\n*]+\*(?:$|[^*])|_[^\n_]+_/,
  /~~[^\n]+~~/,
  /`[^`\n]+`|```/,
  /\[[^\]\n]+\]\([^\s)]+\)/,
];

export function markdownToComposerHtml(markdown: string): string {
  const html = markdownToHtml(markdown);
  if (typeof html !== "string") {
    return "";
  }

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });
}

export function composerHtmlToMarkdown(html: string): string {
  return htmlToMarkdown(html).trim();
}

export function isSupportedMarkdownPaste(text: string): boolean {
  return MARKDOWN_PASTE_PATTERNS.some((pattern) => pattern.test(text));
}
