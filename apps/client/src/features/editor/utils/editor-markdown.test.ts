// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  HeadingNumbering,
  TransclusionReference,
  TransclusionSource,
} from "@docmost/editor-ext";
import { getEditorMarkdown } from "./editor-markdown";

const TestTransclusionSource = TransclusionSource.extend({
  content: "block+",
});

describe("getEditorMarkdown", () => {
  it("adds calculated numbers only to the serialized copy", async () => {
    const editor = new Editor({
      extensions: [StarterKit, HeadingNumbering],
      content: "<h2>Section</h2><h3>Child</h3>",
    });

    expect(await getEditorMarkdown(editor, true)).toContain("## 1\\. Section");
    expect(await getEditorMarkdown(editor, true)).toContain("### 1.1. Child");
    expect(editor.getText()).toBe("Section\n\nChild");

    editor.destroy();
  });

  it.each([
    {
      name: "resolved",
      resolution: {
        sourcePageId: "11111111-1111-4111-8111-111111111111",
        transclusionId: "22222222-2222-4222-8222-222222222222",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Materialized shared text" }],
            },
          ],
        },
      },
      expected: "Materialized shared text",
    },
    {
      name: "unavailable",
      resolution: {
        sourcePageId: "11111111-1111-4111-8111-111111111111",
        transclusionId: "22222222-2222-4222-8222-222222222222",
        status: "no_access",
      },
      expected: "Reference unavailable",
    },
  ])(
    "materializes a $name synced reference for copied Markdown",
    async ({ resolution, expected }) => {
      const sourcePageId = "11111111-1111-4111-8111-111111111111";
      const transclusionId = "22222222-2222-4222-8222-222222222222";
      const content = {
        type: "doc",
        content: [
          {
            type: "transclusionReference",
            attrs: { sourcePageId, transclusionId },
          },
        ],
      };
      const editor = new Editor({
        extensions: [StarterKit, TestTransclusionSource, TransclusionReference],
        content,
      });
      const lookup = vi.fn(async () => ({ items: [resolution] }));

      const markdown = await getEditorMarkdown(editor, false, {
        lookup: lookup as any,
        strings: {
          label: "Synced block",
          unavailable: "Reference unavailable",
        },
      });

      expect(lookup).toHaveBeenCalledWith({
        references: [{ sourcePageId, transclusionId }],
      });
      expect(markdown).toContain("> **Synced block**");
      expect(markdown).toContain(`> ${expected}`);
      expect(markdown).not.toContain("transclusionReference");
      expect(markdown).not.toContain(sourcePageId);
      expect(markdown).not.toContain(transclusionId);
      expect(editor.getJSON()).toEqual(content);

      editor.destroy();
    },
  );
});
