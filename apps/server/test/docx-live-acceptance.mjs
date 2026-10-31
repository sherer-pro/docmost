import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');

export async function runDocxAcceptance({
  api,
  fetchApi,
  actors,
  space,
  parent,
  fixture,
  test,
  output,
}) {
  await test('DOCX embeds permitted database rows and owned images while hiding denied rows and sources', async () => {
    const database = await api(actors.admin, '/databases', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      name: 'DOCX database',
    });
    const allowed = await api(
      actors.admin,
      `/databases/${database.id}/rows`,
      'POST',
      { title: 'DOCX_ALLOWED_RECORD' },
    );
    const denied = await api(
      actors.admin,
      `/databases/${database.id}/rows`,
      'POST',
      { title: 'DOCX_DENIED_RECORD' },
    );
    await api(
      actors.admin,
      `/pages/${denied.pageId}/actions/access/close-user`,
      'POST',
      { userId: actors.editor.id },
    );
    const page = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      title: 'DOCX acceptance',
    });
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(120, 40);
    const context = canvas.getContext('2d');
    context.fillStyle = '#304d80';
    context.fillRect(0, 0, 120, 40);
    const png = canvas.toBuffer('image/png');
    const image = await api(
      actors.admin,
      `/attachments/actions/upload-file?pageId=${page.id}`,
      'POST',
      undefined,
      {
        multipart: {
          pageId: page.id,
          file: { name: 'docx-image.png', buffer: png, mimeType: 'image/png' },
        },
      },
    );
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'DOCX_BODY_EVIDENCE' }],
        },
        {
          type: 'image',
          attrs: {
            id: randomUUID(),
            attachmentId: image.id,
            src: `/api/attachments/files/${image.id}/${image.fileName}`,
            alt: 'DOCX image',
          },
        },
        { type: 'databaseEmbed', attrs: { databaseId: database.id } },
      ],
    };
    await api(actors.admin, '/pages/actions/update', 'POST', {
      pageId: page.id,
      content,
      format: 'json',
      operation: 'replace',
    });
    const download = async (name) => {
      const response = await fetchApi(
        actors.editor,
        '/pages/actions/export',
        'POST',
        {
          pageId: page.id,
          format: 'docx',
          includeChildren: false,
          includeAttachments: false,
        },
      );
      assert.equal(response.status(), 200, `DOCX ${name} download failed`);
      const outer = await JSZip.loadAsync(await response.body());
      const file = Object.values(outer.files).find((entry) =>
        entry.name.endsWith('.docx'),
      );
      assert(file);
      const bytes = await file.async('nodebuffer');
      await writeFile(path.join(output, `docx-${name}.docx`), bytes);
      return JSZip.loadAsync(bytes);
    };
    const readable = await download('readable');
    const body = await readable.file('word/document.xml').async('string');
    assert(body.includes('DOCX_BODY_EVIDENCE'));
    assert(body.includes('DOCX_ALLOWED_RECORD'));
    assert(!body.includes('DOCX_DENIED_RECORD'));
    assert(body.includes('<w:tbl>'));
    const embedded = Object.values(readable.files).find((entry) =>
      /word\/media\/.*\.png$/u.test(entry.name),
    );
    assert(embedded);
    assert.deepEqual(await embedded.async('nodebuffer'), png);
    await api(
      actors.admin,
      `/pages/${database.pageId}/actions/access/close-user`,
      'POST',
      { userId: actors.editor.id },
    );
    const revoked = await download('source-revoked');
    const revokedBody = await revoked.file('word/document.xml').async('string');
    assert(revokedBody.includes('Database view unavailable'));
    assert(!revokedBody.includes('DOCX_ALLOWED_RECORD'));
    assert(!revokedBody.includes('DOCX_DENIED_RECORD'));
    fixture.docx = {
      pageId: page.id,
      route: `/s/${space.slug}/p/${page.slugId}`,
      allowedPageId: allowed.pageId,
    };
  });
}
