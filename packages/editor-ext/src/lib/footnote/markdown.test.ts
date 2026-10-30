import { Marked } from 'marked';
import { describe, it, expect } from 'vitest';
import { footnoteMarkdownExtension, escapeFootnoteMarkdown } from './markdown';

const parse = (text: string) =>
  new Marked(footnoteMarkdownExtension()).parse(text).toString();
describe('Markdown footnote import', () => {
  it('resolves definitions after their references and retains multiline text', () => {
    const html = parse('Source[^a].\n\n[^a]: First\n    second line');
    expect(html).toContain('data-type="footnote"');
    expect(html).toContain('data-footnote-text="First\nsecond line"');
    expect(html).not.toContain('[^a]:');
  });
  it('escapes active HTML and keeps undefined references literal', () => {
    const html = parse(
      'Source[^a] [^missing].\n\n[^a]: <script>alert("x")</script>',
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('[^missing]');
    expect(parse('Another[^a]')).not.toContain('data-type="footnote"');
  });
  it('does not expand references or definitions inside code', () => {
    expect(parse('`[^a]`\n\n[^a]: text')).not.toContain('data-type="footnote"');
    const html = parse('````\n[^a]: text\n````\n\nReference[^a]');
    expect(html).not.toContain('data-type="footnote"');
  });
  it('preserves escaped literal Markdown in definitions', () => {
    const text = 'A *literal* [note] <text>\nsecond line';
    const html = parse(`Source[^a]\n\n[^a]: ${escapeFootnoteMarkdown(text)}`);
    expect(html).toContain('A *literal* [note] &lt;text&gt;\nsecond line');
  });
});
