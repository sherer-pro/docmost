import DOMPurify from "dompurify";
import { marked } from "marked";
import type { AiCitation } from "@docmost/api-contract";
import { safeSourceUrl } from "@/features/ai/utils/source-url.ts";

export function sanitizeAiMarkdown(
  markdown: string,
  sources: AiCitation[] = [],
): string {
  const sanitized = DOMPurify.sanitize(String(marked.parse(markdown)), {
    USE_PROFILES: { html: true },
  });
  if (typeof document === "undefined") return sanitized;
  const container = document.createElement("div");
  container.innerHTML = sanitized;
  const byKey = new Map(
    sources
      .filter((source) => source.citationKey)
      .map((source) => [source.citationKey!, source] as const),
  );
  const walker = document.createTreeWalker(
    container,
    document.defaultView?.NodeFilter.SHOW_TEXT ?? 4,
  );
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest("code, pre, a")) continue;
    const pattern = /\[(C\d+|S\d+)\]/g;
    if (!pattern.test(node.data)) continue;
    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of node.data.matchAll(pattern)) {
      const index = match.index ?? 0;
      fragment.append(node.data.slice(cursor, index));
      const source = byKey.get(match[1]);
      if (source) {
        const label = `[${source.position + 1}]`;
        const href = safeSourceUrl(source.sourceUrl);
        const element = document.createElement(href ? "a" : "span");
        element.textContent = label;
        element.className = "ai-inline-citation";
        element.title = [source.sourceTitle, source.sectionTitle]
          .filter(Boolean)
          .join(" — ");
        if (href && element.tagName === "A") {
          const anchor = element as HTMLAnchorElement;
          anchor.href = href;
          if (!href.startsWith("/")) {
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
          }
        }
        fragment.append(element);
      }
      cursor = index + match[0].length;
    }
    fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }
  return DOMPurify.sanitize(container.innerHTML, {
    USE_PROFILES: { html: true },
  });
}

export function aiMarkdownWithCitationLinks(
  markdown: string,
  sources: AiCitation[] = [],
): string {
  const byKey = new Map(
    sources
      .filter((source) => source.citationKey)
      .map((source) => [source.citationKey!, source] as const),
  );
  return replaceCitationMarkersOutsideCode(markdown, (value, key) => {
    const source = byKey.get(key);
    const href = source ? safeSourceUrl(source.sourceUrl) : null;
    return source && href
      ? `[${source.position + 1}](${href})`
      : source
        ? `[${source.position + 1}]`
        : value;
  });
}

function replaceCitationMarkersOutsideCode(
  markdown: string,
  replace: (value: string, key: string) => string,
): string {
  let result = "";
  let fence: { character: string; length: number } | null = null;
  for (const match of markdown.matchAll(/.*(?:\r?\n|$)/g)) {
    const line = match[0];
    if (!line) continue;
    const body = line.replace(/\r?\n$/, "");
    const fenceMatch = body.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      result += line;
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.character &&
        fenceMatch[1].length >= fence.length &&
        /^\s*$/.test(body.slice(fenceMatch[0].length))
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = {
        character: fenceMatch[1][0],
        length: fenceMatch[1].length,
      };
      result += line;
      continue;
    }
    let cursor = 0;
    while (cursor < line.length) {
      if (line[cursor] === "`") {
        let end = cursor + 1;
        while (line[end] === "`") end += 1;
        const delimiter = "`".repeat(end - cursor);
        const closing = line.indexOf(delimiter, end);
        if (closing >= 0) {
          result += line.slice(cursor, closing + delimiter.length);
          cursor = closing + delimiter.length;
          continue;
        }
      }
      const marker = line.slice(cursor).match(/^\[(C\d+)\]/);
      if (marker) {
        result += replace(marker[0], marker[1]);
        cursor += marker[0].length;
        continue;
      }
      result += line[cursor];
      cursor += 1;
    }
  }
  return result;
}
