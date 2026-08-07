import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TRANSCLUSION_SOURCE_CONTENT_EXPRESSION } from './constants';
import {
  getTransclusionPresentationAttributes,
  TRANSCLUSION_CONTENT_ATTRIBUTE,
} from './transclusion-presentation';

export interface TransclusionSourceOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}

export interface TransclusionSourceAttributes {
  id?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    transclusionSource: {
      insertTransclusionSource: (
        attributes?: TransclusionSourceAttributes,
      ) => ReturnType;
      toggleTransclusionSource: () => ReturnType;
      unsyncTransclusionSource: () => ReturnType;
    };
  }
}

export const TransclusionSource = Node.create<TransclusionSourceOptions>({
  name: 'transclusionSource',

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
    };
  },

  group: 'block',
  // Schema-enforced allow-list. Excludes `transclusionSource` (no nesting)
  content: TRANSCLUSION_SOURCE_CONTENT_EXPRESSION,
  defining: true,
  isolating: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${this.name}"]`,
        contentElement: (element) => {
          const htmlElement = element as HTMLElement;
          return (
            htmlElement.querySelector<HTMLElement>(
              `[${TRANSCLUSION_CONTENT_ATTRIBUTE}]`,
            ) ?? htmlElement
          );
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        {
          'data-type': this.name,
          ...getTransclusionPresentationAttributes(),
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      ['div', { [TRANSCLUSION_CONTENT_ATTRIBUTE]: '' }, 0],
    ];
  },

  addCommands() {
    return {
      insertTransclusionSource:
        (attributes) =>
        ({ commands, state, chain }) => {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === this.name) return false;
          }

          const node = {
            type: this.name,
            attrs: attributes ?? {},
            content: [{ type: 'paragraph' }],
          };

          const parent = $from.parent;
          const isEmptyParagraph =
            parent.type.name === 'paragraph' && parent.content.size === 0;

          if (isEmptyParagraph) {
            return chain()
              .insertContentAt(
                { from: $from.before(), to: $from.after() },
                node,
              )
              .run();
          }

          return commands.insertContent(node);
        },
      toggleTransclusionSource:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
      unsyncTransclusionSource:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          // Walk up to the nearest source wrapper.
          let depth = $from.depth;
          while (depth > 0 && $from.node(depth).type.name !== this.name) {
            depth -= 1;
          }
          if (depth === 0) return false;

          const node = $from.node(depth);
          const start = $from.before(depth);
          const end = start + node.nodeSize;

          if (dispatch) {
            tr.replaceWith(start, end, node.content);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addNodeView() {
    if (!this.options.view) return null;
    return ReactNodeViewRenderer(this.options.view);
  },
});
