// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { Details } from "./details";
import { DetailsContent } from "./details-content";
import { DetailsSummary } from "./details-summary";
import { htmlToMarkdown } from '../markdown/utils/turndown.utils';
import { markdownToHtml } from '../markdown/utils/marked.utils';

describe("Details accessibility", () => {
  let editor: Editor | null = null;
  let element: HTMLDivElement | null = null;

  afterEach(() => {
    editor?.destroy();
    element?.remove();
    editor = null;
    element = null;
  });

  it('keeps a Markdown paragraph wrapper inside the inline summary when importing', async () => {
    const markdown = htmlToMarkdown(
      '<details><summary>Release <strong>notes</strong></summary><p>First body</p><p>Second body</p></details>',
    );
    editor = new Editor({
      extensions: [StarterKit, Details, DetailsSummary, DetailsContent],
      content: await markdownToHtml(markdown),
    });
    const details = editor.getJSON().content?.[0];
    const summary = details?.content?.[0];
    expect(summary?.type).toBe('detailsSummary');
    expect(summary?.content?.map((node) => node.text ?? '').join('')).toBe(
      'Release notes',
    );
    expect(
      summary?.content?.some((node) =>
        node.marks?.some((mark) => mark.type === 'bold'),
      ),
    ).toBe(true);
    expect(
      details?.content?.[1].content?.map(
        (paragraph) => paragraph.content?.[0].text,
      ),
    ).toEqual(['First body', 'Second body']);
  });
  it('does not discard meaningful text beside an imported summary paragraph', () => {
    editor = new Editor({
      extensions: [StarterKit, Details, DetailsSummary, DetailsContent],
      content:
        '<details><summary>Before<p>Middle</p>After</summary><div data-type="detailsContent"><p>Body</p></div></details>',
    });
    for (const text of ['Before', 'Middle', 'After', 'Body'])
      expect(editor.getText()).toContain(text);
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
