// @vitest-environment jsdom

import { Editor, Node } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchAndReplace } from './search-and-replace';

const editors: Editor[] = [];
function createEditor() {
  const editor = new Editor({
    extensions: [
      Node.create({ name: 'doc', topNode: true, content: 'paragraph+' }),
      Node.create({
        name: 'paragraph',
        content: 'text*',
        renderHTML: () => ['p', 0],
      }),
      Node.create({ name: 'text', group: 'inline' }),
      SearchAndReplace,
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Alpha Alpha' }] },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.useRealTimers();
});

describe('search extension lifecycle', () => {
  it('can finish an old transaction after editor storage has been released', () => {
    const editor = createEditor();
    editor.commands.setSearchTerm('Alpha');
    const state = editor.state;
    editor.destroy();
    expect(() => state.apply(state.tr.insertText('!'))).not.toThrow();
  });

  it('keeps plugin storage stable during teardown and separate from a new editor', () => {
    const previous = createEditor();
    previous.commands.setSearchTerm('Alpha');
    const state = previous.state;
    delete previous.storage.searchAndReplace;
    expect(() => previous.commands.resetIndex()).not.toThrow();
    const next = createEditor();
    expect(() => state.apply(state.tr.insertText('!'))).not.toThrow();
    expect(next.storage.searchAndReplace.searchTerm).toBe('');
    expect(next.storage.searchAndReplace.results).toEqual([]);
  });

  it('does not run deferred replacement work on a destroyed editor', () => {
    vi.useFakeTimers();
    const editor = createEditor();
    editor.commands.setSearchTerm('Alpha');
    editor.commands.setReplaceTerm('Beta');
    editor.commands.replace();
    editor.destroy();
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});
