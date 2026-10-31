// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor, generateText } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Tabs, TabItem, assertTabStructure } from './tabs';
import { Footnote } from './footnote';
import { htmlToMarkdown } from './markdown/utils/turndown.utils';
import { SearchAndReplace } from './search-and-replace/search-and-replace';

const extensions = [StarterKit, Tabs, TabItem, Footnote, SearchAndReplace];
const document = {
  type: 'doc',
  content: [
    {
      type: 'tabs',
      attrs: { id: 'tabs' },
      content: [
        {
          type: 'tabItem',
          attrs: { id: 'one', title: 'First' },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Visible text' }],
            },
          ],
        },
        {
          type: 'tabItem',
          attrs: { id: 'two', title: 'Second' },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Hidden evidence' },
                {
                  type: 'footnote',
                  attrs: { id: 'fn' },
                  content: [{ type: 'text', text: 'Canonical note' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('tabs', () => {
  it('preserves every tab and its title in HTML, text, search and Markdown', () => {
    const editor = new Editor({ extensions, content: document });
    const roundtrip = new Editor({ extensions, content: editor.getHTML() });
    try {
      const text = generateText(editor.getJSON(), extensions);
      expect(text).toContain('First');
      expect(text).toContain('Second');
      expect(text).toContain('Hidden evidence');
      expect(text).toContain('Canonical note');
      expect(roundtrip.getJSON()).toEqual(editor.getJSON());
      const markdown = htmlToMarkdown(editor.getHTML());
      expect(markdown).toContain('Hidden evidence');
      expect(markdown).toContain('Second');
      editor.commands.setSearchTerm('Hidden evidence');
      expect(editor.storage.searchAndReplace.results).toHaveLength(1);
    } finally {
      editor.destroy();
      roundtrip.destroy();
    }
  });

  it('rejects nested tabs, including inside lists, and does not alter the document', () => {
    const editor = new Editor({ extensions, content: document });
    try {
      editor.commands.setTextSelection(3);
      const before = editor.getJSON();
      expect(editor.commands.insertTabs()).toBe(false);
      expect(editor.getJSON()).toEqual(before);
      const nested = structuredClone(document);
      nested.content[0].content[0].content = [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [structuredClone(document.content[0])],
            },
          ],
        },
      ] as any;
      expect(() => assertTabStructure(nested)).toThrow('Nested tabs');
      expect(() =>
        assertTabStructure({
          type: 'doc',
          content: [{ type: 'tabItem', content: [] }],
        }),
      ).toThrow('must belong');
    } finally {
      editor.destroy();
    }
  });
});
