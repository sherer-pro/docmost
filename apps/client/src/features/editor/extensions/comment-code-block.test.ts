// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import {
  Comment,
  CustomCodeBlock,
  isTextRangeSelected,
  isTextSelected,
} from "@docmost/editor-ext";
import { describe, expect, it } from "vitest";

const TestCodeBlock = CustomCodeBlock.extend({
  addNodeView() {
    return undefined as any;
  },
  addProseMirrorPlugins() {
    return [];
  },
});

function createEditor(content: unknown) {
  return new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Comment.configure({
        HTMLAttributes: {
          class: "comment-mark",
        },
      }),
      TestCodeBlock.configure({
        lowlight: {},
      }),
    ],
    content,
  });
}

function createTableEditor(content: unknown) {
  return new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
  });
}

function getCodeBlockContentStart(editor: Editor): number {
  let contentStart = 0;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      contentStart = pos + 1;
      return false;
    }

    return true;
  });

  return contentStart;
}

function countCommentMarks(value: {
  descendants: (callback: (node: any) => void) => void;
}): number {
  let count = 0;
  value.descendants((node) => {
    count +=
      node.marks?.filter((mark) => mark.type.name === "comment").length ?? 0;
  });
  return count;
}

describe("inline comments in editor selections", () => {
  it("allows comment marks inside code blocks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [{ type: "text", text: "const value = 1;" }],
        },
      ],
    });

    try {
      const contentStart = getCodeBlockContentStart(editor);
      const from = contentStart + "const ".length;
      const to = from + "value".length;

      editor.commands.setTextSelection({ from, to });
      editor.commands.setComment("comment-1");

      const codeBlock = editor.getJSON().content?.[0];
      const markedText = codeBlock?.content?.find((node) =>
        node.marks?.some(
          (mark) =>
            mark.type === "comment" && mark.attrs?.commentId === "comment-1",
        ),
      ) as { text?: string } | undefined;
      const markElement = editor.view.dom.querySelector(
        '.comment-mark[data-comment-id="comment-1"]',
      );

      expect(markedText?.text).toBe("value");
      expect(markElement?.textContent).toBe("value");
    } finally {
      editor.destroy();
    }
  });

  it("restores a deleted inline anchor through undo and redo", () => {
    const editor = createEditor("<p>Alpha Beta Gamma</p>");

    try {
      editor.commands.setTextSelection({ from: 7, to: 11 });
      editor.commands.setComment("comment-undo");
      expect(countCommentMarks(editor.state.doc)).toBe(1);

      editor.commands.deleteSelection();
      expect(countCommentMarks(editor.state.doc)).toBe(0);

      editor.commands.undo();
      expect(editor.getText()).toContain("Beta");
      expect(countCommentMarks(editor.state.doc)).toBe(1);

      editor.commands.redo();
      expect(editor.getText()).not.toContain("Beta");
      expect(countCommentMarks(editor.state.doc)).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("strips an existing comment id from pasted content", () => {
    const editor = createEditor("<p>Alpha Beta Gamma</p>");

    try {
      editor.commands.setTextSelection({ from: 7, to: 11 });
      editor.commands.setComment("comment-copy");
      let pasted = editor.state.doc.slice(7, 11);

      editor.view.someProp("transformPasted", (transform) => {
        pasted = transform(pasted, editor.view);
        return false;
      });

      expect(countCommentMarks(pasted.content)).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("detects text ranges independently from editability", () => {
    const editor = createEditor("<p>Alpha Beta</p>");

    try {
      editor.setEditable(false);
      editor.commands.setTextSelection({ from: 1, to: 6 });

      expect(isTextRangeSelected(editor)).toBe(true);
      expect(isTextSelected(editor)).toBe(false);

      editor.commands.setTextSelection({ from: 1, to: 1 });
      expect(isTextRangeSelected(editor)).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  it("rejects non-text selections", () => {
    const editor = createEditor("<hr><p>Alpha</p>");

    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
      );

      expect(isTextRangeSelected(editor)).toBe(false);
    } finally {
      editor.destroy();
    }
  });

  it("rejects cell selections", () => {
    const editor = createTableEditor({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Alpha" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Beta" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    try {
      const cellPositions: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "tableCell") {
          cellPositions.push(pos);
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          CellSelection.create(
            editor.state.doc,
            cellPositions[0],
            cellPositions[1],
          ),
        ),
      );

      expect(isTextRangeSelected(editor)).toBe(false);
    } finally {
      editor.destroy();
    }
  });
});
