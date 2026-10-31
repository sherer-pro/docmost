import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runEmptyTemplateAcceptance({
  api,
  fetchApi,
  actors,
  space,
  parent,
  fixture,
  test,
  sql,
}) {
  await test('Empty-page template application is idempotent, transactional and preserves existing content and access', async () => {
    const admin = actors.admin;
    const endpoint = `/pages/templates/policies/spaces/${space.id}`;
    const policy = await api(admin, endpoint);
    await api(admin, endpoint, 'PUT', {
      expectedRevision: policy.revision,
      templatesEnabled: true,
      allowCreateTemplate: true,
      allowRegularTemplate: true,
      allowSyncedTemplate: true,
    });
    const source = await api(admin, '/pages', 'POST', {
      spaceId: space.id,
      title: 'Template source',
      parentPageId: parent.id,
    });
    const upload = await api(
      admin,
      `/attachments/actions/upload-file?pageId=${source.id}`,
      'POST',
      undefined,
      {
        multipart: {
          pageId: source.id,
          file: {
            name: 'template.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
              'base64',
            ),
          },
        },
      },
    );
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Reusable template evidence' }],
        },
        {
          type: 'image',
          attrs: {
            id: randomUUID(),
            attachmentId: upload.id,
            src: `/api/attachments/files/${upload.id}/template.png`,
            alt: 'Template image',
          },
        },
      ],
    };
    await api(admin, '/pages/actions/update', 'POST', {
      pageId: source.id,
      format: 'json',
      operation: 'replace',
      content,
    });
    const createTemplate = async (kind) =>
      (
        await api(
          admin,
          '/pages/templates/actions/create',
          'POST',
          {
            spaceId: space.id,
            kind,
            title: `Reusable ${kind} template`,
            sourcePageId: source.id,
          },
          { headers: { 'idempotency-key': randomUUID() } },
        )
      ).page;
    const regular = await createTemplate('regular');
    const synced = await createTemplate('synced');
    const preflight = await api(
      admin,
      `/pages/templates/${synced.id}/actions/preflight-publish`,
      'POST',
      {},
    );
    await api(
      admin,
      `/pages/templates/${synced.id}/actions/publish`,
      'POST',
      { draftHash: preflight.draftHash },
      { headers: { 'idempotency-key': randomUUID() } },
    );
    const createTarget = (title) =>
      api(admin, '/pages', 'POST', {
        spaceId: space.id,
        title,
        parentPageId: parent.id,
      });
    const apply = (actor, pageId, templatePageId, key = randomUUID()) =>
      api(
        actor,
        `/pages/${pageId}/actions/apply-template`,
        'POST',
        { templatePageId },
        { headers: { 'idempotency-key': key } },
      );
    for (const template of [regular, synced]) {
      const target = await createTarget('Preserved target title');
      const key = randomUUID();
      const result = await apply(actors.editor, target.id, template.id, key);
      assert.equal(result.applied, true);
      assert.equal(
        (await apply(actors.editor, target.id, template.id, key)).idempotent,
        true,
      );
      const read = await api(admin, `/pages/info?pageId=${target.id}`);
      assert.equal(read.title, target.title);
      assert.equal(read.parentPageId, parent.id);
      assert(
        JSON.stringify(read.content).includes('Reusable template evidence'),
      );
      const instances =
        await sql`select instance_kind,status from page_template_instances where child_page_id=${target.id}`;
      assert.equal(instances.length, 1);
      assert.equal(
        instances[0].instance_kind,
        template.id === synced.id ? 'synced' : 'regular',
      );
      const files =
        await sql`select id from attachments where page_id=${target.id}`;
      assert.equal(files.length, 1);
      assert.notEqual(files[0].id, upload.id);
      assert(JSON.stringify(read.content).includes(files[0].id));
      const blocked = await fetchApi(
        actors.editor,
        `/pages/${target.id}/actions/apply-template`,
        'POST',
        { templatePageId: template.id },
        { headers: { 'idempotency-key': randomUUID() } },
      );
      assert.equal(blocked.status(), 409);
    }
    const deniedTarget = await createTarget('Reader cannot apply');
    const denied = await fetchApi(
      actors.reader,
      `/pages/${deniedTarget.id}/actions/apply-template`,
      'POST',
      { templatePageId: regular.id },
      { headers: { 'idempotency-key': randomUUID() } },
    );
    assert.equal(denied.status(), 403);
    const filled = await createTarget('Existing body');
    await api(admin, '/pages/actions/update', 'POST', {
      pageId: filled.id,
      format: 'json',
      operation: 'replace',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Keep this existing content' }],
          },
        ],
      },
    });
    const conflict = await fetchApi(
      actors.editor,
      `/pages/${filled.id}/actions/apply-template`,
      'POST',
      { templatePageId: regular.id },
      { headers: { 'idempotency-key': randomUUID() } },
    );
    assert.equal(conflict.status(), 409);
    assert(
      JSON.stringify(
        (await api(admin, `/pages/info?pageId=${filled.id}`)).content,
      ).includes('Keep this existing content'),
    );

    const rollback = await createTarget('Atomic attachment rollback');
    await sql.unsafe(
      `create function quality_template_attachment_failure() returns trigger language plpgsql as $$ begin if NEW.page_id = '${rollback.id}'::uuid then raise exception 'synthetic template attachment failure'; end if; return NEW; end $$`,
    );
    await sql`create trigger quality_template_attachment_failure before insert on attachments for each row execute function quality_template_attachment_failure()`;
    try {
      const failed = await fetchApi(
        actors.editor,
        `/pages/${rollback.id}/actions/apply-template`,
        'POST',
        { templatePageId: regular.id },
        { headers: { 'idempotency-key': randomUUID() } },
      );
      assert(!failed.ok(), 'The injected transaction must fail');
      assert.equal(
        (
          await sql`select id from page_template_instances where child_page_id=${rollback.id}`
        ).length,
        0,
      );
      assert.equal(
        (await sql`select id from attachments where page_id=${rollback.id}`)
          .length,
        0,
      );
      assert(
        !JSON.stringify(
          (await api(admin, `/pages/info?pageId=${rollback.id}`)).content,
        ).includes('Reusable template evidence'),
      );
    } finally {
      await sql`drop trigger quality_template_attachment_failure on attachments`;
      await sql`drop function quality_template_attachment_failure()`;
    }
    await apply(actors.editor, rollback.id, regular.id);
    fixture.emptyTemplates = {
      regularId: regular.id,
      syncedId: synced.id,
      parentId: parent.id,
      spaceSlug: space.slug,
      text: 'Reusable template evidence',
    };
  });
}
