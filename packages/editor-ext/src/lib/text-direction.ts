import { Extension } from '@tiptap/core';

export type TextDirectionValue = 'auto' | 'ltr' | 'rtl';
export const BLOCK_DIRECTION_EXPORT_STYLES = `
li[dir="auto"]:has(> p:first-child:dir(rtl)),
li[dir="auto"]:has(> div > p:first-child:dir(rtl)) { direction: rtl; }
th { text-align: start; }
`;
export const textDirectionValue = (value: unknown): TextDirectionValue =>
  value === 'ltr' || value === 'rtl' ? value : 'auto';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockTextDirection: {
      setBlockTextDirection: (direction: TextDirectionValue) => ReturnType;
    };
  }
}

export const TextDirection = Extension.create({
  name: 'blockTextDirection',
  addOptions() {
    return {
      types: [
        'paragraph',
        'heading',
        'listItem',
        'taskItem',
        'tableCell',
        'tableHeader',
        'detailsSummary',
      ],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          dir: {
            default: null,
            parseHTML: (element) =>
              textDirectionValue(element.getAttribute('dir')),
            renderHTML: (attrs) => ({ dir: textDirectionValue(attrs.dir) }),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setBlockTextDirection:
        (direction) =>
        ({ tr, dispatch }) => {
          if (!['auto', 'ltr', 'rtl'].includes(direction)) return false;
          let found = false;
          tr.doc.nodesBetween(
            tr.selection.from,
            tr.selection.to,
            (node, position) => {
              if (!this.options.types.includes(node.type.name)) return;
              found = true;
              if (dispatch)
                tr.setNodeMarkup(position, undefined, {
                  ...node.attrs,
                  dir: direction,
                });
            },
          );
          return found;
        },
    };
  },
});
