import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { getPageEmbedPresentationAttributes } from './page-embed-presentation';

export interface PageEmbedOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}

/**
 * Compatibility-only node used while legacy whole-page references are
 * materialized during server startup.
 *
 * It intentionally exposes no editor command or client NodeView, so new
 * references cannot be created.
 */
export const PageEmbed = Node.create<PageEmbedOptions>({
  name: 'pageEmbed',

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
    };
  },

  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) =>
          attributes.id ? { 'data-id': attributes.id } : {},
      },
      sourcePageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-page-id'),
        renderHTML: (attributes) =>
          attributes.sourcePageId
            ? { 'data-source-page-id': attributes.sourcePageId }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[data-type="${this.name}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        {
          'data-type': this.name,
          ...getPageEmbedPresentationAttributes(),
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
    ];
  },

  addNodeView() {
    if (!this.options.view) return null;
    this.editor.isInitialized = true;
    return ReactNodeViewRenderer(this.options.view);
  },
});
