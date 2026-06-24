import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import {
  createDictionaryMatcherIndex,
  DictionaryMatcherIndex,
  findDictionaryMatches,
} from "@/features/dictionary/utils/dictionary-matcher";

interface DictionaryHighlightOptions {
  terms: IDictionaryTerm[];
  matcherIndex?: DictionaryMatcherIndex;
  enabled: boolean;
}

interface DictionaryHighlightPluginState {
  decorations: DecorationSet;
  hasDecorations: boolean;
  terms: IDictionaryTerm[];
  matcherIndex: DictionaryMatcherIndex;
  enabled: boolean;
}

interface DictionaryHighlightPluginMeta extends DictionaryHighlightOptions {
  rebuild?: boolean;
}

interface TextNodesWithPosition {
  text: string;
  pos: number;
}

interface DictionaryDecorationResult {
  decorations: DecorationSet;
  hasDecorations: boolean;
}

const DICTIONARY_HIGHLIGHT_REBUILD_DELAY_MS = 250;

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

              return buildPluginState(state.doc, {
                enabled,
                terms,
                matcherIndex: this.options.matcherIndex,
              });
            },
            apply(transaction, oldPluginState, oldState, newState) {
              const meta = getDictionaryHighlightMeta(transaction);
              const enabled = meta?.enabled ?? oldPluginState.enabled;
              const terms = meta?.terms ?? oldPluginState.terms;
              const matcherIndex =
                meta?.matcherIndex ??
                (meta?.terms
                  ? createDictionaryMatcherIndex(meta.terms)
                  : oldPluginState.matcherIndex);

              if (!enabled || matcherIndex.patterns.length === 0) {
                return {
                  decorations: DecorationSet.empty,
                  hasDecorations: false,
                  terms,
                  matcherIndex,
                  enabled,
                };
              }

              if (meta || meta?.rebuild) {
                return buildPluginState(newState.doc, {
                  enabled,
                  terms,
                  matcherIndex,
                });
              }

              if (transaction.docChanged) {
                if (
                  !oldPluginState.hasDecorations &&
                  oldState.doc.textContent.length === 0
                ) {
                  return buildPluginState(newState.doc, {
                    enabled,
                    terms,
                    matcherIndex,
                  });
                }

                return {
                  decorations: oldPluginState.decorations.map(
                    transaction.mapping,
                    transaction.doc,
                  ),
                  hasDecorations: oldPluginState.hasDecorations,
                  terms,
                  matcherIndex,
                  enabled,
                };
              }

              return {
                decorations: oldPluginState.decorations.map(
                  transaction.mapping,
                  transaction.doc,
                ),
                hasDecorations: oldPluginState.hasDecorations,
                terms,
                matcherIndex,
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
          view(view) {
            let rebuildTimeout: ReturnType<typeof setTimeout> | null = null;

            const clearRebuildTimeout = () => {
              if (rebuildTimeout) {
                clearTimeout(rebuildTimeout);
                rebuildTimeout = null;
              }
            };

            const scheduleRebuild = () => {
              clearRebuildTimeout();
              rebuildTimeout = setTimeout(() => {
                rebuildTimeout = null;
                const pluginState = dictionaryHighlightPluginKey.getState(
                  view.state,
                );

                if (!pluginState?.enabled) {
                  return;
                }

                view.dispatch(
                  view.state.tr.setMeta(dictionaryHighlightPluginKey, {
                    enabled: pluginState.enabled,
                    terms: pluginState.terms,
                    matcherIndex: pluginState.matcherIndex,
                    rebuild: true,
                  } satisfies DictionaryHighlightPluginMeta),
                );
              }, DICTIONARY_HIGHLIGHT_REBUILD_DELAY_MS);
            };

            return {
              update(nextView, previousState) {
                const pluginState = dictionaryHighlightPluginKey.getState(
                  nextView.state,
                );

                if (
                  previousState.doc !== nextView.state.doc &&
                  pluginState?.enabled &&
                  pluginState.matcherIndex.patterns.length > 0
                ) {
                  scheduleRebuild();
                }
              },
              destroy() {
                clearRebuildTimeout();
              },
            };
          },
        }),
      ];
    },
  });

function getDictionaryHighlightMeta(
  transaction: Transaction,
): DictionaryHighlightPluginMeta | null {
  return (
    transaction.getMeta(dictionaryHighlightPluginKey) ??
    transaction.getMeta("dictionaryHighlight") ??
    null
  );
}

function buildPluginState(
  doc: PMNode,
  options: DictionaryHighlightOptions,
): DictionaryHighlightPluginState {
  const matcherIndex =
    options.matcherIndex ?? createDictionaryMatcherIndex(options.terms);

  if (!options.enabled || matcherIndex.patterns.length === 0) {
    return {
      decorations: DecorationSet.empty,
      hasDecorations: false,
      terms: options.terms,
      matcherIndex,
      enabled: options.enabled,
    };
  }

  const decorationResult = buildDecorations(doc, matcherIndex);

  return {
    decorations: decorationResult.decorations,
    hasDecorations: decorationResult.hasDecorations,
    terms: options.terms,
    matcherIndex,
    enabled: options.enabled,
  };
}

function buildDecorations(
  doc: PMNode,
  matcherIndex: DictionaryMatcherIndex,
): DictionaryDecorationResult {
  const decorations: Decoration[] = [];

  collectTextNodes(doc).forEach((textNode) => {
    findDictionaryMatches(textNode.text, matcherIndex).forEach((match) => {
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

  return {
    decorations: DecorationSet.create(doc, decorations),
    hasDecorations: decorations.length > 0,
  };
}
