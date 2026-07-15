import { Extension, JSONContent } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
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
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingNumbering: {
      setHeadingNumberingEnabled: (enabled: boolean) => ReturnType;
      removeManualHeadingNumbering: () => ReturnType;
    };
  }
}

export const headingNumberingPluginKey = new PluginKey<boolean>(
  'headingNumbering',
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

/*
 * Multi-level prefixes may omit both the final dot and whitespace. A single number
 * still needs a dot or whitespace to avoid stripping titles such as "2024Roadmap".
 */
const MANUAL_HEADING_NUMBERING_PATTERN =
  /^(?:\d+(?:\.\d+){1,2}(?!\.\d)\.?\s*|\d+(?:\.(?!\d)\s*|\s+))/;

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

export const HeadingNumbering = Extension.create<HeadingNumberingOptions>({
  name: 'headingNumbering',

  addOptions() {
    return {
      enabled: false,
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
    ];
  },
});
