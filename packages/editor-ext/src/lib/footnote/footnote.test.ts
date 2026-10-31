import { describe, it, expect } from 'vitest';
import { getSchema, generateText, Mark } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { Footnote, collectFootnotes, footnoteText } from './footnote';
import { prepareFootnotesForExport } from './export';

describe('footnote content contract', () => {
  it('imports footnote metadata before a generic superscript mark without consuming plain superscripts', () => {
    const Superscript = Mark.create({
      name: 'superscript',
      parseHTML: () => [{ tag: 'sup' }],
      renderHTML: () => ['sup', 0],
    });
    const readers = [StarterKit, Superscript, Footnote];
    const parsed = generateJSON(
      '<p>Source<sup data-type="footnote" data-footnote-id="note-one" data-footnote-text="Canonical note"><a href="#fn-1">1</a></sup></p>',
      readers,
    );
    expect(
      parsed.content?.[0].content?.find((node) => node.type === 'footnote')
        ?.content?.[0].text,
    ).toBe('Canonical note');
    const plain = generateJSON('<p>10<sup>2</sup></p>', readers);
    expect(
      plain.content?.[0].content?.some((node) => node.type === 'footnote'),
    ).toBe(false);
    expect(
      plain.content?.[0].content
        ?.find((node) => node.text === '2')
        ?.marks?.some((mark) => mark.type === 'superscript'),
    ).toBe(true);
  });
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
