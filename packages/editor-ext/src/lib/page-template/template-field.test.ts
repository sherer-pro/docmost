// @vitest-environment happy-dom

import { Editor } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { afterEach, describe, expect, it } from 'vitest';
import { TemplateField } from './template-field';
import { TemplateManagedBlock } from './template-managed-block';

describe('template field conversions', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('preserves content and identity across both conversions', () => {
    editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        TemplateManagedBlock,
        TemplateField,
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'templateManagedBlock',
            attrs: { templateBlockId: 'section-1', locked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Keep this content' }],
              },
            ],
          },
        ],
      },
    });

    editor.commands.setTextSelection(2);
    expect(
      editor.commands.convertTemplateManagedBlockToField({
        label: 'Owner',
        placeholder: 'Enter an owner',
      }),
    ).toBe(true);
    expect(editor.getJSON().content?.[0]).toEqual({
      type: 'templateField',
      attrs: {
        fieldId: 'section-1',
        label: 'Owner',
        placeholder: 'Enter an owner',
      },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Keep this content' }],
        },
      ],
    });

    expect(editor.commands.convertTemplateFieldToManagedBlock()).toBe(true);
    expect(editor.getJSON().content?.[0]).toEqual({
      type: 'templateManagedBlock',
      attrs: { templateBlockId: 'section-1', locked: false },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Keep this content' }],
        },
      ],
    });
  });
});
