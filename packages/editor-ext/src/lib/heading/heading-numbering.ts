import { Extension, JSONContent } from '@tiptap/core';
import { Fragment, Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import { EditorState, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const HEADING_NUMBERING_LEVELS = [1, 2, 3] as const;

export interface HeadingNumberingDescriptor<T = unknown> {
  level: number;
  text: string;
  value: T;
}

export interface NumberedHeading<T = unknown>
  extends HeadingNumberingDescriptor<T> {
  number: string;
}

export interface ManualHeadingNumberingMatch {
  from: number;
  to: number;
  prefix: string;
}

export interface HeadingNumberingOptions {
  enabled: boolean;
  stripManualNumberingOnPaste: boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingNumbering: {
      setHeadingNumberingEnabled: (enabled: boolean) => ReturnType;
      setHeadingNumberingPasteCleanupEnabled: (enabled: boolean) => ReturnType;
      removeManualHeadingNumbering: () => ReturnType;
    };
  }
}

export const headingNumberingPluginKey = new PluginKey<boolean>(
  'headingNumbering',
);

export const headingNumberingPasteCleanupPluginKey = new PluginKey<boolean>(
  'headingNumberingPasteCleanup',
);

const isSupportedHeadingLevel = (level: unknown): level is 1 | 2 | 3 =>
  typeof level === 'number' &&
  HEADING_NUMBERING_LEVELS.includes(level as 1 | 2 | 3);

/**
 * Calculates hierarchical numbers from the largest heading level in the document.
 * Missing parent levels are seeded with one so a first H3 below an H1 becomes 1.1.1.
 */
export function calculateHeadingNumbers<T>(
  headings: readonly HeadingNumberingDescriptor<T>[],
): NumberedHeading<T>[] {
  const eligibleHeadings = headings.filter(
    (heading) =>
      isSupportedHeadingLevel(heading.level) && heading.text.trim().length > 0,
  );

  if (eligibleHeadings.length === 0) {
    return [];
  }

  const baseLevel = Math.min(
    ...eligibleHeadings.map((heading) => heading.level),
  );
  const counters = Array.from(
    { length: HEADING_NUMBERING_LEVELS.length },
    () => 0,
  );

  return eligibleHeadings.map((heading) => {
    const depth = heading.level - baseLevel;

    for (let index = 0; index < depth; index += 1) {
      if (counters[index] === 0) {
        counters[index] = 1;
      }
    }

    counters[depth] += 1;
    counters.fill(0, depth + 1);

    return {
      ...heading,
      number: `${counters.slice(0, depth + 1).join('.')}.`,
    };
  });
}

export function getProseMirrorHeadingNumbers(
  doc: ProseMirrorNode,
): NumberedHeading<number>[] {
  const headings: HeadingNumberingDescriptor<number>[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') {
      return;
    }

    headings.push({
      level: Number(node.attrs.level),
      text: node.textContent,
      value: pos,
    });
  });

  return calculateHeadingNumbers(headings);
}

function getJsonTextContent(node: JSONContent): string {
  if (typeof node.text === 'string') {
    return node.text;
  }

  return (node.content ?? []).map(getJsonTextContent).join('');
}

/**
 * Returns a numbered copy for export/copy operations without mutating stored content.
 */
export function addHeadingNumbersToJson(content: JSONContent): JSONContent {
  const headings: HeadingNumberingDescriptor<JSONContent>[] = [];

  const collectHeadings = (node: JSONContent) => {
    if (node.type === 'heading') {
      headings.push({
        level: Number(node.attrs?.level),
        text: getJsonTextContent(node),
        value: node,
      });
    }

    node.content?.forEach(collectHeadings);
  };

  collectHeadings(content);
  const numbersByNode = new Map(
    calculateHeadingNumbers(headings).map((heading) => [
      heading.value,
      heading.number,
    ]),
  );

  const cloneNode = (node: JSONContent): JSONContent => {
    const clonedContent = node.content?.map(cloneNode);
    const number = numbersByNode.get(node);

    return {
      ...node,
      ...(clonedContent ? { content: clonedContent } : {}),
      ...(number
        ? {
            content: [
              { type: 'text', text: `${number} ` },
              ...(clonedContent ?? []),
            ],
          }
        : {}),
    };
  };

  return cloneNode(content);
}

/**
 * Removes numbering produced by {@link addHeadingNumbersToJson} only when the
 * complete heading sequence matches the expected hierarchy. This avoids
 * treating an isolated manual heading such as "1. Introduction" as generated
 * numbering in legacy archives.
 */
