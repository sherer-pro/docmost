import { renderDocx } from './docx-renderer';
import * as JSZip from 'jszip';
import * as mammoth from 'mammoth';
import { DOMParser } from '@xmldom/xmldom';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1cAAAAASUVORK5CYII=';
const create = (html: string) =>
  renderDocx({
    html,
    title: 'Export fixture',
    appUrl: 'https://docmost.example.test',
  });

describe('DOCX native document export', () => {
  it('round trips tables, formatting, lists, images and native footnotes through a real DOCX reader', async () => {
    const buffer = await create(
      `<h1>Export fixture</h1><p>Body <strong>bold</strong> <em>italic</em> <a href="/s/test/p/source">source</a><sup data-type="footnote"><a href="#fixture-fn-1">1</a></sup></p><h2>Data</h2><table><tr><th>Task</th><th>Budget</th></tr><tr><td>Research</td><td>1200</td></tr></table><ol start="3"><li><p>First</p><ul><li><p>Nested</p></li></ul></li><li><p>Second</p></li></ol><p><img alt="Pixel" src="data:image/png;base64,${png}"></p><section data-footnotes="true"><ol><li id="fixture-fn-1">Verified note<br>Second line <a role="doc-backlink" href="#fixture-fnref-1">1</a></li></ol></section>`,
    );
    const archive = await JSZip.loadAsync(buffer);
    const document = await archive.file('word/document.xml')!.async('string');
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(document).toContain('<w:tbl>');
    expect(document).toContain('r:embed=');
    expect(document).not.toContain('Verified note');
    expect(await archive.file('word/footnotes.xml')!.async('string')).toContain(
      'Verified note',
    );
    expect(await archive.file('word/numbering.xml')!.async('string')).toContain(
      '<w:startOverride w:val="3"/>',
    );
    expect(
      await archive.file('word/_rels/document.xml.rels')!.async('string'),
    ).toContain('https://docmost.example.test/s/test/p/source');
    for (const entry of Object.values(archive.files).filter((file) =>
      /\.(xml|rels)$/u.test(file.name),
    )) {
      const errors: string[] = [];
      new DOMParser({
        errorHandler: {
          warning: (message) => errors.push(message),
          error: (message) => errors.push(message),
          fatalError: (message) => errors.push(message),
        },
      }).parseFromString(await entry.async('string'), 'application/xml');
      expect(errors).toEqual([]);
    }
    const converted = await mammoth.convertToHtml({ buffer });
    expect(converted.value).toContain('<strong>bold</strong>');
    expect(converted.value).toContain('<em>italic</em>');
    expect(converted.value).toContain('<table>');
    expect(converted.value).toContain('Verified note');
    expect(converted.value).toContain('data:image/png;base64,');
    expect(converted.value).toContain('Nested');
  });

  it('preserves merged cells, expanded details and tabs, code, page breaks and RTL paragraphs', async () => {
    const archive = await JSZip.loadAsync(
      await create(
        '<h1>Document</h1><table><tr><td rowspan="2">Merged</td><td>A</td></tr><tr><td>B</td></tr></table><details><summary>Details</summary><p>Hidden detail</p></details><section data-tabs><div><h3>Tab A</h3><p>Hidden tab</p></div><div><h3>Tab B</h3><p>Other tab</p></div></section><pre><code>const value = 1;\nnext();</code></pre><div data-type="pageBreak"></div><p dir="rtl">Mixed RTL text</p>',
      ),
    );
    const document = await archive.file('word/document.xml')!.async('string');
    expect(document).toContain('<w:vMerge w:val="restart"/>');
    expect(document).toContain('<w:vMerge/>');
    expect(document).toContain('Hidden detail');
    expect(document).toContain('Hidden tab');
    expect(document).toContain('Other tab');
    expect(document).toContain('<w:br w:type="page"/>');
    expect(document).toContain('<w:bidi/>');
    expect(document).toContain('<w:rFonts w:ascii="Consolas"');
  });

  it('never creates active content or remote image relationships and handles malformed image metadata', async () => {
    const buffer = await create(
      '<p><script>PRIVATE_SCRIPT</script><iframe src="https://private.test">PRIVATE_IFRAME</iframe><a href="javascript:alert(1)">Safe text</a><a href="file:///private.txt">File text</a><img src="http://127.0.0.1:1/private.png" alt="Remote omitted"><img src="data:image/jpeg;base64,/9j/////" alt="Invalid image"></p>',
    );
    const archive = await JSZip.loadAsync(buffer);
    const document = await archive.file('word/document.xml')!.async('string');
    const rels = await archive
      .file('word/_rels/document.xml.rels')!
      .async('string');
    expect(document).toContain('Safe text');
    expect(document).toContain('Invalid image');
    expect(document).not.toMatch(/PRIVATE_SCRIPT|PRIVATE_IFRAME|altChunk/u);
    expect(rels).not.toMatch(
      /javascript:|file:|private\.png|TargetMode="External"/u,
    );
    expect(Object.keys(archive.files)).not.toContain('word/vbaProject.bin');
  });

  it('rejects oversized inputs and invalid table spans without producing partial files', async () => {
    await expect(create('x'.repeat(16 * 1024 * 1024 + 1))).rejects.toThrow(
      'export limit',
    );
    await expect(
      create(`<table><tr>${'<td>value</td>'.repeat(65)}</tr></table>`),
    ).rejects.toThrow('too many columns');
  });
  it('removes XML-invalid code points while retaining supplementary Unicode text', async () => {
    const invalid = String.fromCharCode(1, 0xd800, 0xfffe);
    const archive = await JSZip.loadAsync(await create(`<p>Before ${invalid} after ${String.fromCodePoint(0x1f600)}</p>`));
    const document = await archive.file('word/document.xml')!.async('string');
    expect(document).not.toContain(String.fromCharCode(1));
    expect(document).not.toContain(String.fromCharCode(0xd800));
    expect(document).not.toContain(String.fromCharCode(0xfffe));
    expect(document).toContain(String.fromCodePoint(0x1f600));
  });
});
