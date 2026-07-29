import DOMPurify from "dompurify";
import { marked } from "marked";

export function sanitizeAiMarkdown(markdown: string): string {
  return DOMPurify.sanitize(String(marked.parse(markdown)), {
    USE_PROFILES: { html: true },
  });
}
