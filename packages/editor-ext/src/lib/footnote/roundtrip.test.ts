import { generateHTML, generateJSON } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { describe, it, expect } from 'vitest';
import { Footnote } from './footnote';
import { prepareFootnotesForExport } from './export';
import { htmlToMarkdown, markdownToHtml } from '../markdown';

describe('portable footnotes', () => {
  const text = 'Literal *note* <markup>\nsecond line';
  it('round-trips Markdown and HTML without exposing executable note markup', () => {
    const source = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Source' },
            {
              type: 'footnote',
              attrs: { id: 'note' },
              content: [{ type: 'text', text }],
            },
          ],
        },
      ],
    };
    const prepared = prepareFootnotesForExport(source, 'page');
    const html =
      generateHTML(prepared.content, [StarterKit, Footnote]) +
      prepared.footerHtml;
    expect(html).toContain('#page-fn-1');
    const markdown = htmlToMarkdown(html);
    expect(markdown).toContain('Source[^1]');
    expect(markdown.match(/\[\^1\]:/g)).toHaveLength(1);
    const restored = generateJSON(markdownToHtml(markdown).toString(), [
      StarterKit,
      Footnote,
    ]);
    expect(
      restored.content?.[0].content?.find((node) => node.type === 'footnote')
        ?.content?.[0].text,
    ).toBe(text);
  });
  it('keeps note definitions within nested callouts', () => {
    const html = markdownToHtml(
      ':::info\nSource[^one]\n:::\n\n[^one]: A note',
    ).toString();
    expect(html).toContain('data-type="footnote"');
    expect(htmlToMarkdown(html)).toContain('[^1]: A note');
  });
});
