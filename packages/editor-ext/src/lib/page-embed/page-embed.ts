import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { getPageEmbedPresentationAttributes } from './page-embed-presentation';

export interface PageEmbedOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}

export interface PageEmbedAttributes {
  id?: string | null;
  sourcePageId?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageEmbed: {
      insertPageEmbed: (attributes: PageEmbedAttributes) => ReturnType;
    };
  }
}

/**
 * A live, read-only whole-page reference.
 *
 * Only identifiers are persisted in the consumer document. Source metadata and
 * content are resolved at read time so revoked access never leaves a fallback
 * copy in the ProseMirror document.
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

  addCommands() {
    return {
      insertPageEmbed:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: attributes,
          }),
    };
  },

  addNodeView() {
    if (!this.options.view) return null;
    this.editor.isInitialized = true;
    return ReactNodeViewRenderer(this.options.view);
  },
});
