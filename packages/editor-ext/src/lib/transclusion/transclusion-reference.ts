import { mergeAttributes, Node } from '@tiptap/core';
import { getTransclusionPresentationAttributes } from './transclusion-presentation';
import { isValidTransclusionIdentifier } from './constants';

export interface TransclusionReferenceOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
  getContentExtensions?: () => any[];
}

export interface TransclusionReferenceAttributes {
  sourcePageId?: string | null;
  transclusionId?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    transclusionReference: {
      insertTransclusionReference: (
        attributes: TransclusionReferenceAttributes,
      ) => ReturnType;
    };
  }
}

export const TransclusionReference = Node.create<TransclusionReferenceOptions>({
  name: 'transclusionReference',

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
      getContentExtensions: undefined,
    };
  },

  group: 'block',
  atom: true,
  selectable: true,
  // The reference renders read-only text. Keeping the atom permanently
  // draggable makes browsers start a node drag instead of text selection.
  // The editor's global drag handle still provides explicit block movement.
  draggable: false,

  addAttributes() {
    return {
      sourcePageId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-source-page-id'),
        renderHTML: (attrs) =>
          attrs.sourcePageId
            ? { 'data-source-page-id': attrs.sourcePageId }
            : {},
      },
      transclusionId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-transclusion-id'),
        renderHTML: (attrs) =>
          attrs.transclusionId
            ? { 'data-transclusion-id': attrs.transclusionId }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${this.name}"]`,
        getAttrs: (element) =>
          isValidTransclusionIdentifier(
            element.getAttribute('data-source-page-id'),
          ) &&
          isValidTransclusionIdentifier(
            element.getAttribute('data-transclusion-id'),
          )
            ? null
            : false,
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
    ];
  },

  addCommands() {
    return {
      insertTransclusionReference:
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
    return this.options.view;
  },
});
