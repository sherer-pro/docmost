// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Indent } from "@docmost/editor-ext";
import { afterEach, describe, expect, it } from "vitest";

describe("Indent keyboard shortcuts", () => {
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  it("indents and outdents a paragraph at a collapsed cursor", () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Indent.configure({ types: ["heading", "paragraph"] }),
      ],
      content: "<p>Keyboard indentation target</p>",
    });
    editor.commands.setTextSelection(2);

    const tabHandled = editor.view.someProp("handleKeyDown", (handler) =>
      handler(
        editor!.view,
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(tabHandled).toBe(true);
    expect(editor.getJSON().content?.[0].attrs?.indent).toBe(1);

    const shiftTabHandled = editor.view.someProp("handleKeyDown", (handler) =>
      handler(
        editor!.view,
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(shiftTabHandled).toBe(true);
    expect(editor.getJSON().content?.[0].attrs?.indent).toBe(0);
  });

  it("indents a paragraph when its text is selected", () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Indent.configure({ types: ["heading", "paragraph"] }),
      ],
      content: "<p>Keyboard indentation target</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 28 });

    const tabHandled = editor.view.someProp("handleKeyDown", (handler) =>
      handler(
        editor!.view,
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(tabHandled).toBe(true);
    expect(editor.getJSON().content?.[0].attrs?.indent).toBe(1);
  });
});
