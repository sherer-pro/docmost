// @vitest-environment jsdom

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AiCitation } from "@docmost/api-contract";
import {
  aiMarkdownWithCitationLinks,
  sanitizeAiMarkdown,
} from "./ai-markdown.ts";

const citedSource: AiCitation = {
  id: "source",
  messageId: "message",
  sourceType: "page",
  sourceId: "page",
  pageId: "page",
  sourceTitle: "Document",
  sourceUrl: "/s/team/p/page#stable-heading",
  excerpt: null,
  position: 0,
  relevanceScore: null,
  citationKey: "C1",
  citationState: "cited",
  sectionId: "stable-heading",
  sectionTitle: "Stable heading",
};

describe("AI citation markdown", () => {
  it("renders normalized citations as safe section links", () => {
    const html = sanitizeAiMarkdown("Answer [C1].", [citedSource]);

    assert.match(html, /href="\/s\/team\/p\/page#stable-heading"/);
    assert.match(html, />\[1\]<\/a>/);
    assert.match(html, /title="Document — Stable heading"/);
  });

  it("does not replace markers inside code and hides unresolved streaming markers", () => {
    const html = sanitizeAiMarkdown(
      "Answer [C1] [S9]. `const source = '[C1]'`",
      [citedSource],
    );

    assert.match(html, />\[1\]<\/a>/);
    assert.doesNotMatch(html, /\[S9\]/);
    assert.match(html, /<code>const source = '\[C1\]'<\/code>/);
  });

  it("creates Markdown links for copy without changing code spans", () => {
    assert.equal(
      aiMarkdownWithCitationLinks("Answer [C1]. `code [C1]`", [citedSource]),
      "Answer [1](/s/team/p/page#stable-heading). `code [C1]`",
    );
  });

  it("does not change markers after an unclosed code fence", () => {
    assert.equal(
      aiMarkdownWithCitationLinks("Before [C1].\n```text\ncode [C1]", [
        citedSource,
      ]),
      "Before [1](/s/team/p/page#stable-heading).\n```text\ncode [C1]",
    );
  });

  it("does not create links for unsafe URLs", () => {
    const unsafe = { ...citedSource, sourceUrl: "javascript:alert(1)" };
    const html = sanitizeAiMarkdown("Answer [C1].", [unsafe]);

    assert.doesNotMatch(html, /href=/);
    assert.match(html, />\[1\]<\/span>/);
  });
});
