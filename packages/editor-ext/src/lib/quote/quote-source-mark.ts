import { Mark } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    quoteSource: {
      setQuoteSource: (quoteId: string) => ReturnType;
      unsetQuoteSource: (quoteId: string) => ReturnType;
    };
  }
}

/**
 * Маркер источника цитаты.
 *
 * Хранит идентификатор выделенного фрагмента, который может быть
 * встроен в другой документ через отдельный блочный узел.
 */
export const QuoteSourceMark = Mark.create({
  name: 'quoteSource',

  addAttributes() {
    return {
      quoteId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-quote-id'),
        renderHTML: (attributes) => {
          if (!attributes.quoteId) {
            return {};
          }

          return {
            'data-quote-id': attributes.quoteId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-quote-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        ...HTMLAttributes,
        class: 'quote-source-mark',
      },
      0,
    ];
  },

  addCommands() {
    return {
      setQuoteSource:
        (quoteId: string) =>
        ({ commands }) => {
          if (!quoteId) {
            return false;
          }

          return commands.setMark(this.name, { quoteId });
        },
      unsetQuoteSource:
        (quoteId: string) =>
        ({ state, tr, dispatch }) => {
          if (!quoteId) {
            return false;
          }

          const { doc } = state;
          let hasRemoved = false;

          doc.descendants((node, pos) => {
            if (!node.isText || !node.marks?.length) {
              return;
            }

            node.marks.forEach((mark) => {
              if (mark.type.name !== this.name || mark.attrs.quoteId !== quoteId) {
                return;
              }

              tr.removeMark(pos, pos + node.nodeSize, mark);
              hasRemoved = true;
            });
          });

          if (!hasRemoved) {
            return false;
          }

          dispatch?.(tr);
          return true;
        },
    };
  },
});
