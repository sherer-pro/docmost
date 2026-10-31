import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');

export async function runMarkdownExportAcceptance({
  api,
  fetchApi,
  actors,
  space,
  parent,
  test,
  output,
}) {
  await test('Markdown preserves real table headers, repeated pipes and rich expandable summaries', async () => {
    const paragraph = (text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    });
    const content = {
      type: 'doc',
      content: [
        {
          type: 'details',
          attrs: { open: true },
          content: [
            {
              type: 'detailsSummary',
              content: [
                { type: 'text', text: 'Release ' },
                { type: 'text', text: 'notes', marks: [{ type: 'bold' }] },
              ],
            },
            {
              type: 'detailsContent',
              content: [
                paragraph('First export block'),
                paragraph('Second export block'),
                {
                  type: 'table',
                  content: [
                    {
                      type: 'tableRow',
                      content: ['Name', 'Budget'].map((text) => ({
                        type: 'tableHeader',
                        content: [paragraph(text)],
                      })),
                    },
                    {
                      type: 'tableRow',
                      content: ['A ||| B', '42'].map((text) => ({
                        type: 'tableCell',
                        content: [paragraph(text)],
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const page = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      title: 'Markdown export compatibility',
      format: 'json',
      content,
    });
    for (const format of ['markdown', 'html']) {
      const response = await fetchApi(
        actors.admin,
        '/pages/actions/export',
        'POST',
        {
          pageId: page.id,
          format,
          includeChildren: false,
          includeAttachments: false,
        },
      );
      assert.equal(response.status(), 200);
      const bytes = await response.body();
      await writeFile(
        path.join(output, `markdown-compat-${format}.zip`),
        bytes,
      );
      const zip = await JSZip.loadAsync(bytes);
      const extension = format === 'markdown' ? '.md' : '.html';
      const entry = Object.values(zip.files).find(
        (file) => !file.dir && file.name.endsWith(extension),
      );
      assert(entry);
      const text = await entry.async('string');
      assert(
        text.includes('First export block') &&
          text.includes('Second export block'),
      );
      if (format === 'markdown') {
        assert(
          text.includes('| Name | Budget |'),
          'Real headers became a blank Markdown header',
        );
        assert(
          text.includes('A \\|\\|\\| B'),
          'Consecutive pipe characters were lost',
        );
        assert(text.includes('<summary>\n\nRelease **notes**\n\n</summary>'));
      } else {
        assert(text.includes('<strong>notes</strong>'));
        assert(text.includes('A ||| B'));
        assert(/<th[^>]*>[\s\S]*?Name[\s\S]*?<\/th>/.test(text));
      }
    }
  });
}
