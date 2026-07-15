// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { HeadingNumbering } from "@docmost/editor-ext";
import { getEditorMarkdown } from "./editor-markdown";

describe("getEditorMarkdown", () => {
  it("adds calculated numbers only to the serialized copy", () => {
    const editor = new Editor({
      extensions: [StarterKit, HeadingNumbering],
      content: "<h2>Section</h2><h3>Child</h3>",
    });

    expect(getEditorMarkdown(editor, true)).toContain("## 1\\. Section");
    expect(getEditorMarkdown(editor, true)).toContain("### 1.1. Child");
    expect(editor.getText()).toBe("Section\n\nChild");

    editor.destroy();
  });
});