export function stripGeneratedHeadingNumbersFromJson(
  content: JSONContent,
  options?: { allowSingleHeading?: boolean },
): { content: JSONContent; stripped: boolean } {
  const headings: HeadingNumberingDescriptor<JSONContent>[] = [];
  const collectHeadings = (node: JSONContent) => {
    if (node.type === 'heading') {
      headings.push({
        level: Number(node.attrs?.level),
        text: getJsonTextContent(node),
        value: node,
      });
    }
    node.content?.forEach(collectHeadings);
  };
  collectHeadings(content);

  const numbered = calculateHeadingNumbers(headings);
  if (
    numbered.length === 0 ||
    (!options?.allowSingleHeading && numbered.length < 2)
  ) {
    return { content, stripped: false };
  }

  const prefixLengths = new Map<JSONContent, number>();
  for (const heading of numbered) {
    const match = heading.text.match(
      new RegExp(`^${heading.number.replace(/\./g, '\\.')}\\s+`),
    );
    if (!match) return { content, stripped: false };
    prefixLengths.set(heading.value, match[0].length);
  }

  const stripLeadingJsonText = (
    nodes: JSONContent[],
    count: number,
  ): { nodes: JSONContent[]; remaining: number } => {
    let remaining = count;
    const result: JSONContent[] = [];
    for (const node of nodes) {
      if (remaining === 0) {
        result.push(node);
        continue;
      }
      if (typeof node.text === 'string') {
        const removeCount = Math.min(node.text.length, remaining);
        remaining -= removeCount;
        const text = node.text.slice(removeCount);
        if (text) result.push({ ...node, text });
        continue;
      }
      if (node.content?.length) {
        const nested = stripLeadingJsonText(node.content, remaining);
        remaining = nested.remaining;
        result.push({ ...node, content: nested.nodes });
        continue;
      }
      result.push(node);
    }
    return { nodes: result, remaining };
  };

  const cloneNode = (node: JSONContent): JSONContent => {
    const clonedContent = node.content?.map(cloneNode);
    const prefixLength = prefixLengths.get(node);
    if (!prefixLength || !clonedContent) {
      return {
        ...node,
        ...(clonedContent ? { content: clonedContent } : {}),
      };
    }
    const stripped = stripLeadingJsonText(clonedContent, prefixLength);
    return {
      ...node,
      content: stripped.remaining === 0 ? stripped.nodes : clonedContent,
    };
  };

  return { content: cloneNode(content), stripped: true };
}

/*
 * Multi-level prefixes may omit both the final dot and whitespace. A single number
 * still needs a dot or whitespace to avoid stripping titles such as "2024Roadmap".
 */
const MANUAL_HEADING_NUMBERING_PATTERN =
  /^(?:\d+(?:\.\d+){1,2}(?!\.\d)\.?\s*|\d+(?:\.(?!\d)\s*|\s+))/;

function removeLeadingTextCharacters(
  fragment: Fragment,
  count: number,
): { fragment: Fragment; remaining: number } {
  let remaining = count;
  const nodes: ProseMirrorNode[] = [];

  fragment.forEach((node) => {
    if (remaining === 0) {
      nodes.push(node);
      return;
    }

    if (node.isText) {
      const textLength = node.text?.length ?? 0;
      const removeCount = Math.min(textLength, remaining);
      remaining -= removeCount;

      if (removeCount < textLength) {
        nodes.push(node.cut(removeCount));
      }
      return;
    }

    if (node.content.size > 0) {
      const cleaned = removeLeadingTextCharacters(node.content, remaining);
      remaining = cleaned.remaining;
      nodes.push(node.copy(cleaned.fragment));
      return;
    }

    nodes.push(node);
  });

  return {
    fragment: Fragment.fromArray(nodes),
    remaining,
  };
}

function stripManualPrefixFromNode(node: ProseMirrorNode): ProseMirrorNode {
  const match = node.textContent.match(MANUAL_HEADING_NUMBERING_PATTERN);
  if (!match?.[0]) {
    return node;
  }

  const cleaned = removeLeadingTextCharacters(node.content, match[0].length);
  return cleaned.remaining === 0 ? node.copy(cleaned.fragment) : node;
}

function mapPastedFragment(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = [];

  fragment.forEach((node) => {
    const mappedContent =
      node.content.size > 0 ? mapPastedFragment(node.content) : node.content;
    const mappedNode =
      mappedContent === node.content ? node : node.copy(mappedContent);

    nodes.push(
      mappedNode.type.name === 'heading' &&
        isSupportedHeadingLevel(Number(mappedNode.attrs.level))
        ? stripManualPrefixFromNode(mappedNode)
        : mappedNode,
    );
  });

  return Fragment.fromArray(nodes);
}

