import {
  Extension,
  findChildrenInRange,
  getChangedRanges,
  type ChangedRange,
  type NodeWithPos,
} from "@tiptap/core";
import { EditorState, Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
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
  scannedTextBlockCount: number;
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
  scannedTextBlockCount: number;
}

interface DictionaryDecorationBatch {
  decorations: Decoration[];
  scannedTextBlockCount: number;
}

const FULL_REBUILD_MIN_CHANGED_SIZE = 5_000;
const FULL_REBUILD_CHANGED_RATIO = 0.5;
const EXCLUDED_INLINE_MARK_NAMES = new Set(["code", "link"]);

export const dictionaryHighlightPluginKey =
  new PluginKey<DictionaryHighlightPluginState>("dictionaryHighlight");

function collectTextNodes(
  node: PMNode,
  basePosition = 0,
): TextNodesWithPosition[] {
  const textNodesWithPosition: TextNodesWithPosition[] = [];
  let index = 0;

  node.descendants((child, pos) => {
    if (child.isText) {
      if (
        child.marks.some((mark) =>
          EXCLUDED_INLINE_MARK_NAMES.has(mark.type.name),
        )
      ) {
        index += 1;
        return;
      }

      if (textNodesWithPosition[index]) {
        textNodesWithPosition[index] = {
          text: textNodesWithPosition[index].text + child.text,
          pos: textNodesWithPosition[index].pos,
        };
      } else {
        textNodesWithPosition[index] = {
          text: `${child.text}`,
          pos: basePosition + pos,
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
                  scannedTextBlockCount: 0,
                };
              }

              if (meta) {
                return buildPluginState(newState.doc, {
                  enabled,
                  terms,
                  matcherIndex,
                });
              }

              if (transaction.docChanged) {
                if (oldState.doc.textContent.length === 0) {
                  return buildPluginState(newState.doc, {
                    enabled,
                    terms,
                    matcherIndex,
                  });
                }

                return updateChangedDecorations(
                  transaction,
                  oldPluginState,
                  newState,
                  { enabled, terms, matcherIndex },
                );
              }

              return oldPluginState;
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
      scannedTextBlockCount: 0,
    };
  }

  const decorationResult = buildDecorations(doc, matcherIndex);

  return {
    decorations: decorationResult.decorations,
    hasDecorations: decorationResult.hasDecorations,
    terms: options.terms,
    matcherIndex,
    enabled: options.enabled,
    scannedTextBlockCount: decorationResult.scannedTextBlockCount,
  };
}

function buildDecorations(
  doc: PMNode,
  matcherIndex: DictionaryMatcherIndex,
): DictionaryDecorationResult {
  const textBlocks = collectTextBlocks(doc);
  const result = buildDecorationsForTextBlocks(doc, textBlocks, matcherIndex);

  return {
    decorations: DecorationSet.create(doc, result.decorations),
    hasDecorations: result.decorations.length > 0,
    scannedTextBlockCount: result.scannedTextBlockCount,
  };
}

function buildDecorationsForTextBlocks(
  doc: PMNode,
  textBlocks: NodeWithPos[],
  matcherIndex: DictionaryMatcherIndex,
): DictionaryDecorationBatch {
  const decorations: Decoration[] = [];

  textBlocks.forEach(({ node, pos }) => {
    collectTextNodes(node, pos + 1).forEach((textNode) => {
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
            "aria-description": match.term.definitionMarkdown,
            role: "button",
            tabindex: "0",
          }),
        );
      });
    });
  });

  return {
    decorations,
    scannedTextBlockCount: textBlocks.length,
  };
}

function collectTextBlocks(doc: PMNode): NodeWithPos[] {
  const textBlocks: NodeWithPos[] = [];

  doc.descendants((node, pos) => {
    if (isHighlightableTextBlock(node)) {
      textBlocks.push({ node, pos });
      return false;
    }

    if (node.isTextblock) {
      return false;
    }

    return true;
  });

  return textBlocks;
}

function isHighlightableTextBlock(node: PMNode): boolean {
  return node.isTextblock;
}

function collectChangedTextBlocks(
  doc: PMNode,
  changedRanges: ChangedRange[],
): NodeWithPos[] {
  const textBlocks = new Map<number, NodeWithPos>();
  const addTextBlock = (textBlock: NodeWithPos) => {
    textBlocks.set(textBlock.pos, textBlock);
  };

  changedRanges.forEach(({ newRange }) => {
    const from = Math.max(0, Math.min(newRange.from - 1, doc.content.size));
    const to = Math.max(from, Math.min(newRange.to + 1, doc.content.size));

    findChildrenInRange(doc, { from, to }, isHighlightableTextBlock).forEach(
      addTextBlock,
    );

    [from, to].forEach((position) => {
      const resolvedPosition = doc.resolve(position);

      for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
        const node = resolvedPosition.node(depth);

        if (isHighlightableTextBlock(node)) {
          addTextBlock({ node, pos: resolvedPosition.before(depth) });
          break;
        }
      }
    });
  });

  return Array.from(textBlocks.values()).sort(
    (left, right) => left.pos - right.pos,
  );
}

function shouldRebuildAllDecorations(
  doc: PMNode,
  changedRanges: ChangedRange[],
): boolean {
  if (changedRanges.length === 0) {
    return true;
  }

  const changedSize = changedRanges.reduce(
    (total, { newRange }) => total + Math.max(1, newRange.to - newRange.from),
    0,
  );

  return (
    changedSize >= FULL_REBUILD_MIN_CHANGED_SIZE &&
    changedSize >= doc.content.size * FULL_REBUILD_CHANGED_RATIO
  );
}

function updateChangedDecorations(
  transaction: Transaction,
  oldPluginState: DictionaryHighlightPluginState,
  newState: EditorState,
  options: DictionaryHighlightOptions & {
    matcherIndex: DictionaryMatcherIndex;
  },
): DictionaryHighlightPluginState {
  const changedRanges = getChangedRanges(transaction);

  if (shouldRebuildAllDecorations(newState.doc, changedRanges)) {
    return buildPluginState(newState.doc, options);
  }

  const changedTextBlocks = collectChangedTextBlocks(
    newState.doc,
    changedRanges,
  );

  if (changedTextBlocks.length === 0) {
    return buildPluginState(newState.doc, options);
  }

  const mappedDecorations = oldPluginState.decorations.map(
    transaction.mapping,
    newState.doc,
  );
  const decorationsToRemove = changedTextBlocks.flatMap(({ node, pos }) =>
    mappedDecorations.find(pos, pos + node.nodeSize),
  );
  const retainedDecorations = mappedDecorations.remove(decorationsToRemove);
  const rebuiltDecorations = buildDecorationsForTextBlocks(
    newState.doc,
    changedTextBlocks,
    options.matcherIndex,
  );
  const decorations = retainedDecorations.add(
    newState.doc,
    rebuiltDecorations.decorations,
  );

  return {
    decorations,
    hasDecorations: decorations.find().length > 0,
    terms: options.terms,
    matcherIndex: options.matcherIndex,
    enabled: options.enabled,
    scannedTextBlockCount: rebuiltDecorations.scannedTextBlockCount,
  };
}

export function getDictionaryHighlightScanCount(state: EditorState): number {
  return (
    dictionaryHighlightPluginKey.getState(state)?.scannedTextBlockCount ?? 0
  );
}
