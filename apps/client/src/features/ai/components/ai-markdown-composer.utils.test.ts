// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  composerHtmlToMarkdown,
  isSupportedMarkdownPaste,
  markdownToComposerHtml,
} from "./ai-markdown-composer.utils.ts";

describe("AI Markdown composer utilities", () => {
  it("recognizes the supported Markdown paste forms", () => {
    expect(isSupportedMarkdownPaste("**Important**")).toBe(true);
    expect(isSupportedMarkdownPaste("- [ ] Review the answer")).toBe(true);
    expect(isSupportedMarkdownPaste("# Summary\n\n> Quoted text")).toBe(true);
    expect(isSupportedMarkdownPaste("Plain text only")).toBe(false);
  });

  it("converts Markdown into safe editor HTML", () => {
    const html = markdownToComposerHtml(
      "# Summary\n\n**Important** and [safe](https://example.com)",
    );

    expect(html).toContain("<h1>Summary</h1>");
    expect(html).toContain("<strong>Important</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(markdownToComposerHtml("[unsafe](javascript:alert(1))")).not.toContain(
      "javascript:",
    );
  });

  it("serializes task lists back to Markdown", () => {
    const markdown = composerHtmlToMarkdown(
      '<ul data-type="taskList"><li data-type="taskItem"><input type="checkbox"><p>Review</p></li></ul>',
    );

    expect(markdown).toContain("- [ ] Review");
  });
});
