import { describe, it, expect } from 'vitest';
import { getSchema, generateText } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Footnote, collectFootnotes, footnoteText } from './footnote';
import { prepareFootnotesForExport } from './export';

describe('footnote content contract', () => {
  const extensions = [StarterKit, Footnote];
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Source' },
          {
            type: 'footnote',
            attrs: { id: 'note-one', text: 'First <script>note</script>' },
          },
          { type: 'footnote', attrs: { id: 'note-two', text: 'Second\nline' } },
        ],
      },
    ],
  };
  it('renumbers in document order without mutating the source', () => {
    const before = JSON.stringify(doc);
    const prepared = prepareFootnotesForExport(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect(prepared.content.content[0].content[1].attrs?.number).toBe(1);
    expect(prepared.footerHtml).toContain('&lt;script&gt;note&lt;/script&gt;');
    expect(prepared.footerHtml).toContain('Second<br>line');
    expect(prepareFootnotesForExport(doc, 'page-a').footerHtml).toContain(
      'id="page-a-fn-1"',
    );
    expect(prepareFootnotesForExport(doc, 'page-b').footerHtml).not.toContain(
      'page-a-fn-1',
    );
    const schema = getSchema(extensions);
    expect(
      collectFootnotes(schema.nodeFromJSON(doc)).map((entry) => entry.number),
    ).toEqual([1, 2]);
    const reversed = {
      ...doc,
      content: [
        {
          ...doc.content[0],
          content: doc.content[0].content.slice().reverse(),
        },
      ],
    };
    expect(
      collectFootnotes(schema.nodeFromJSON(reversed)).map((entry) => entry.id),
    ).toEqual(['note-two', 'note-one']);
  });
  it('retains note text in the shared text projection', () => {
    expect(generateText(doc, extensions)).toContain(
      'First <script>note</script>',
    );
    expect(footnoteText('\0test')).toBe('test');
    expect(footnoteText('x'.repeat(20000))).toHaveLength(20000);
  });
});
