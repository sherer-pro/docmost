// @vitest-environment happy-dom

import { Editor, getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { DOMSerializer } from "@tiptap/pm/model";
import { Tag } from "@docmost/editor-ext";
import { describe, expect, it } from "vitest";
import {
  serializeTagClipboardText,
  TagClipboard,
} from "./tag-clipboard";

const schema = getSchema([StarterKit, Tag]);

function createDocument() {
  return schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Scope " },
          { type: "tag", attrs: { value: "core" } },
          { type: "text", text: " then " },
          { type: "tag", attrs: { value: "future" } },
          { type: "text", text: " and " },
          { type: "tag", attrs: { value: "pilot" } },
        ],
      },
    ],
  });
}

describe("tag clipboard", () => {
  it("serializes mixed rich content to tag markdown in text/plain", () => {
    const doc = createDocument();

    expect(serializeTagClipboardText(doc, 0, doc.content.size)).toBe(
      "Scope ::tag[Core] then ::tag[Future] and ::tag[Pilot]",
    );
  });

  it("keeps lossless tag attributes in rich clipboard HTML", () => {
    const doc = createDocument();
    const container = document.createElement("div");
    container.appendChild(
      DOMSerializer.fromSchema(schema).serializeFragment(doc.content, {
        document,
      }),
    );

    expect(container.innerHTML).toContain(
      '<span data-type="tag" data-tag-value="core">Core</span>',
    );
    expect(container.innerHTML).toContain(
      '<span data-type="tag" data-tag-value="future">Future</span>',
    );
    expect(container.innerHTML).toContain(
      '<span data-type="tag" data-tag-value="pilot">Pilot</span>',
    );
  });

  it("restores tag nodes from rich clipboard HTML", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, Tag, TagClipboard],
      content: "<p>Anchor</p>",
    });
    editor.commands.focus("end");

    const data = new DataTransfer();
    data.setData(
      "text/html",
      '<span data-type="tag" data-tag-value="core" data-pm-slice="0 0 []">Core</span>',
    );
    data.setData("text/plain", "::tag[Core]");
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", { value: data });

    editor.view.dom.dispatchEvent(event);

    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          content: [
            { type: "text", text: "Anchor" },
            { type: "tag", attrs: { value: "core" } },
          ],
        },
      ],
    });
    editor.destroy();
    element.remove();
  });
});
