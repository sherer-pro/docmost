// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import {
  DictionaryHighlightExtension,
  dictionaryHighlightPluginKey,
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

function createEditor() {
  return new Editor({
    extensions: [StarterKit, DictionaryHighlightExtension],
    content: "<p>Alpha and Alpha Beta.</p>",
  });
}

describe("DictionaryHighlightExtension", () => {
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

  it("maps decorations during typing and rebuilds them after debounce", () => {
    vi.useFakeTimers();
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
      ).toHaveLength(2);

      vi.advanceTimersByTime(250);

      expect(
        dictionaryHighlightPluginKey.getState(editor.state)?.decorations.find(),
      ).toHaveLength(3);
    } finally {
      editor.destroy();
      vi.useRealTimers();
    }
  });
});
