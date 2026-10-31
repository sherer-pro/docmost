import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

export async function runUpstreamRepairsAcceptance({
  api,
  fetchApi,
  actors,
  parent,
  space,
  sql,
  test,
}) {
  const suffix = randomBytes(4).toString('hex');
  const names = [`copy-${suffix}-a`, `copy-${suffix}-b`];
  const source = await api(actors.admin, '/pages', 'POST', {
    spaceId: space.id,
    parentPageId: parent.id,
    title: `Label source ${suffix}`,
  });
  const child = await api(actors.admin, '/pages', 'POST', {
    spaceId: space.id,
    parentPageId: source.id,
    title: `Label child ${suffix}`,
  });
  const original = await api(actors.admin, '/pages/labels/add', 'POST', {
    pageId: source.id,
    names,
  });
  await api(actors.admin, '/pages/labels/add', 'POST', {
    pageId: child.id,
    names: [names[1]],
  });
  const labels = async (pageId) =>
    (await api(actors.admin, '/pages/labels', 'POST', { pageId })).items;
  const copy = (spaceId, key = randomUUID()) =>
    api(
      actors.admin,
      '/pages/duplicate',
      'POST',
      { pageId: source.id, ...(spaceId ? { spaceId } : {}) },
      { headers: { 'Idempotency-Key': key } },
    );
  await test('Page duplication preserves original label identities throughout the copied tree', async () => {
    const duplicate = await copy();
    assert.deepEqual(
      (await labels(duplicate.id)).map((value) => value.id).sort(),
      original.map((value) => value.id).sort(),
    );
    const [duplicateChild] =
      await sql`select id from pages where parent_page_id=${duplicate.id} and deleted_at is null`;
    assert(duplicateChild);
    assert.deepEqual(
      (await labels(duplicateChild.id)).map((value) => value.name),
      [names[1]],
    );
    assert.deepEqual(
      (await labels(source.id)).map((value) => value.id).sort(),
      original.map((value) => value.id).sort(),
    );
  });
  await test('Cross-space copies map label names into the target namespace and retain idempotency', async () => {
    const target = await api(actors.admin, '/spaces', 'POST', {
      name: 'Label copy target',
      slug: `label${suffix}`,
    });
    const existing = await api(actors.admin, '/pages', 'POST', {
      spaceId: target.id,
      title: 'Existing target labels',
    });
    const [targetLabel] = await api(actors.admin, '/pages/labels/add', 'POST', {
      pageId: existing.id,
      names: [names[0]],
    });
    const key = randomUUID();
    const duplicated = await copy(target.id, key);
    assert.equal((await copy(target.id, key)).id, duplicated.id);
    const assigned = await labels(duplicated.id);
    assert.deepEqual(
      assigned.map((value) => value.name).sort(),
      [...names].sort(),
    );
    assert(
      assigned.every(
        (value) =>
          value.spaceId === target.id &&
          !original.some((source) => source.id === value.id),
      ),
    );
    assert.equal(
      assigned.find((value) => value.name === names[0]).id,
      targetLabel.id,
    );
    const [duplicateChild] =
      await sql`select id from pages where parent_page_id=${duplicated.id} and deleted_at is null`;
    assert.deepEqual(
      (await labels(duplicateChild.id)).map((value) => value.name),
      [names[1]],
    );
    const denied = await fetchApi(
      actors.reader,
      '/pages/duplicate',
      'POST',
      { pageId: source.id },
      { headers: { 'Idempotency-Key': randomUUID() } },
    );
    assert.equal(denied.status(), 403);
  });
  await test('A label insertion failure rolls back copied pages and target label creation atomically', async () => {
    const target = await api(actors.admin, '/spaces', 'POST', {
      name: 'Label rollback target',
      slug: `labelroll${suffix}`,
    });
    assert(/^[a-f0-9-]{36}$/.test(target.id));
    await sql.unsafe(
      `create function public.docmost_synthetic_label_abort() returns trigger language plpgsql as $$ begin if exists(select 1 from pages where id=new.page_id and space_id='${target.id}'::uuid) then raise exception 'Synthetic label copy rejection'; end if; return new; end $$`,
    );
    await sql.unsafe(
      'create trigger docmost_synthetic_label_abort before insert on page_labels for each row execute function public.docmost_synthetic_label_abort()',
    );
    try {
      const failed = await fetchApi(
        actors.admin,
        '/pages/duplicate',
        'POST',
        { pageId: source.id, spaceId: target.id },
        { headers: { 'Idempotency-Key': randomUUID() } },
      );
      assert.equal(failed.status(), 500);
      assert.equal(
        (await sql`select id from pages where space_id=${target.id}`).length,
        0,
      );
      assert.equal(
        (await sql`select id from labels where space_id=${target.id}`).length,
        0,
      );
    } finally {
      await sql.unsafe(
        'drop trigger docmost_synthetic_label_abort on page_labels',
      );
      await sql.unsafe('drop function public.docmost_synthetic_label_abort()');
    }
    assert((await copy(target.id)).id);
  });
}
