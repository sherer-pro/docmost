import {
  getText,
  getTextSerializersFromSchema,
  mergeAttributes,
  Node,
  type JSONContent,
} from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { generateNodeId } from './utils';

export function assertTabStructure(document: JSONContent): void {
  const stack = [{ node: document, inTabs: false, parent: '' }];
  while (stack.length) {
    const { node, inTabs, parent } = stack.pop()!;
    if (node.type === 'tabs') {
      if (inTabs) throw new Error('Nested tabs are not supported');
      if (
        !node.content?.length ||
        node.content.some((child) => child.type !== 'tabItem')
      ) {
        throw new Error('A tabs block must contain tab items');
      }
    }
    if (node.type === 'tabItem' && parent !== 'tabs') {
      throw new Error('A tab item must belong to a tabs block');
    }
    for (const child of node.content ?? []) {
      stack.push({
        node: child,
        inTabs: inTabs || node.type === 'tabs',
        parent: node.type ?? '',
      });
    }
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tabs: { insertTabs: (titles?: [string, string]) => ReturnType };
  }
}

export const Tabs = Node.create<{ view: any }>({
  name: 'tabs',
  group: 'block',
  content: 'tabItem+',
  defining: true,
  isolating: true,
  addOptions() {
    return { view: null };
  },
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-tabs-id'),
        renderHTML: (attrs) => ({ 'data-tabs-id': attrs.id }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="tabs"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'tabs' }), 0];
  },
  addNodeView() {
    return this.options.view;
  },
  addCommands() {
    return {
      insertTabs:
        (titles = ['Tab 1', 'Tab 2']) =>
        ({ state, commands }) => {
          for (let depth = state.selection.$from.depth; depth > 0; depth--) {
            if (state.selection.$from.node(depth).type.name === 'tabs')
              return false;
          }
          return commands.insertContent({
            type: 'tabs',
            attrs: { id: generateNodeId() },
            content: titles.map((title) => ({
              type: 'tabItem',
              attrs: { id: generateNodeId(), title: title.slice(0, 200) },
              content: [{ type: 'paragraph' }],
            })),
          });
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction(transaction) {
          if (!transaction.docChanged) return true;
          try {
            assertTabStructure(transaction.doc.toJSON());
            return true;
          } catch {
            return false;
          }
        },
      }),
    ];
  },
});

export const TabItem = Node.create({
  name: 'tabItem',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-tab-id'),
        renderHTML: (attrs) => ({ 'data-tab-id': attrs.id }),
      },
      title: {
        default: 'Tab',
        parseHTML: (element) => element.getAttribute('data-tab-title') ?? 'Tab',
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'section[data-type="tabItem"]',
        contentElement: 'div[data-tab-body]',
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'tabItem',
        'data-tab-title': node.attrs.title,
      }),
      [
        'h3',
        { 'data-tab-heading': '', id: node.attrs.id },
        typeof node.attrs.title === 'string' ? node.attrs.title : 'Tab',
      ],
      ['div', { 'data-tab-body': '' }, 0],
    ];
  },
  renderText({ node }) {
    return `\n${typeof node.attrs.title === 'string' ? node.attrs.title : 'Tab'}\n${getText(node, { blockSeparator: '\n', textSerializers: getTextSerializersFromSchema(node.type.schema) })}\n`;
  },
});
