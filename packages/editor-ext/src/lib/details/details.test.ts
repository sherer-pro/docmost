// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { Details } from "./details";
import { DetailsContent } from "./details-content";
import { DetailsSummary } from "./details-summary";

describe("Details accessibility", () => {
  let editor: Editor | null = null;
  let element: HTMLDivElement | null = null;

  afterEach(() => {
    editor?.destroy();
    element?.remove();
    editor = null;
    element = null;
  });

  it("gives the disclosure button a localized accessible name", () => {
    element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Details.configure({
          getToggleButtonLabel: () => "Localized toggle label",
        }),
        DetailsSummary,
        DetailsContent,
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "details",
            attrs: { open: false },
            content: [
              {
                type: "detailsSummary",
                content: [{ type: "text", text: "Summary" }],
              },
              {
                type: "detailsContent",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Body" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const button = element.querySelector<HTMLButtonElement>(
      '[data-type="detailsButton"]',
    );

    expect(button?.type).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe(
      "Localized toggle label",
    );
  });
});
