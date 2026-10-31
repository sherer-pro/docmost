// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './utils/turndown.utils';
import { markdownToHtml } from './utils/marked.utils';

const parsed = async (markdown: string) =>
  new DOMParser().parseFromString(await markdownToHtml(markdown), 'text/html');
describe('Markdown table and expandable content exports', () => {
  it('retains footnotes in both the summary and body without exporting active HTML', async () => {
    const html =
      '<details><summary>Summary<sup data-type="footnote" data-footnote-id="summary-note" data-footnote-text="Summary evidence">1</sup><script>unsafe()</script></summary><div data-type="detailsContent"><p>Body<sup data-type="footnote" data-footnote-id="body-note" data-footnote-text="Body evidence">2</sup></p></div></details>';
    const markdown = htmlToMarkdown(html);
    const doc = await parsed(markdown);
    expect(
      doc.querySelector('summary sup')?.getAttribute('data-footnote-text'),
    ).toBe('Summary evidence');
    expect(
      doc.querySelector('details > p sup')?.getAttribute('data-footnote-text'),
    ).toBe('Body evidence');
    expect(doc.querySelector('script')).toBeNull();
    expect(markdown).not.toContain('<script');
  });
  it.each(['', '\n  '])(
    'retains real table headers after colgroup with whitespace %j',
    async (spacing) => {
      const html = `<table>${spacing}<colgroup><col style="width:120px"><col></colgroup>${spacing}<tbody>${spacing}<tr><th><p>Name</p></th><th><p>Budget</p></th></tr><tr><td><p>Alpha</p></td><td><p>42</p></td></tr></tbody></table>`;
      const doc = await parsed(htmlToMarkdown(html));
      expect(
        [...doc.querySelectorAll('thead th')].map((cell) => cell.textContent),
      ).toEqual(['Name', 'Budget']);
      expect(
        [...doc.querySelectorAll('tbody td')].map((cell) => cell.textContent),
      ).toEqual(['Alpha', '42']);
    },
  );
  it('preserves every consecutive pipe rather than collapsing cell values', async () => {
    const doc = await parsed(
      htmlToMarkdown(
        '<table><thead><tr><th>Value</th></tr></thead><tbody><tr><td>A ||| B</td></tr></tbody></table>',
      ),
    );
    expect(doc.querySelector('tbody td')?.textContent).toBe('A ||| B');
  });
  it('retains a generated empty header for a genuinely headerless table', async () => {
    const doc = await parsed(
      htmlToMarkdown(
        '<table><tbody><tr><td>First data</td><td>Second data</td></tr></tbody></table>',
      ),
    );
    expect(
      [...doc.querySelectorAll('thead th')].map((cell) => cell.textContent),
    ).toEqual(['', '']);
    expect(
      [...doc.querySelectorAll('tbody td')].map((cell) => cell.textContent),
    ).toEqual(['First data', 'Second data']);
  });
  it('keeps rich summary marks and complete table values through Markdown rendering', async () => {
    const html =
      '<details><summary>Release <strong>notes</strong> and <em>links</em></summary><div data-type="detailsContent"><p>First block</p><p>Second block</p><table><thead><tr><th>Owner</th></tr></thead><tbody><tr><td>Alpha</td></tr></tbody></table></div></details>';
    const doc = await parsed(htmlToMarkdown(html));
    expect(doc.querySelector('summary strong')?.textContent).toBe('notes');
    expect(doc.querySelector('summary em')?.textContent).toBe('links');
    expect(doc.querySelector('details')?.textContent).toContain('First block');
    expect(doc.querySelector('details')?.textContent).toContain('Second block');
    expect(doc.querySelector('tbody td')?.textContent).toBe('Alpha');
  });
  it('keeps separate sibling blocks inside native details HTML', async () => {
    const doc = await parsed(
      htmlToMarkdown(
        '<details><summary>Title</summary><p>First block</p><p>Second block</p><ul><li>List item</li></ul></details>',
      ),
    );
    expect(
      [...doc.querySelectorAll('details > p')].map(
        (paragraph) => paragraph.textContent,
      ),
    ).toEqual(['First block', 'Second block']);
    expect(doc.querySelector('details li')?.textContent).toBe('List item');
  });
});
