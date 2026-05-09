import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import { findDictionaryMatches } from "@/features/dictionary/utils/dictionary-matcher";

interface DictionaryHighlightOptions {
  terms: IDictionaryTerm[];
  enabled: boolean;
}

interface TextNodesWithPosition {
  text: string;
  pos: number;
}

function collectTextNodes(doc: PMNode): TextNodesWithPosition[] {
  const textNodesWithPosition: TextNodesWithPosition[] = [];
  let index = 0;

  doc.descendants((node, pos) => {
    if (node.isText) {
      if (textNodesWithPosition[index]) {
        textNodesWithPosition[index] = {
          text: textNodesWithPosition[index].text + node.text,
          pos: textNodesWithPosition[index].pos,
        };
      } else {
        textNodesWithPosition[index] = {
          text: `${node.text}`,
          pos,
        };
      }
    } else {
      index += 1;
    }
  });

  return textNodesWithPosition.filter(Boolean);
}

export const DictionaryHighlightExtension =
  Extension.create<DictionaryHighlightOptions>({
    name: "dictionaryHighlight",

    addOptions() {
      return {
        terms: [],
        enabled: false,
      };
    },

    addProseMirrorPlugins() {
      const { terms, enabled } = this.options;

      return [
        new Plugin({
          key: new PluginKey("dictionaryHighlight"),
          state: {
            init: (_, state) => {
              if (!enabled || terms.length === 0) {
                return DecorationSet.empty;
              }

              return buildDecorations(state.doc, terms);
            },
            apply(transaction, oldState) {
              if (!enabled || terms.length === 0) {
                return DecorationSet.empty;
              }

              if (!transaction.docChanged) {
                return oldState.map(transaction.mapping, transaction.doc);
              }

              return buildDecorations(transaction.doc, terms);
            },
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },
          },
        }),
      ];
    },
  });

function buildDecorations(doc: PMNode, terms: IDictionaryTerm[]): DecorationSet {
  const decorations: Decoration[] = [];

  collectTextNodes(doc).forEach((textNode) => {
    findDictionaryMatches(textNode.text, terms).forEach((match) => {
      decorations.push(
        Decoration.inline(textNode.pos + match.from, textNode.pos + match.to, {
          class: "dictionary-highlight",
          "data-dictionary-term-id": match.term.id,
          tabindex: "0",
        }),
      );
    });
  });

  return DecorationSet.create(doc, decorations);
}
