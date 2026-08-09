import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";
import { TransclusionSource } from "@docmost/editor-ext";
import { describe, expect, it } from "vitest";
import { canCreateSyncedBlock } from "./can-create-synced-block";

const TestTransclusionSource = TransclusionSource.extend({
  content: "(paragraph | bulletList)+",
});

function createEditor(content: Record<string, unknown>) {
  return new Editor({
    extensions: [StarterKit, TestTransclusionSource],
    content,
  });
}

describe("canCreateSyncedBlock", () => {
  it("allows a selected top-level text range", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Top level text" }],
        },
      ],
    });
    editor.commands.setTextSelection({ from: 1, to: 5 });

    expect(canCreateSyncedBlock(editor as any)).toBe(true);
    editor.destroy();
  });

  it("allows an allowlisted top-level node selection", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "List item" }],
                },
              ],
            },
          ],
        },
      ],
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    );

    expect(canCreateSyncedBlock(editor as any)).toBe(true);
    editor.destroy();
  });

  it("rejects nested text and an existing synced block", () => {
    const nestedEditor = createEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Nested text" }],
                },
              ],
            },
          ],
        },
      ],
    });
    nestedEditor.commands.setTextSelection({ from: 3, to: 7 });
    expect(canCreateSyncedBlock(nestedEditor as any)).toBe(false);
    nestedEditor.destroy();

    const sourceEditor = createEditor({
      type: "doc",
      content: [
        {
          type: "transclusionSource",
          attrs: { id: "019fe65f-74e2-7d91-989c-311da2f9b95e" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Already synced" }],
            },
          ],
        },
      ],
    });
    sourceEditor.commands.setTextSelection({ from: 2, to: 6 });
    expect(canCreateSyncedBlock(sourceEditor as any)).toBe(false);
    sourceEditor.destroy();
  });
});
// @vitest-environment happy-dom
