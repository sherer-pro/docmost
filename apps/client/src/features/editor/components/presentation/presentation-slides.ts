import type { JSONContent } from "@tiptap/core";

export type PresentationSlide = { title: string; content: JSONContent };
export function buildPresentationSlides(
  document: JSONContent | null | undefined,
  title: string,
): PresentationSlide[] {
  const slides: PresentationSlide[] = [];
  let blocks: JSONContent[] = [];
  let slideTitle = title;
  const flush = () => {
    if (!blocks.length) return;
    slides.push({
      title: slideTitle,
      content: { type: "doc", content: blocks },
    });
    blocks = [];
    slideTitle = title;
  };
  for (const block of document?.content ?? []) {
    if (block.type === "horizontalRule" || block.type === "pageBreak") {
      flush();
      continue;
    }
    if (block.type === "heading") {
      flush();
      slideTitle =
        (block.content ?? []).map((child) => child.text ?? "").join("") ||
        title;
    }
    const copy = structuredClone(block);
    const pending = [copy];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.marks)
        node.marks = node.marks.filter((mark) => mark.type !== "comment");
      pending.push(...(node.content ?? []));
    }
    blocks.push(copy);
  }
  flush();
  return slides.length
    ? slides
    : [{ title, content: { type: "doc", content: [{ type: "paragraph" }] } }];
}
