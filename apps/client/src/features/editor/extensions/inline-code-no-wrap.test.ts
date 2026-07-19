// @vitest-environment jsdom

import { Editor, Mark } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  getInlineCodeNoWrapRanges,
  InlineCodeNoWrap,
  shouldKeepInlineCodeOnOneLine,
} from "./inline-code-no-wrap";

const TestCode = Mark.create({
  name: "code",
  excludes: "",
  parseHTML: () => [{ tag: "code" }],
  renderHTML: () => ["code", 0],
});

const Splitter = Mark.create({
  name: "splitter",
  excludes: "",
  renderHTML: () => ["span", { "data-splitter": "true" }, 0],
});

function createEditor(content: unknown) {
  return new Editor({
    extensions: [
      StarterKit.configure({ code: false }),
      TestCode,
      Splitter,
      InlineCodeNoWrap,
    ],
    content,
  });
}

describe("inline code no-wrap", () => {
  it("keeps only short values without whitespace on one line", () => {
    expect(shouldKeepInlineCodeOnOneLine("D7-C-01")).toBe(true);
    expect(shouldKeepInlineCodeOnOneLine("a".repeat(24))).toBe(true);
    expect(shouldKeepInlineCodeOnOneLine("a".repeat(25))).toBe(false);
    expect(shouldKeepInlineCodeOnOneLine("two words")).toBe(false);
    expect(shouldKeepInlineCodeOnOneLine("two\twords")).toBe(false);
  });

  it("decorates short inline code and updates after document changes", () => {
    const editor = createEditor("<p><code>D7-C-01</code></p>");

    try {
      expect(
        editor.view.dom.querySelector(".inlineCodeNoWrap")?.textContent,
      ).toBe("D7-C-01");

      editor.commands.setContent(
        `<p><code>${"a".repeat(25)}</code></p>`,
      );
      expect(editor.view.dom.querySelector(".inlineCodeNoWrap")).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("treats adjacent marked text nodes as one inline-code fragment", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "short",
              marks: [{ type: "code" }],
            },
            {
              type: "text",
              text: "-token",
              marks: [{ type: "code" }, { type: "splitter" }],
            },
          ],
        },
      ],
    });

    try {
      expect(getInlineCodeNoWrapRanges(editor.state.doc)).toEqual([
        { from: 1, to: 12, text: "short-token" },
      ]);
    } finally {
      editor.destroy();
    }
  });

  it("does not decorate block code", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "short-token" }],
        },
      ],
    });

    try {
      expect(editor.view.dom.querySelector(".inlineCodeNoWrap")).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});
