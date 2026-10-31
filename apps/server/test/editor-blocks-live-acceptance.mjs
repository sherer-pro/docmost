import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const exec = promisify(execFile);

export async function runEditorBlocksAcceptance({
  api,
  fetchApi,
  actors,
  space,
  parent,
  fixture,
  test,
  output,
  sql,
}) {
  await test('Footnotes and all tab content survive page reads and downloaded Markdown, HTML, PDF and Docmost exports', async () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'tabs',
          attrs: { id: 'qa-tabs' },
          content: [
            {
              type: 'tabItem',
              attrs: { id: 'qa-tab-one', title: 'Overview' },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Visible tab evidence' }],
                },
              ],
            },
            {
              type: 'tabItem',
              attrs: { id: 'qa-tab-two', title: 'Details' },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Hidden tab evidence' }],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read source ' },
            {
              type: 'footnote',
              attrs: { id: 'qa-footnote-one' },
              content: [{ type: 'text', text: 'First canonical note' }],
            },
            { type: 'text', text: ' and another ' },
            {
              type: 'footnote',
              attrs: { id: 'qa-footnote-two' },
              content: [{ type: 'text', text: 'Second canonical note' }],
            },
            { type: 'text', text: '.' },
          ],
        },
      ],
    };
    const page = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      title: 'Footnote acceptance',
      format: 'json',
      content,
    });
    const read = await api(actors.reader, `/pages/info?pageId=${page.id}`);
    assert(JSON.stringify(read.content).includes('First canonical note'));
    const nested = structuredClone(content);
    nested.content[0].content[0].content.push(structuredClone(content.content[0]));
    const invalid = await fetchApi(actors.admin, '/pages/actions/update', 'POST', {
      pageId: page.id, format: 'json', operation: 'replace', content: nested,
    });
    assert.equal(invalid.status(), 400);
    assert.deepEqual((await api(actors.reader, `/pages/info?pageId=${page.id}`)).content, read.content);
    let archive;
    for (const format of ['markdown', 'html', 'pdf', 'docmost']) {
      const response = await fetchApi(
        actors.admin,
        '/pages/actions/export',
        'POST',
        {
          pageId: page.id,
          format,
          includeAttachments: true,
          includeChildren: false,
        },
      );
      assert.equal(response.status(), 200, `Footnote ${format} export failed`);
      const bytes = await response.body();
      const zip = await JSZip.loadAsync(bytes);
      await writeFile(path.join(output, `footnotes-${format}.zip`), bytes);
      if (format === 'docmost') {
        const data = JSON.parse(
          await zip.file('docmost-data.json').async('string'),
        );
        const document = data.pages.find((item) => item.id === page.id);
        assert(document);
        assert(
          JSON.stringify(document.content).includes('First canonical note'),
        );
        assert(
          JSON.stringify(document.content).includes('Hidden tab evidence'),
        );
        archive = bytes;
      } else {
        const ext = format === 'markdown' ? 'md' : format;
        const file = Object.values(zip.files).find(
          (item) => !item.dir && item.name.endsWith(`.${ext}`),
        );
        assert(file);
        if (format === 'pdf') {
          const pdf = await file.async('nodebuffer');
          assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
          const target = path.join(output, 'footnotes.pdf');
          await writeFile(target, pdf);
          const result = await exec(
            process.env.DOCMOST_PYTHON ?? 'python',
            [
              '-c',
              'import sys,pdfplumber; p=pdfplumber.open(sys.argv[1]); print("\\n".join(page.extract_text() or "" for page in p.pages))',
              target,
            ],
            { windowsHide: true, maxBuffer: 1000000 },
          );
          assert(result.stdout.includes('First canonical note'));
          assert(result.stdout.includes('Second canonical note'));
          assert(result.stdout.includes('Visible tab evidence'));
          assert(result.stdout.includes('Hidden tab evidence'));
        } else {
          const text = await file.async('string');
          assert(text.includes('First canonical note'));
          assert(text.includes('Second canonical note'));
          assert(text.includes('Visible tab evidence'));
          assert(text.includes('Hidden tab evidence'));
          if (format === 'markdown') assert(text.includes('[^1]:'));
          else {
            assert(text.includes('data-footnotes'));
            assert(text.includes(`#${page.id}-fn-1`));
          }
        }
      }
    }
    const target = await api(actors.admin, '/spaces', 'POST', {
      name: 'Imported footnotes',
      slug: `notes${Date.now()}`,
    });
    const preview = await api(
      actors.admin,
      `/pages/actions/import-zip/preview?spaceId=${target.id}`,
      'POST',
      undefined,
      {
        multipart: {
          spaceId: target.id,
          source: 'docmost',
          file: {
            name: 'footnotes.zip',
            mimeType: 'application/zip',
            buffer: archive,
          },
        },
      },
    );
    await api(actors.admin, '/pages/actions/import-zip/confirm', 'POST', {
      fileTaskId: preview.fileTaskId,
      applyDocumentFields: false,
      applyDictionary: false,
      applyHeadingNumbering: false,
      applyTags: false,
      cleanupLegacyHeadingNumbers: true,
    });
    const deadline = Date.now() + 120000;
    let task;
    do {
      task = await api(actors.admin, '/file-tasks/info', 'POST', {
        fileTaskId: preview.fileTaskId,
      });
      if (['success', 'failed'].includes(task.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert.equal(task.status, 'success');
    const [imported] =
      await sql`select content from pages where space_id=${target.id} and title='Footnote acceptance' and deleted_at is null`;
    assert(JSON.stringify(imported.content).includes('Second canonical note'));
    assert(JSON.stringify(imported.content).includes('Hidden tab evidence'));
    fixture.editorBlocks = {
      pageId: page.id,
      route: `/s/${space.slug}/p/${page.slugId}`,
      content,
    };
  });
}
