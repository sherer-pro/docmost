import DOMPurify from "dompurify";
import type { ITagSearchSnippet } from "@/features/search/types/search.types";

function normalizeComparableText(value: string) {
  const sanitized = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ["mark", "em", "strong", "b"],
    ALLOWED_ATTR: [],
  });

  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = sanitized;
    return (container.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  return sanitized
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDuplicateTextHighlight(
  highlight: string,
  snippets: readonly ITagSearchSnippet[],
) {
  const text = normalizeComparableText(highlight).toLocaleLowerCase();
  if (!text) return false;

  return snippets.some((snippet) => {
    const snippetText = snippet.text
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
    return (
      snippetText === text ||
      snippetText.includes(text) ||
      text.includes(snippetText)
    );
  });
}
