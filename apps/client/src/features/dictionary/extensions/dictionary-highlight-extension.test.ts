// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import {
  DictionaryHighlightExtension,
  dictionaryHighlightPluginKey,
  getDictionaryHighlightScanCount,
} from "./dictionary-highlight-extension";

const term: IDictionaryTerm = {
  id: "term-1",
  spaceId: "space-1",
  workspaceId: "workspace-1",
  term: "Alpha",
  forms: ["Alpha Beta"],
  definitionMarkdown: "Definition",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const thinSliceTerm: IDictionaryTerm = {
  ...term,
  id: "term-thin-slice",
  term: "thin-slice",
  forms: ["Thin-slice MVP"],
};

function createEditor() {
  return new Editor({
    extensions: [StarterKit, DictionaryHighlightExtension],
    content: "<p>Alpha and Alpha Beta.</p>",
  });
}

describe("DictionaryHighlightExtension", () => {
  it("builds initial decorations from configured terms", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        DictionaryHighlightExtension.configure({
          enabled: true,
          terms: [term],
        }),
      ],
      content: "<p>Alpha and Alpha Beta.</p>",
    });

    try {
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(2);
      expect(
        editor.view.dom
          .querySelector(".dictionary-highlight")
          ?.getAttribute("aria-description"),
      ).toBe("Definition");
    } finally {
      editor.destroy();
    }
  });

  it("updates decorations through plugin metadata without rebuilding extensions", () => {
    const editor = createEditor();

    try {
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(0);

      editor.view.dispatch(
        editor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: true,
          terms: [term],
        }),
      );

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(2);
    } finally {
      editor.destroy();
    }
  });

  it("rebuilds decorations immediately when content hydrates after the dictionary", () => {
    const editor = new Editor({
      extensions: [StarterKit, DictionaryHighlightExtension],
      content: "",
    });

    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: true,
          terms: [term],
        }),
      );

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(0);

      editor.commands.setContent("<p>Alpha and Alpha Beta.</p>");

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(2);
    } finally {
      editor.destroy();
    }
  });

  it("updates a newly matching text block immediately", () => {
    const editor = new Editor({
      extensions: [StarterKit, DictionaryHighlightExtension],
      content: "<p>No match.</p>",
    });

    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: true,
          terms: [term],
        }),
      );

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(0);

      editor.commands.insertContentAt(
        editor.state.doc.content.size - 1,
        " Alpha",
      );

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });

  it("clears decorations when dictionary highlighting is disabled", () => {
    const editor = createEditor();

    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: true,
          terms: [term],
        }),
      );
      editor.view.dispatch(
        editor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: false,
          terms: [term],
        }),
      );

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });

  it("updates existing decorations immediately during typing", () => {
    const editor = createEditor();

    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: true,
          terms: [term],
        }),
      );

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(2);

      editor.commands.insertContentAt(
        editor.state.doc.content.size - 1,
        " Alpha",
      );

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(3);
    } finally {
      editor.destroy();
    }
  });

  it("removes a deleted match immediately", () => {
    const editor = createEditor();

    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: true,
          terms: [term],
        }),
      );

      editor.commands.deleteRange({ from: 1, to: 6 });

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });

  it("matches a multi-word form across marked text nodes", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        DictionaryHighlightExtension.configure({
          enabled: true,
          terms: [term],
        }),
      ],
      content: "<p>Alpha <strong>Beta</strong></p>",
    });

    try {
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });

  it("highlights inline code and code blocks while excluding links", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        DictionaryHighlightExtension.configure({
          enabled: true,
          terms: [thinSliceTerm],
        }),
      ],
      content:
        '<p><a href="https://example.com">thin-slice</a> plain thin-slice <code>Thin-slice MVP</code></p><pre><code>thin-slice</code></pre>',
    });

    try {
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(3);
      expect(
        editor.view.dom.querySelectorAll("p .dictionary-highlight"),
      ).toHaveLength(2);
      expect(
        editor.view.dom.querySelectorAll("p code .dictionary-highlight"),
      ).toHaveLength(1);
      expect(
        editor.view.dom.querySelectorAll("pre code .dictionary-highlight"),
      ).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });

  it("keeps incremental decorations correct across undo and redo", () => {
    const editor = createEditor();

    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: true,
          terms: [term],
        }),
      );

      editor.commands.insertContentAt(
        editor.state.doc.content.size - 1,
        " Alpha",
      );
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(3);

      editor.commands.undo();
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(2);

      editor.commands.redo();
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(3);
      expect(getDictionaryHighlightScanCount(editor.state)).toBeLessThanOrEqual(
        2,
      );
    } finally {
      editor.destroy();
    }
  });

  it("updates phrase decorations across block splits and joins", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        DictionaryHighlightExtension.configure({
          enabled: true,
          terms: [term],
        }),
      ],
      content: "<p>Alpha Beta</p>",
    });

    try {
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(1);

      editor.commands.setTextSelection(6);
      editor.commands.splitBlock();

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toEqual([expect.objectContaining({ from: 1, to: 6 })]);

      editor.commands.joinBackward();

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toEqual([expect.objectContaining({ from: 1, to: 11 })]);
    } finally {
      editor.destroy();
    }
  });

  it("scans only nearby blocks for a small edit in a large document", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        DictionaryHighlightExtension.configure({
          enabled: true,
          terms: [term],
        }),
      ],
      content: {
        type: "doc",
        content: Array.from({ length: 1_001 }, () => ({
          type: "paragraph",
          content: [{ type: "text", text: "Alpha" }],
        })),
      },
    });

    try {
      expect(getDictionaryHighlightScanCount(editor.state)).toBe(1_001);

      editor.commands.insertContentAt(2, "x");

      expect(getDictionaryHighlightScanCount(editor.state)).toBeLessThanOrEqual(
        2,
      );
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(1_000);
    } finally {
      editor.destroy();
    }
  });

  it("scans only the edited code block in a large code document", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        DictionaryHighlightExtension.configure({
          enabled: true,
          terms: [term],
        }),
      ],
      content: {
        type: "doc",
        content: Array.from({ length: 1_001 }, () => ({
          type: "codeBlock",
          attrs: { language: null },
          content: [{ type: "text", text: "Alpha" }],
        })),
      },
    });

    try {
      expect(getDictionaryHighlightScanCount(editor.state)).toBe(1_001);

      editor.commands.insertContentAt(2, "x");

      expect(getDictionaryHighlightScanCount(editor.state)).toBeLessThanOrEqual(
        2,
      );
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(1_000);
    } finally {
      editor.destroy();
    }
  });

  it("scans only the edited block in a large inline-code document", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        DictionaryHighlightExtension.configure({
          enabled: true,
          terms: [term],
        }),
      ],
      content: {
        type: "doc",
        content: Array.from({ length: 1_001 }, () => ({
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "code" }],
              text: "Alpha",
            },
          ],
        })),
      },
    });

    try {
      expect(getDictionaryHighlightScanCount(editor.state)).toBe(1_001);

      editor.commands.insertContentAt(2, "x");

      expect(getDictionaryHighlightScanCount(editor.state)).toBeLessThanOrEqual(
        2,
      );
      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(1_000);
    } finally {
      editor.destroy();
    }
  });
});
