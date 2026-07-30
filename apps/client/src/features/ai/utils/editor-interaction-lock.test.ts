// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { lockEditorInteraction } from "./editor-interaction-lock";

function createEditor(element: HTMLElement): Editor {
  return {
    view: {
      dom: element,
    },
  } as Editor;
}

describe("lockEditorInteraction", () => {
  it("blocks interaction until the returned cleanup runs", () => {
    const element = document.createElement("div");
    const unlock = lockEditorInteraction(createEditor(element));

    expect(element.hasAttribute("inert")).toBe(true);

    unlock();

    expect(element.hasAttribute("inert")).toBe(false);
  });

  it("preserves an existing interaction lock", () => {
    const element = document.createElement("div");
    element.setAttribute("inert", "");

    const unlock = lockEditorInteraction(createEditor(element));
    unlock();

    expect(element.hasAttribute("inert")).toBe(true);
  });
});
