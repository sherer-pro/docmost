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
const PROPERTY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getSearchPropertyTarget(search: string) {
  const value = new URLSearchParams(search).get("findProperty");
  return value && PROPERTY_ID.test(value) ? value.toLowerCase() : null;
}

export function withSearchQuery(
  href: string,
  query?: string,
  propertyId?: string,
) {
  const term = query?.trim().slice(0, 512);
  if (!term && !propertyId) return href;
  const url = new URL(href, "https://docmost.invalid");
  if (term) url.searchParams.set("find", term);
  if (propertyId && PROPERTY_ID.test(propertyId))
    url.searchParams.set("findProperty", propertyId.toLowerCase());
  return `${url.pathname}${url.search}${url.hash}`;
}
