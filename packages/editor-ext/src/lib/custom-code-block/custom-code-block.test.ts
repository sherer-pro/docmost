// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import { Comment } from '../comment/comment';
import { TrailingNode } from '../trailing-node';
import { CustomCodeBlock } from './custom-code-block';

const TestCodeBlock = CustomCodeBlock.extend({
  addNodeView() {
    return undefined as any;
  },
  addProseMirrorPlugins() {
    return [];
  },
});

function createEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false, trailingNode: false }),
      Comment,
      TestCodeBlock.configure({ lowlight: {} }),
      TrailingNode,
    ],
  });
}

function type(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    let handled = false;

    editor.view.someProp('handleTextInput', (handler) => {
      handled =
        handler(editor.view, from, to, character, () =>
          editor.state.tr.insertText(character, from, to),
        ) === true;
      return handled;
    });

    if (!handled) {
      editor.commands.insertContent(character);
    }
  }
}

function pressEnter(editor: Editor) {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });

  return editor.view.someProp('handleKeyDown', (handler) =>
    handler(editor.view, event),
  );
}

describe('CustomCodeBlock fenced input', () => {
  it('exits a multiline code block after a closing backtick fence', () => {
    const editor = createEditor();

    try {
      type(editor, '``` ');
      expect(editor.isActive('codeBlock')).toBe(true);

      type(editor, 'code here');
      expect(pressEnter(editor)).toBe(true);
      type(editor, '```');

      expect(pressEnter(editor)).toBe(true);
      expect(editor.getJSON()).toEqual({
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: {
              language: null,
              widthMode: 'normal',
            },
            content: [{ type: 'text', text: 'code here\n' }],
          },
          { type: 'paragraph' },
        ],
      });
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    } finally {
      editor.destroy();
    }
  });

  it('keeps the existing triple-enter exit shortcut', () => {
    const editor = createEditor();

    try {
      type(editor, '``` ');
      type(editor, 'code here');

      expect(pressEnter(editor)).toBe(true);
      expect(pressEnter(editor)).toBe(true);
      expect(pressEnter(editor)).toBe(true);

      const nodeTypes =
        editor.getJSON().content?.map((node) => node.type) ?? [];
      expect(nodeTypes[0]).toBe('codeBlock');
      expect(nodeTypes.slice(1).every((node) => node === 'paragraph')).toBe(
        true,
      );
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    } finally {
      editor.destroy();
    }
  });
});
