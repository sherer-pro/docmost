import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core';
import { builtInTagDefinitions, getTagLabel, getValidTagValue } from './utils';
import type { TagDefinition, TagValue } from './utils';

export interface TagOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
  tagDefinitions: readonly TagDefinition[];
}

export interface TagAttributes {
  value: TagValue;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tag: {
      setTag: (attributes: TagAttributes) => ReturnType;
    };
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const builtInTagPattern = builtInTagDefinitions
  .map((tag) => escapeRegex(tag.label))
  .join('|');

export const tagInputRegex = new RegExp(
  `(?:^|\\s)(::tag\\[(${builtInTagPattern})\\])$`,
  'i',
);

export const Tag = Node.create<TagOptions>({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
      tagDefinitions: builtInTagDefinitions,
    };
  },

  addStorage() {
    return {
      tagDefinitions: this.options.tagDefinitions,
    };
  },

  addAttributes() {
    return {
      value: {
        default: 'todo',
        parseHTML: (element) =>
          getValidTagValue(
            element.getAttribute('data-tag-value') || element.textContent,
          ),
        renderHTML: (attributes) => ({
          'data-tag-value': getValidTagValue(attributes.value),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const value = getValidTagValue(HTMLAttributes['data-tag-value']);

    return [
      'span',
      mergeAttributes(
        { 'data-type': this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      getTagLabel(value),
    ];
  },

  renderText({ node }) {
    return getTagLabel(node.attrs.value);
  },

  addNodeView() {
    if (!this.options.view) {
      return;
    }

    this.editor.isInitialized = true;

    return this.options.view;
  },

  addCommands() {
    return {
      setTag:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              value: getValidTagValue(attributes.value),
            },
          });
        },
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: tagInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          value: getValidTagValue(match[2]),
        }),
      }),
    ];
  },
});
