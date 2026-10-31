import { describe, expect, it } from "vitest";
import { buildPresentationSlides } from "./presentation-slides";

describe("presentation slides", () => {
  it("splits at headings and separators while keeping long blocks and all tab content", () => {
    const source = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Introduction",
              marks: [{ type: "comment", attrs: { commentId: "thread" } }],
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Heading" }],
        },
        {
          type: "tabs",
          content: [
            {
              type: "tabItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Hidden content" }],
                },
              ],
            },
          ],
        },
        { type: "horizontalRule" },
        { type: "horizontalRule" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Long ".repeat(10000) }],
        },
        { type: "pageBreak" },
      ],
    };
    const before = structuredClone(source);
    const slides = buildPresentationSlides(source, "Page");
    expect(slides).toHaveLength(3);
    expect(slides.map((slide) => slide.title)).toEqual([
      "Page",
      "Heading",
      "Page",
    ]);
    expect(JSON.stringify(slides[1])).toContain("Hidden content");
    expect(slides[2].content.content?.[0].content?.[0].text).toHaveLength(
      50000,
    );
    expect(source).toEqual(before);
    expect(JSON.stringify(slides)).not.toContain("commentId");
  });
  it("provides one readable slide for an empty page", () => {
    expect(buildPresentationSlides(null, "Empty")).toHaveLength(1);
  });
});
