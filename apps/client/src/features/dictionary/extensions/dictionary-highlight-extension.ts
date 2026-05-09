import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import { findDictionaryMatches } from "@/features/dictionary/utils/dictionary-matcher";

interface DictionaryHighlightOptions {
  terms: IDictionaryTerm[];
  enabled: boolean;
}

interface DictionaryHighlightPluginState {
  decorations: DecorationSet;
  terms: IDictionaryTerm[];
  enabled: boolean;
}

interface TextNodesWithPosition {
  text: string;
  pos: number;
}

export const dictionaryHighlightPluginKey =
  new PluginKey<DictionaryHighlightPluginState>("dictionaryHighlight");

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
      return [
        new Plugin<DictionaryHighlightPluginState>({
          key: dictionaryHighlightPluginKey,
          state: {
            init: (_, state) => {
              const { enabled, terms } = this.options;

              return buildPluginState(state.doc, terms, enabled);
            },
            apply(transaction, oldPluginState, _oldState, newState) {
              const meta = getDictionaryHighlightMeta(transaction);
              const enabled = meta?.enabled ?? oldPluginState.enabled;
              const terms = meta?.terms ?? oldPluginState.terms;

              if (!enabled || terms.length === 0) {
                return {
                  decorations: DecorationSet.empty,
                  terms,
                  enabled,
                };
              }

              if (transaction.docChanged || meta) {
                return buildPluginState(newState.doc, terms, enabled);
              }

              return {
                decorations: oldPluginState.decorations.map(
                  transaction.mapping,
                  transaction.doc,
                ),
                terms,
                enabled,
              };
            },
          },
          props: {
            decorations(state) {
              return (
                dictionaryHighlightPluginKey.getState(state)?.decorations ??
                DecorationSet.empty
              );
            },
          },
        }),
      ];
    },
  });

function getDictionaryHighlightMeta(
  transaction: Transaction,
): DictionaryHighlightOptions | null {
  return (
    transaction.getMeta(dictionaryHighlightPluginKey) ??
    transaction.getMeta("dictionaryHighlight") ??
    null
  );
}

function buildPluginState(
  doc: PMNode,
  terms: IDictionaryTerm[],
  enabled: boolean,
): DictionaryHighlightPluginState {
  return {
    decorations:
      enabled && terms.length > 0 ? buildDecorations(doc, terms) : DecorationSet.empty,
    terms,
    enabled,
  };
}

function buildDecorations(doc: PMNode, terms: IDictionaryTerm[]): DecorationSet {
  const decorations: Decoration[] = [];

  collectTextNodes(doc).forEach((textNode) => {
    findDictionaryMatches(textNode.text, terms).forEach((match) => {
      const from = textNode.pos + match.from;
      const to = textNode.pos + match.to;

      if (from >= to || from < 0 || to > doc.content.size) {
        return;
      }

      decorations.push(
        Decoration.inline(from, to, {
          class: "dictionary-highlight",
          "data-dictionary-term-id": match.term.id,
          tabindex: "0",
        }),
      );
    });
  });

  return DecorationSet.create(doc, decorations);
}
