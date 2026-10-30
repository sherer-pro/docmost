// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, it, expect } from 'vitest';
import { Footnote, collectFootnotes } from './footnote';
import { SearchAndReplace } from '../search-and-replace/search-and-replace';

describe('search in footnotes', () => {
  it('keeps positions correct across an inline note and trailing paragraph text', () => {
    const editor = new Editor({
      extensions: [StarterKit, Footnote, SearchAndReplace],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Before ' },
              {
                type: 'footnote',
                attrs: { id: 'note' },
                content: [{ type: 'text', text: 'needle' }],
              },
              { type: 'text', text: 'needle after' },
            ],
          },
        ],
      },
    });
    try {
      editor.commands.setSearchTerm('needle');
      expect(editor.storage.searchAndReplace.results).toHaveLength(2);
      for (const match of editor.storage.searchAndReplace.results)
        expect(editor.state.doc.textBetween(match.from, match.to)).toBe(
          'needle',
        );
      editor.commands.setReplaceTerm('changed');
      editor.commands.replaceAll();
      expect(collectFootnotes(editor.state.doc)[0].text).toBe('changed');
      expect(editor.state.doc.lastChild?.lastChild?.text).toBe('changed after');
      editor.commands.undo();
      expect(collectFootnotes(editor.state.doc)[0].text).toBe('needle');
    } finally {
      editor.destroy();
    }
  });
});
