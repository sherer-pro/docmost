import { mergeAttributes, Node } from '@tiptap/core';

export interface TemplateFieldOptions {
  view: any;
}

export interface TemplateFieldAttributes {
  fieldId?: string | null;
  label?: string | null;
  placeholder?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    templateField: {
      insertTemplateField: (attributes?: TemplateFieldAttributes) => ReturnType;
      convertTemplateManagedBlockToField: (
        attributes?: TemplateFieldAttributes,
      ) => ReturnType;
      convertTemplateFieldToManagedBlock: () => ReturnType;
    };
  }
}

export const TemplateField = Node.create<TemplateFieldOptions>({
  name: 'templateField',
  group: 'block',
  content: 'block*',
  defining: true,
  isolating: true,

  addOptions() {
    return { view: null };
  },

  addAttributes() {
    return {
      fieldId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-template-field-id'),
        renderHTML: (attributes) =>
          attributes.fieldId
            ? { 'data-template-field-id': attributes.fieldId }
            : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-template-label'),
        renderHTML: (attributes) =>
          attributes.label ? { 'data-template-label': attributes.label } : {},
      },
      placeholder: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-template-placeholder'),
        renderHTML: (attributes) =>
          attributes.placeholder
            ? { 'data-template-placeholder': attributes.placeholder }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="templateField"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-type': 'templateField' }, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      insertTemplateField:
        (attributes = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              fieldId: attributes.fieldId ?? createTemplateFieldId(),
              label: attributes.label ?? null,
              placeholder: attributes.placeholder ?? null,
            },
            content: [{ type: 'paragraph' }],
          }),
      convertTemplateManagedBlockToField:
        (attributes = {}) =>
        ({ state, dispatch }) => {
          const found = findAncestor(
            state.selection.$from,
            'templateManagedBlock',
          );
          if (!found) return false;
          const id =
            attributes.fieldId ??
            found.node.attrs.templateBlockId ??
            createTemplateFieldId();
          const transaction = state.tr.setNodeMarkup(
            found.pos,
            state.schema.nodes.templateField,
            {
              fieldId: id,
              label: attributes.label ?? null,
              placeholder: attributes.placeholder ?? null,
            },
          );
          const redundantEmptyBlocks: Array<{ from: number; to: number }> = [];
          state.doc.forEach((node, offset) => {
            if (
              offset !== found.pos &&
              node.type.name === 'templateManagedBlock' &&
              isEmptyManagedBlock(node)
            ) {
              redundantEmptyBlocks.push({
                from: offset,
                to: offset + node.nodeSize,
              });
            }
          });
          for (const range of redundantEmptyBlocks.reverse()) {
            transaction.delete(range.from, range.to);
          }
          dispatch?.(transaction);
          return true;
        },
      convertTemplateFieldToManagedBlock:
        () =>
        ({ state, dispatch }) => {
          const found = findAncestor(state.selection.$from, 'templateField');
          if (!found) return false;
          dispatch?.(
            state.tr.setNodeMarkup(
              found.pos,
              state.schema.nodes.templateManagedBlock,
              {
                templateBlockId:
                  found.node.attrs.fieldId ?? createTemplateFieldId(),
                locked: false,
              },
            ),
          );
          return true;
        },
    };
  },

  addNodeView() {
    if (!this.options.view) return null;
    return this.options.view;
  },
});

function findAncestor($from: any, typeName: string) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === typeName) {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
}

function isEmptyManagedBlock(node: any): boolean {
  return (
    node.childCount > 0 &&
    Array.from({ length: node.childCount }).every((_, index) => {
      const child = node.child(index);
      return child.type.name === 'paragraph' && child.content.size === 0;
    })
  );
}

function createTemplateFieldId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `field-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
