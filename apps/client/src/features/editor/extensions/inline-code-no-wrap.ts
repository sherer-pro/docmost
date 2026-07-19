import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const INLINE_CODE_NO_WRAP_MAX_LENGTH = 25;

export interface InlineCodeRange {
  from: number;
  to: number;
  text: string;
}

export function shouldKeepInlineCodeOnOneLine(text: string): boolean {
  return (
    text.length > 0 &&
    Array.from(text).length < INLINE_CODE_NO_WRAP_MAX_LENGTH &&
    !/\s/u.test(text)
  );
}

export function getInlineCodeNoWrapRanges(
  doc: ProseMirrorNode,
): InlineCodeRange[] {
  const ranges: InlineCodeRange[] = [];
  let currentRange: InlineCodeRange | null = null;

  const finishCurrentRange = () => {
    if (
      currentRange &&
      shouldKeepInlineCodeOnOneLine(currentRange.text)
    ) {
      ranges.push(currentRange);
    }

    currentRange = null;
  };

  doc.descendants((node, pos) => {
    if (!node.isText) {
      if (currentRange) {
        finishCurrentRange();
      }
      return true;
    }

    const isInlineCode = node.marks.some((mark) => mark.type.name === "code");
    if (!isInlineCode) {
      finishCurrentRange();
      return;
    }

    const text = node.text || "";
    const to = pos + node.nodeSize;

    if (currentRange && currentRange.to === pos) {
      currentRange.to = to;
      currentRange.text += text;
      return;
    }

    finishCurrentRange();
    currentRange = { from: pos, to, text };
  });

  finishCurrentRange();
  return ranges;
}

function createInlineCodeNoWrapDecorations(
  doc: ProseMirrorNode,
): DecorationSet {
  const decorations = getInlineCodeNoWrapRanges(doc).map(({ from, to }) =>
    Decoration.inline(from, to, { class: "inlineCodeNoWrap" }),
  );

  return DecorationSet.create(doc, decorations);
}

const inlineCodeNoWrapPluginKey = new PluginKey<DecorationSet>(
  "inlineCodeNoWrap",
);

export const InlineCodeNoWrap = Extension.create({
  name: "inlineCodeNoWrap",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: inlineCodeNoWrapPluginKey,
        state: {
          init: (_, state) => createInlineCodeNoWrapDecorations(state.doc),
          apply: (transaction, decorations) =>
            transaction.docChanged
              ? createInlineCodeNoWrapDecorations(transaction.doc)
              : decorations,
        },
        props: {
          decorations: (state) =>
            inlineCodeNoWrapPluginKey.getState(state) || null,
        },
      }),
    ];
  },
});
