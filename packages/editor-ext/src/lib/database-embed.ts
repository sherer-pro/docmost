import { Node, mergeAttributes } from '@tiptap/core';

export const DatabaseEmbed = Node.create<{ view: any }>({
  name: 'databaseEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return { view: null };
  },
  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-database-id'),
        renderHTML: (attrs) => ({ 'data-database-id': attrs.databaseId }),
      },
      viewId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-view-id'),
        renderHTML: (attrs) => ({ 'data-view-id': attrs.viewId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="databaseEmbed"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': this.name }, HTMLAttributes)];
  },
  renderText() {
    return '';
  },
  addNodeView() {
    return this.options.view;
  },
});
