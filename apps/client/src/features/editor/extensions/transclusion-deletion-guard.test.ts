// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TransclusionReference,
  TransclusionSource,
} from "@docmost/editor-ext";
import { TransclusionDeletionGuard } from "./transclusion-deletion-guard";

const editors: Editor[] = [];
const TestTransclusionSource = TransclusionSource.extend({
  content: "paragraph+",
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

function createEditor(content: unknown, onBlocked = vi.fn()) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      Paragraph,
      Text,
      TestTransclusionSource,
      TransclusionReference,
      TransclusionDeletionGuard.configure({ onBlocked }),
    ],
    content,
  });
  editors.push(editor);
  return { editor, onBlocked };
}

const sourceDocument = {
  type: "doc",
  content: [
    {
      type: "transclusionSource",
      attrs: { id: "source-1" },
      content: [{ type: "paragraph" }],
    },
    { type: "paragraph" },
  ],
};

const rangeDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "before" }],
    },
    {
      type: "transclusionSource",
      attrs: { id: "source-1" },
      content: [{ type: "paragraph" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "after" }],
    },
  ],
};

function selectionAcrossSource(editor: Editor) {
  const sourcePosition = editor.state.doc.child(0).nodeSize;
  const source = editor.state.doc.nodeAt(sourcePosition)!;
  return TextSelection.create(
    editor.state.doc,
    1,
    sourcePosition + source.nodeSize + 1,
  );
}

describe("TransclusionDeletionGuard", () => {
  it("blocks Del/Backspace deletion of a selected referenced source", async () => {
    const { editor, onBlocked } = createEditor(sourceDocument);
    editor.storage.transclusionDeletionGuard.sourceStates.set(
      "source-1",
      "referenced",
    );

    editor.chain().setNodeSelection(0).deleteSelection().run();
    await Promise.resolve();

    expect(editor.getJSON().content?.[0].type).toBe("transclusionSource");
    expect(onBlocked).toHaveBeenCalledWith("referenced");
  });

  it("blocks cutting or deleting a range containing a referenced source", async () => {
    const { editor, onBlocked } = createEditor(rangeDocument);
    editor.storage.transclusionDeletionGuard.sourceStates.set(
      "source-1",
      "referenced",
    );
    const transaction = editor.state.tr.setSelection(
      selectionAcrossSource(editor),
    );

    editor.view.dispatch(transaction.deleteSelection());
    await Promise.resolve();

    expect(editor.getJSON().content?.[1].type).toBe("transclusionSource");
    expect(onBlocked).toHaveBeenCalledWith("referenced");
  });

  it("blocks replacing a range containing a referenced source", async () => {
    const { editor, onBlocked } = createEditor(rangeDocument);
    editor.storage.transclusionDeletionGuard.sourceStates.set(
      "source-1",
      "referenced",
    );
    const transaction = editor.state.tr.setSelection(
      selectionAcrossSource(editor),
    );

    editor.view.dispatch(
      transaction.replaceSelectionWith(editor.schema.text("replacement")),
    );
    await Promise.resolve();

    expect(editor.getJSON().content?.[1].type).toBe("transclusionSource");
    expect(onBlocked).toHaveBeenCalledWith("referenced");
  });

  it("blocks deleting an all-document selection", async () => {
    const { editor, onBlocked } = createEditor(rangeDocument);
    editor.storage.transclusionDeletionGuard.sourceStates.set(
      "source-1",
      "referenced",
    );
    const transaction = editor.state.tr.setSelection(
      new AllSelection(editor.state.doc),
    );

    editor.view.dispatch(transaction.deleteSelection());
    await Promise.resolve();

    expect(editor.getJSON().content?.[1].type).toBe("transclusionSource");
    expect(onBlocked).toHaveBeenCalledWith("referenced");
  });

  it("fails closed while reference state is unknown", async () => {
    const { editor, onBlocked } = createEditor(sourceDocument);

    editor.chain().setNodeSelection(0).deleteSelection().run();
    await Promise.resolve();

    expect(editor.getJSON().content?.[0].type).toBe("transclusionSource");
    expect(onBlocked).toHaveBeenCalledWith("unknown");
  });

  it("allows deleting an unreferenced source", () => {
    const { editor, onBlocked } = createEditor(sourceDocument);
    editor.storage.transclusionDeletionGuard.sourceStates.set(
      "source-1",
      "unreferenced",
    );

    editor.chain().setNodeSelection(0).deleteSelection().run();

    expect(editor.getJSON().content).toEqual([{ type: "paragraph" }]);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("allows moving a referenced source when its id remains in the document", () => {
    const { editor, onBlocked } = createEditor(sourceDocument);
    editor.storage.transclusionDeletionGuard.sourceStates.set(
      "source-1",
      "referenced",
    );
    const source = editor.state.doc.nodeAt(0)!;
    const transaction = editor.state.tr.delete(0, source.nodeSize);
    transaction.insert(transaction.doc.content.size, source);

    editor.view.dispatch(transaction);

    expect(editor.getJSON().content?.at(-1)?.type).toBe(
      "transclusionSource",
    );
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("does not protect reference copies", () => {
    const { editor, onBlocked } = createEditor({
      type: "doc",
      content: [
        {
          type: "transclusionReference",
          attrs: {
            sourcePageId: "00000000-0000-0000-0000-000000000001",
            transclusionId: "source-1",
          },
        },
        { type: "paragraph" },
      ],
    });

    editor.chain().setNodeSelection(0).deleteSelection().run();

    expect(editor.getJSON().content).toEqual([{ type: "paragraph" }]);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("does not filter collaboration-origin source deletion", () => {
    const { editor, onBlocked } = createEditor(sourceDocument);
    editor.storage.transclusionDeletionGuard.sourceStates.set(
      "source-1",
      "referenced",
    );
    const source = editor.state.doc.nodeAt(0)!;

    editor.view.dispatch(
      editor.state.tr
        .delete(0, source.nodeSize)
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    );

    expect(editor.getJSON().content).toEqual([{ type: "paragraph" }]);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
