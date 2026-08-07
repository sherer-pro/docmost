// @vitest-environment happy-dom

import { DOMParser, Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { createTransclusionClipboardPayload } from "./transclusion-clipboard";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    transclusionReference: {
      group: "block",
      atom: true,
      attrs: { sourcePageId: {}, transclusionId: {} },
      parseDOM: [
        {
          tag: 'div[data-type="transclusionReference"]',
          getAttrs: (element) => ({
            sourcePageId: (element as HTMLElement).dataset.sourcePageId,
            transclusionId: (element as HTMLElement).dataset.transclusionId,
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          "data-type": "transclusionReference",
          "data-source-page-id": node.attrs.sourcePageId,
          "data-transclusion-id": node.attrs.transclusionId,
        },
      ],
    },
  },
});

const strings = {
  label: "Synced block",
  unavailable: "Content unavailable",
};

describe("transclusion clipboard", () => {
  it("writes both presentation content and lossless reference attributes", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<div data-type="transclusionReference" data-source-page-id="page-1" data-transclusion-id="block-1"></div>';

    const payload = createTransclusionClipboardPayload({
      container,
      schema,
      strings,
      resolutions: new Map([
        [
          "page-1:block-1",
          {
            sourcePageId: "page-1",
            transclusionId: "block-1",
            sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Shared text" }],
                },
              ],
            },
          },
        ],
      ]),
    });

    expect(payload.html).toContain('data-source-page-id="page-1"');
    expect(payload.html).toContain("Synced block");
    expect(payload.html).toContain("Shared text");
    expect(payload.text.trim()).toBe("> **Synced block**\n>\n> Shared text");

    const pasteHost = document.createElement("div");
    pasteHost.innerHTML = payload.html;
    const parsed = DOMParser.fromSchema(schema).parse(pasteHost);
    expect(parsed.firstChild?.type.name).toBe("transclusionReference");
    expect(parsed.firstChild?.attrs).toMatchObject({
      sourcePageId: "page-1",
      transclusionId: "block-1",
    });
  });

  it("uses a safe placeholder when no snapshot is cached", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<div data-type="transclusionReference" data-source-page-id="page-1" data-transclusion-id="block-1"></div>';

    const payload = createTransclusionClipboardPayload({
      container,
      schema,
      strings,
      resolutions: new Map(),
    });

    expect(payload.html).toContain("Content unavailable");
    expect(payload.text).toContain("> Content unavailable");
  });

  it("leaves ordinary copied documents unframed", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>Ordinary text</p>";

    const payload = createTransclusionClipboardPayload({
      container,
      schema,
      strings,
      resolutions: new Map(),
    });

    expect(payload.html).toBe("<p>Ordinary text</p>");
    expect(payload.text).toBe("Ordinary text");
  });

});