function isPasteAtSupportedHeadingStart(state: EditorState): boolean {
  const { $from } = state.selection;

  return (
    $from.parent.type.name === 'heading' &&
    isSupportedHeadingLevel(Number($from.parent.attrs.level)) &&
    $from.parentOffset === 0
  );
}

export function stripManualHeadingNumberingFromPastedSlice(
  slice: Slice,
  state?: EditorState,
): Slice {
  let content = mapPastedFragment(slice.content);

  if (state && isPasteAtSupportedHeadingStart(state)) {
    const match = content
      .textBetween(0, content.size, '', '')
      .match(MANUAL_HEADING_NUMBERING_PATTERN);

    if (match?.[0]) {
      const cleaned = removeLeadingTextCharacters(content, match[0].length);
      if (cleaned.remaining === 0) {
        content = cleaned.fragment;
      }
    }
  }

  return content.eq(slice.content)
    ? slice
    : new Slice(content, slice.openStart, slice.openEnd);
}

export function findManualHeadingNumbering(
  doc: ProseMirrorNode,
): ManualHeadingNumberingMatch[] {
  const matches: ManualHeadingNumberingMatch[] = [];

  doc.descendants((node, pos) => {
    if (
      node.type.name !== 'heading' ||
      !isSupportedHeadingLevel(Number(node.attrs.level))
    ) {
      return;
    }

    const match = node.textContent.match(MANUAL_HEADING_NUMBERING_PATTERN);
    if (!match?.[0]) {
      return;
    }

    matches.push({
      from: pos + 1,
      to: pos + 1 + match[0].length,
      prefix: match[0],
    });
  });

  return matches;
}

export function isHeadingNumberingEnabled(state: EditorState): boolean {
  return headingNumberingPluginKey.getState(state) === true;
}

export function isHeadingNumberingPasteCleanupEnabled(
  state: EditorState,
): boolean {
  return headingNumberingPasteCleanupPluginKey.getState(state) === true;
}

export const HeadingNumbering = Extension.create<HeadingNumberingOptions>({
  name: 'headingNumbering',

  addOptions() {
    return {
      enabled: false,
      stripManualNumberingOnPaste: false,
    };
  },

  addCommands() {
    return {
      setHeadingNumberingEnabled:
        (enabled) =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setMeta(headingNumberingPluginKey, enabled));
          return true;
        },
      setHeadingNumberingPasteCleanupEnabled:
        (enabled) =>
        ({ tr, dispatch }) => {
          dispatch?.(
            tr.setMeta(headingNumberingPasteCleanupPluginKey, enabled),
          );
          return true;
        },
      removeManualHeadingNumbering:
        () =>
        ({ state, dispatch }) => {
          const matches = findManualHeadingNumbering(state.doc);
          if (matches.length === 0) {
            return false;
          }

          if (dispatch) {
            const transaction = state.tr;
            [...matches]
              .reverse()
              .forEach((match) => transaction.delete(match.from, match.to));
            dispatch(transaction);
          }

          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const initiallyEnabled = this.options.enabled;
    const initiallyCleanupPastedHeadings =
      this.options.stripManualNumberingOnPaste;

    return [
      new Plugin<boolean>({
        key: headingNumberingPluginKey,
        state: {
          init: () => initiallyEnabled,
          apply: (transaction, enabled) => {
            const nextEnabled = transaction.getMeta(headingNumberingPluginKey);
            return typeof nextEnabled === 'boolean' ? nextEnabled : enabled;
          },
        },
        props: {
          decorations(state) {
            if (!headingNumberingPluginKey.getState(state)) {
              return DecorationSet.empty;
            }

            const decorations = getProseMirrorHeadingNumbers(state.doc).map(
              (heading) =>
                Decoration.widget(
                  heading.value + 1,
                  () => {
                    const number = document.createElement('span');
                    number.className = 'heading-number';
                    number.contentEditable = 'false';
                    number.textContent = heading.number;
                    return number;
                  },
                  {
                    side: -1,
                    key: `heading-number-${heading.value}-${heading.number}`,
                  },
                ),
            );

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
      new Plugin<boolean>({
        key: headingNumberingPasteCleanupPluginKey,
        state: {
          init: () => initiallyCleanupPastedHeadings,
          apply: (transaction, enabled) => {
            const nextEnabled = transaction.getMeta(
              headingNumberingPasteCleanupPluginKey,
            );
            return typeof nextEnabled === 'boolean' ? nextEnabled : enabled;
          },
        },
        props: {
          transformPasted(slice, view) {
            if (!headingNumberingPasteCleanupPluginKey.getState(view.state)) {
              return slice;
            }

            return stripManualHeadingNumberingFromPastedSlice(
              slice,
              view.state,
            );
          },
        },
      }),
    ];
  },
});
