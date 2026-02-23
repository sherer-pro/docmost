import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    quoteEmbed: {
      setQuoteEmbed: (attrs: { sourcePageId: string; quoteId: string }) => ReturnType;
    };
  }
}

/**
 * Блочный узел встраиваемой цитаты.
 *
 * Отображение и синхронизация контента происходят на клиентском node-view.
 */
export const QuoteEmbed = Node.create({
  name: 'quoteEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      sourcePageId: {
        default: null,
      },
      quoteId: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="quote-embed"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'quote-embed',
      }),
    ];
  },

  addCommands() {
    return {
      setQuoteEmbed:
        (attrs) =>
        ({ commands }) => {
          if (!attrs?.sourcePageId || !attrs?.quoteId) {
            return false;
          }

          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },

  addNodeView() {
    if (!this.options.view) {
      return;
    }

    // Force immediate rendering for React node-views.
    this.editor.isInitialized = true;

    return ReactNodeViewRenderer(this.options.view);
  },
});
