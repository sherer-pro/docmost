import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

export async function runPageAttachmentsAcceptance({
  api,
  fetchApi,
  actors,
  space,
  workspaceId,
  hiddenParent,
  sql,
  fixture,
  test,
  output,
}) {
  await test('Page attachment ACL, references, history and transactional cleanup', async () => {
    const owner = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      title: 'Attachment gallery acceptance',
    });
    const upload = (pageId, name, buffer, mimeType) =>
      api(
        actors.admin,
        `/attachments/actions/upload-file?pageId=${pageId}`,
        'POST',
        undefined,
        { multipart: { pageId, file: { name, buffer, mimeType } } },
      );
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
      'base64',
    );
    const image = await upload(owner.id, '01-gallery.png', png, 'image/png');
    const historical = await upload(
      owner.id,
      '02-historical.txt',
      Buffer.from('Synthetic history attachment'),
      'text/plain',
    );
    const unused = await upload(
      owner.id,
      '03-unused.txt',
      Buffer.from('Synthetic unused attachment'),
      'text/plain',
    );
    const privateFile = await upload(
      hiddenParent.id,
      'private-filename-must-not-leak.txt',
      Buffer.from('Synthetic restricted attachment'),
      'text/plain',
    );
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Gallery attachment target' }],
        },
        {
          type: 'image',
          attrs: {
            id: randomUUID(),
            attachmentId: image.id,
            src: `/api/attachments/files/${image.id}/${image.fileName}`,
            alt: image.fileName,
          },
        },
        {
          type: 'attachment',
          attrs: {
            attachmentId: privateFile.id,
            name: privateFile.fileName,
            url: `/api/attachments/files/${privateFile.id}/${privateFile.fileName}`,
          },
        },
      ],
    };
    await api(actors.admin, '/pages/actions/update', 'POST', {
      pageId: owner.id,
      content,
      format: 'json',
      operation: 'replace',
    });
    await sql`insert into page_history (page_id,space_id,workspace_id,content) values (${owner.id},${space.id},${workspaceId},${sql.json({ type: 'doc', content: [{ type: 'attachment', attrs: { attachmentId: historical.id.toUpperCase() } }] })})`;
    const listed = await api(
      actors.reader,
      `/pages/${owner.id}/attachments?limit=2`,
    );
    assert.equal(listed.canDelete, false);
    assert.equal(listed.items.length, 2);
    assert(listed.meta.nextCursor);
    const all = await api(
      actors.reader,
      `/pages/${owner.id}/attachments?limit=50`,
    );
    assert.deepEqual(
      all.items.map((x) => x.id),
      [image.id, historical.id, unused.id],
    );
    assert(all.items[0].usages.length > 0);
    assert(!JSON.stringify(all).includes(privateFile.fileName));
    assert(!JSON.stringify(all).includes('filePath'));
    const filtered = await api(
      actors.reader,
      `/pages/${owner.id}/attachments?query=historical`,
    );
    assert.deepEqual(
      filtered.items.map((x) => x.id),
      [historical.id],
    );
    const remove = (actor, file) =>
      fetchApi(
        actor,
        `/pages/${owner.id}/attachments/${file.id}/actions/remove`,
        'POST',
        {},
      );
    for (const actor of [actors.reader, actors.editor])
      assert.equal((await remove(actor, unused)).status(), 403);
    for (const file of [image, historical]) {
      const response = await remove(actors.admin, file);
      assert.equal(response.status(), 409);
      assert.equal((await response.json()).code, 'attachment_in_use');
    }
    assert.equal((await remove(actors.admin, privateFile)).status(), 404);
    assert.equal(
      (await api(actors.admin, `/pages/${owner.id}/attachments`)).canDelete,
      true,
    );
    const [stored] =
      await sql`select file_path from attachments where id=${unused.id}`;
    const storedPath = path.resolve(
      output,
      'runtime/data/storage',
      stored.file_path,
    );
    assert((await stat(storedPath)).isFile());
    assert.deepEqual(
      await api(
        actors.admin,
        `/pages/${owner.id}/attachments/${unused.id}/actions/remove`,
        'POST',
        {},
      ),
      { queued: true },
    );
    assert.equal(
      (await sql`select id from attachments where id=${unused.id}`).length,
      0,
    );
    const jobs =
      await sql`select b.id from attachment_cleanup_batches b join attachment_cleanup_items i on i.batch_id=b.id where b.scope_type='attachment' and b.scope_id=${unused.id} and i.attachment_id=${unused.id}`;
    assert.equal(jobs.length, 1);
    assert.equal((await remove(actors.admin, unused)).status(), 404);
    const deadline = Date.now() + 30000;
    let cleanup;
    do {
      [cleanup] =
        await sql`select status from attachment_cleanup_items where attachment_id=${unused.id}`;
      if (cleanup?.status === 'completed') break;
      await delay(250);
    } while (Date.now() < deadline);
    assert.equal(
      cleanup?.status,
      'completed',
      'Cleanup worker must finish the staged file',
    );
    await assert.rejects(stat(storedPath), { code: 'ENOENT' });
    fixture.gallery = {
      pageId: owner.id,
      route: `/s/${space.slug}/p/${owner.slugId}`,
      imageId: image.id,
    };
  });
}
