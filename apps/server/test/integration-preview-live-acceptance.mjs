import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const exec = promisify(execFile);

export async function runIntegrationPreviewAcceptance({
  api,
  fetchApi,
  actors,
  parent,
  space,
  sql,
  test,
  exactSecrets,
  output,
  fixture = {},
}) {
  const root = '/integration-previews';
  const url = 'https://github.com/private/project/issues/2';
  const resolve = (actor, value = url) =>
    api(actor, `${root}/actions/resolve`, 'POST', {
      pageId: parent.id,
      url: value,
    });
  await test('Integration previews start disabled and require administrator configuration', async () => {
    assert.equal((await api(actors.admin, `${root}/settings`)).enabled, false);
    assert.equal((await resolve(actors.reader)).status, 'disabled');
    assert.equal(
      (
        await fetchApi(actors.reader, `${root}/settings`, 'PATCH', {
          enabled: true,
        })
      ).status(),
      403,
    );
    const settings = await api(actors.admin, `${root}/settings`, 'PATCH', {
      enabled: true,
    });
    assert.deepEqual(settings.availableProviders.sort(), [
      'figma',
      'github',
      'gitlab',
    ]);
    assert.equal(
      (await resolve(actors.reader)).title,
      'Public GitHub metadata',
    );
    assert.equal(
      (
        await resolve(
          actors.reader,
          'https://gitlab.com/private/project/-/issues/2',
        )
      ).status,
      'connectionRequired',
    );
  });
  await test('Personal credentials stay encrypted and are never shared with another reader', async () => {
    const token = 'synthetic-preview-owner';
    exactSecrets.add(token);
    const saved = await api(
      actors.editor,
      `${root}/connections/github`,
      'PUT',
      { credential: token },
    );
    assert(!JSON.stringify(saved).includes(token));
    const [stored] =
      await sql`select credential, revision from integration_preview_connections where id=${saved.id}`;
    assert(
      stored.credential !== token && stored.credential.length > token.length,
    );
    assert.equal(stored.revision, 1);
    assert.equal(
      (await resolve(actors.editor)).title,
      'Private github metadata',
    );
    assert.equal(
      (await resolve(actors.reader)).title,
      'Public GitHub metadata',
    );
    assert.deepEqual(await api(actors.reader, `${root}/connections`), []);
    const listed = await api(actors.editor, `${root}/connections`);
    assert.equal(listed.length, 1);
    assert(!JSON.stringify(listed).includes('credential'));
    await api(actors.editor, `${root}/connections/github`, 'PUT', {
      credential: 'synthetic-preview-denied',
    });
    assert.equal((await resolve(actors.editor)).status, 'unavailable');
    await api(actors.editor, `${root}/connections/github`, 'DELETE');
    assert.equal(
      (await resolve(actors.editor)).title,
      'Public GitHub metadata',
    );
    assert.equal(
      (
        await sql`select id from integration_preview_connections where id=${saved.id}`
      ).length,
      0,
    );
  });
  await test('Previews enforce page access, reject forged provider URLs and persist URL-only blocks', async () => {
    const hidden = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      title: 'Private preview document',
    });
    await api(
      actors.admin,
      `/pages/${hidden.id}/actions/access/close-user`,
      'POST',
      { userId: actors.reader.id },
    );
    const denied = await fetchApi(
      actors.reader,
      `${root}/actions/resolve`,
      'POST',
      { pageId: hidden.id, url },
    );
    assert([403, 404].includes(denied.status()));
    for (const bad of [
      'https://127.0.0.1/private',
      'https://github.com.evil.test/a/b',
      'https://github.com/a/b/actions',
    ])
      assert.equal(
        (
          await fetchApi(actors.reader, `${root}/actions/resolve`, 'POST', {
            pageId: parent.id,
            url: bad,
          })
        ).status(),
        400,
      );
    const content = {
      type: 'doc',
      content: [
        { type: 'integrationPreview', attrs: { url } },
        {
          type: 'paragraph',
          content: [
            {
              type: 'integrationMention',
              attrs: { url: 'https://www.figma.com/design/AbCd123456/Design' },
            },
          ],
        },
      ],
    };
    const page = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      title: 'URL-only integrations',
      format: 'json',
      content,
    });
    const read = await api(actors.reader, `/pages/info?pageId=${page.id}`);
    fixture.integrationPreviews = { pageId: page.id, route: `/s/${space.slug}/p/${page.slugId}` };
    assert(JSON.stringify(read).includes('integrationPreview'));
    assert(!JSON.stringify(read).includes('Private github metadata'));
    for (const format of ['markdown', 'html', 'pdf', 'docx', 'docmost']) {
      const response = await fetchApi(actors.admin, '/pages/actions/export', 'POST', {
        pageId: page.id, format, includeChildren: false, includeAttachments: false,
      });
      assert.equal(response.status(), 200, `Integration ${format} export`);
      const bytes = await response.body();
      const archive = await JSZip.loadAsync(bytes);
      await writeFile(path.join(output, `integration-${format}.zip`), bytes);
      let text;
      if (format === 'docmost') text = await archive.file('docmost-data.json').async('string');
      else {
        const extension = format === 'markdown' ? 'md' : format;
        const entry = Object.values(archive.files).find((item) => !item.dir && item.name.endsWith(`.${extension}`));
        assert(entry, `Missing ${format} document`);
        if (format === 'docx') {
          const docx = await JSZip.loadAsync(await entry.async('nodebuffer'));
          text = await docx.file('word/document.xml').async('string');
        } else if (format === 'pdf') {
          const filename = path.join(output, 'integration.pdf');
          await writeFile(filename, await entry.async('nodebuffer'));
          text = (await exec(process.env.DOCMOST_PYTHON ?? 'python', ['-c', 'import sys,pdfplumber; p=pdfplumber.open(sys.argv[1]); print("\\n".join(page.extract_text() or "" for page in p.pages))', filename], { windowsHide: true })).stdout;
        } else text = await entry.async('string');
      }
      assert(text.includes(url), `${format} lost the source URL`);
      assert(!text.includes('Private github metadata'), `${format} included private metadata`);
    }
    await api(actors.admin, `${root}/settings`, 'PATCH', { enabled: false });
    assert.equal((await resolve(actors.editor)).status, 'disabled');
    assert(
      JSON.stringify(
        await api(actors.reader, `/pages/info?pageId=${page.id}`),
      ).includes('integrationPreview'),
    );
  });
}
