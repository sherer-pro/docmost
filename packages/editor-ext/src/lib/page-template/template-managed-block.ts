import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

export interface TemplateManagedBlockOptions {
  view: any;
}

export interface TemplateManagedBlockAttributes {
  templateBlockId?: string | null;
  locked?: boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    templateManagedBlock: {
      insertTemplateManagedBlock: (
        attributes?: TemplateManagedBlockAttributes,
      ) => ReturnType;
    };
  }
}

export const TemplateManagedBlock = Node.create<TemplateManagedBlockOptions>({
  name: 'templateManagedBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addOptions() {
    return { view: null };
  },

  addAttributes() {
    return {
      templateBlockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-template-block-id'),
        renderHTML: (attributes) =>
          attributes.templateBlockId
            ? { 'data-template-block-id': attributes.templateBlockId }
            : {},
      },
      locked: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute('data-template-locked') === 'true',
        renderHTML: (attributes) =>
          attributes.locked
            ? { 'data-template-locked': 'true', contenteditable: 'false' }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="templateManagedBlock"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'templateManagedBlock' },
        HTMLAttributes,
      ),
      0,
    ];
  },

  addCommands() {
    return {
      insertTemplateManagedBlock:
        (attributes = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              templateBlockId:
                attributes.templateBlockId ?? createTemplateNodeId(),
              locked: attributes.locked ?? false,
            },
            content: [{ type: 'paragraph' }],
          }),
    };
  },

  addNodeView() {
    if (!this.options.view) return null;
    return ReactNodeViewRenderer(this.options.view);
  },
});

function createTemplateNodeId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
