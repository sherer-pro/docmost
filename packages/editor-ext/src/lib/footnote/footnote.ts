import { mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { generateNodeId } from '../utils';

export const FOOTNOTE_TEXT_LIMIT = 10000;
export const footnoteText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\u0000/g, '') : '';
export function footnoteNodeText(node: any): string {
  const children = Array.isArray(node?.content)
    ? node.content
        .map((child: any) => (child.type === 'text' ? (child.text ?? '') : ''))
        .join('')
    : '';
  return footnoteText(node?.textContent || children || node?.attrs?.text);
}
export interface FootnoteEntry {
  id: string;
  position: number;
  number: number;
  text: string;
}
export function collectFootnotes(doc: ProseMirrorNode): FootnoteEntry[] {
  const entries: FootnoteEntry[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== 'footnote') return;
    entries.push({
      id:
        typeof node.attrs.id === 'string'
          ? node.attrs.id
          : `position-${position}`,
      position,
      number: entries.length + 1,
      text: footnoteNodeText(node),
    });
  });
  return entries;
}
export const footnotePluginKey = new PluginKey<{
  entries: FootnoteEntry[];
  byPosition: Map<number, FootnoteEntry>;
}>('docmostFootnotes');
const footnoteState = (doc: ProseMirrorNode) => {
  const entries = collectFootnotes(doc);
  return {
    entries,
    byPosition: new Map(entries.map((entry) => [entry.position, entry])),
  };
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: { insertFootnote: (text?: string) => ReturnType };
  }
}

export const Footnote = Node.create<{ view: any }>({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  content: 'text*',
  marks: '',
  addOptions() {
    return { view: null };
  },
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-footnote-id'),
        renderHTML: (attrs) => ({ 'data-footnote-id': attrs.id }),
      },
      text: {
        default: '',
        parseHTML: () => '',
        renderHTML: (attrs) => ({
          'data-footnote-text': footnoteText(attrs.text),
        }),
      },
      number: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
      exportPrefix: {
        default: '',
        parseHTML: () => '',
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'sup[data-type="footnote"]',
        getContent: (element, schema) => {
          const text = footnoteText(
            (element as HTMLElement).getAttribute('data-footnote-text'),
          );
          return text ? Fragment.from(schema.text(text)) : Fragment.empty;
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const number =
      Number.isSafeInteger(node.attrs.number) && node.attrs.number > 0
        ? node.attrs.number
        : null;
    const prefix =
      typeof node.attrs.exportPrefix === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(node.attrs.exportPrefix)
        ? `${node.attrs.exportPrefix}-`
        : '';
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'footnote',
        title: footnoteNodeText(node),
        'data-footnote-text': footnoteNodeText(node),
      }),
      [
        'a',
        number
          ? { id: `${prefix}fnref-${number}`, href: `#${prefix}fn-${number}` }
          : { href: '#' },
        number ? String(number) : '*',
      ],
    ];
  },
  renderText({ node }) {
    return ` [${footnoteNodeText(node)}] `;
  },
  addNodeView() {
    if (this.options.view) {
      this.editor.isInitialized = true;
      return this.options.view;
    }
  },
  addCommands() {
    return {
      insertFootnote:
        (text = '') =>
        ({ commands }) =>
          footnoteText(text).length <= FOOTNOTE_TEXT_LIMIT &&
          commands.insertContent({
            type: this.name,
            attrs: { id: generateNodeId() },
            content: text ? [{ type: 'text', text: footnoteText(text) }] : [],
          }),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: footnotePluginKey,
        state: {
          init: (_, state) => footnoteState(state.doc),
          apply: (transaction, previous) =>
            transaction.docChanged ? footnoteState(transaction.doc) : previous,
        },
      }),
    ];
  },
});
