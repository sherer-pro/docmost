import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { request } from '../../client/e2e/database/api-context.mjs';

const repo = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(repo, 'apps/server/package.json'));
const { normalizeDatabaseViewState } = require('@docmost/api-contract');
const { generateKeyBetween } = require('fractional-indexing-jittered');
const JSZip = require('jszip');

export async function runLiveAcceptance({
  baseURL,
  collabURL,
  sql,
  report,
  output,
  exactSecrets,
}) {
  const actors = {};
  const contexts = [];
  const createActor = async (key) => {
    const api = await request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL, Referer: `${baseURL}/` },
    });
    contexts.push(api);
    actors[key] = { api };
    return actors[key];
  };
  const fetchApi = async (
    actor,
    endpoint,
    method = 'GET',
    data,
    options = {},
  ) => {
    const csrf = (await actor.api.storageState()).cookies.find(
      (cookie) => cookie.name === 'csrfToken',
    )?.value;
    return actor.api.fetch(`/api${endpoint}`, {
      method,
      ...(data !== undefined ? { data } : {}),
      headers: csrf ? { 'x-csrf-token': csrf } : {},
      ...options,
    });
  };
  const api = async (actor, endpoint, method = 'GET', data, options) => {
    const response = await fetchApi(actor, endpoint, method, data, options);
    assert(
      response.ok(),
      `${method} ${endpoint.split('?')[0]} returned ${response.status()}`,
    );
    if (response.status() === 204) return;
    const payload = await response.json();
    return payload?.data ?? payload;
  };
  const test = async (name, check) => {
    const started = performance.now();
    await check();
    report.tests.push({ name, passed: true, ms: performance.now() - started });
    console.log(`Passed: ${name}`);
  };
  const password = () => {
    const value = `Aa1!${randomBytes(18).toString('base64url')}`;
    exactSecrets.add(value);
    return value;
  };
  try {
    const admin = await createActor('admin');
    await api(admin, '/auth/setup', 'POST', {
      name: 'QA Administrator',
      email: 'qa-admin@example.test',
      password: password(),
      workspaceName: 'Isolated database acceptance',
      hostname: `qa${Date.now()}`,
    });
    const info = await api(admin, '/users/me');
    const workspaceId = info.workspace.id;
    admin.id = info.user.id;
    for (const [key, name] of [
      ['editor', 'QA Editor'],
      ['reader', 'QA Reader'],
    ]) {
      const email = `qa-${key}@example.test`;
      await api(admin, '/workspace/invites/create', 'POST', {
        emails: [email],
        role: 'member',
        groupIds: [],
      });
      const invites = await api(admin, '/workspace/invites?limit=100');
      const invitation = invites.items.find((item) => item.email === email);
      assert(invitation, 'Synthetic invitation missing');
      const linked = await api(admin, '/workspace/invites/link', 'POST', {
        invitationId: invitation.id,
      });
      const link = new URL(
        typeof linked === 'string' ? linked : linked.inviteLink,
      );
      const token = link.searchParams.get('token');
      exactSecrets.add(token);
      const actor = await createActor(key);
      await api(actor, '/workspace/invites/accept', 'POST', {
        invitationId: invitation.id,
        token,
        name,
        password: password(),
      });
      actor.id = (await api(actor, '/users/me')).user.id;
    }
    const space = await api(admin, '/spaces', 'POST', {
      name: 'Database acceptance',
      slug: `dbqa${randomBytes(4).toString('hex')}`,
    });
    for (const [key, role] of [
      ['editor', 'writer'],
      ['reader', 'reader'],
    ])
      await api(admin, '/spaces/members/add', 'POST', {
        spaceId: space.id,
        userIds: [actors[key].id],
        groupIds: [],
        role,
      });
    const parent = await api(admin, '/pages', 'POST', {
      spaceId: space.id,
      title: 'Acceptance parent',
    });
    const database = await api(admin, '/databases', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      name: 'Database acceptance',
    });
    const databasePage = await api(
      admin,
      `/pages/info?pageId=${database.pageId}`,
    );
    const otherDatabase = await api(admin, '/databases', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      name: 'Second database',
    });
    const otherPage = await api(
      admin,
      `/pages/info?pageId=${otherDatabase.pageId}`,
    );
    const hiddenParent = await api(admin, '/pages', 'POST', {
      spaceId: space.id,
      parentPageId: database.pageId,
      title: 'Restricted fixture branch',
    });
    const definitions = [
      ['Notes', 'multiline_text'],
      ['Amount', 'number'],
      ['Date', 'date'],
      ['Tags', 'multi_select'],
      ['URL', 'url'],
      ['Email', 'email'],
      ['Phone', 'phone'],
      ['Done', 'checkbox'],
      ['Status', 'select'],
      ['Assignee', 'user'],
      ['Page', 'page_reference'],
      ['Code', 'code'],
      ...Array.from({ length: 8 }, (_, index) => [
        `Text ${index}`,
        'multiline_text',
      ]),
    ];
    const properties = [];
    for (const [name, type] of definitions)
      properties.push(
        await api(admin, `/databases/${database.id}/properties`, 'POST', {
          name,
          type,
          ...(['select', 'multi_select'].includes(type)
            ? {
                settings: {
                  options: [
                    { value: 'a', label: 'Alpha', color: 'blue' },
                    { value: 'b', label: 'Beta', color: 'green' },
                  ],
                },
              }
            : type === 'number'
              ? { settings: { format: 'number', precision: 2 } }
              : {}),
        }),
      );
    const ids = Array.from({ length: 1000 }, () => randomUUID());
    let previous = null;
    const pages = ids.map((id, index) => {
      const position = generateKeyBetween(previous, null);
      previous = position;
      return {
        id,
        slug_id: randomUUID(),
        title: `Row ${String(index).padStart(4, '0')}`,
        position,
        parent_page_id: index < 100 ? hiddenParent.id : database.pageId,
        creator_id: admin.id,
        last_updated_by_id: admin.id,
        space_id: space.id,
        workspace_id: workspaceId,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: randomUUID() },
              content: [{ type: 'text', text: `Synthetic row ${index}` }],
            },
          ],
        },
      };
    });
    await sql`insert into pages(id,slug_id,title,position,parent_page_id,creator_id,last_updated_by_id,space_id,workspace_id,content) select id,slug_id,title,position,parent_page_id,creator_id,last_updated_by_id,space_id,workspace_id,content from jsonb_to_recordset(${JSON.stringify(pages)}::text::jsonb) x(id uuid,slug_id text,title text,position text,parent_page_id uuid,creator_id uuid,last_updated_by_id uuid,space_id uuid,workspace_id uuid,content jsonb)`;
    await sql`insert into database_rows(database_id,workspace_id,page_id,created_by_id,updated_by_id) select ${database.id}::uuid,${workspaceId}::uuid,id,${admin.id}::uuid,${admin.id}::uuid from pages where id=any(${ids}::uuid[])`;
    const valueFor = (type, index) =>
      type === 'number'
        ? index
        : type === 'date'
          ? { start: '2026-10-13' }
          : type === 'multi_select'
            ? index % 2
              ? ['a', 'b']
              : ['a']
            : type === 'select'
              ? 'a'
              : type === 'checkbox'
                ? index % 2 === 0
                : type === 'url'
                  ? 'https://example.test/path'
                  : type === 'email'
                    ? 'synthetic@example.test'
                    : type === 'phone'
                      ? '+1 555 0100'
                      : type === 'user' || type === 'page_reference'
                        ? null
                        : `Value ${index}`;
    const records = ids.flatMap((page_id, index) =>
      properties.map((property) => ({
        page_id,
        property_id: property.id,
        value: valueFor(property.type, index),
      })),
    );
    for (let offset = 0; offset < records.length; offset += 1000)
      await sql`insert into database_cells(database_id,workspace_id,page_id,property_id,value,created_by_id,updated_by_id) select ${database.id}::uuid,${workspaceId}::uuid,page_id,property_id,value,${admin.id}::uuid,${admin.id}::uuid from jsonb_to_recordset(${JSON.stringify(records.slice(offset, offset + 1000))}::text::jsonb) x(page_id uuid,property_id uuid,value jsonb)`;
    for (const key of ['editor', 'reader'])
      await api(
        admin,
        `/pages/${hiddenParent.id}/actions/access/close-user`,
        'POST',
        { userId: actors[key].id },
      );
    await api(admin, `/pages/${ids[100]}/actions/access/grant-user`, 'POST', {
      userId: actors.editor.id,
      role: 'reader',
    });
    const state = normalizeDatabaseViewState({
      sorts: [{ propertyId: properties[1].id, direction: 'asc' }],
    });
    const shared = await api(admin, `/databases/${database.id}/views`, 'POST', {
      name: 'Shared view',
      type: 'table',
      config: state,
    });
    for (const actor of Object.values(actors)) {
      await api(actor, '/users/update', 'POST', { locale: 'en-US' });
      await api(actor, '/users/update', 'POST', {
        fullPageWidth: true,
        emailEnabled: false,
        pushEnabled: false,
        pageEditModeByPageId: {
          [database.pageId]: 'edit',
          [otherDatabase.pageId]: 'edit',
        },
      });
    }
    const fixture = {
      databaseId: database.id,
      databasePageId: database.pageId,
      route: `/s/${space.slug}/db/${databasePage.slugId}`,
      otherDatabaseId: otherDatabase.id,
      otherRoute: `/s/${space.slug}/db/${otherPage.slugId}`,
      spaceId: space.id,
      workspaceId,
      ids,
      properties,
      viewId: shared.id,
      users: Object.fromEntries(
        Object.entries(actors).map(([key, actor]) => [key, actor.id]),
      ),
    };
    report.fixture = { rows: 1000, fields: 20, readableRows: 900 };
    const rows = (actor, view = state, extra = {}) =>
      api(
        actor,
        `/databases/${database.id}/rows?${new URLSearchParams({ limit: '100', viewState: JSON.stringify(view), ...extra })}`,
      );
    const summary = (actor, view = state) =>
      api(
        actor,
        `/databases/${database.id}/summary?${new URLSearchParams({ viewState: JSON.stringify(view) })}`,
      );
    const patch = (actor, index, cells) =>
      fetchApi(
        actor,
        `/databases/${database.id}/rows/${ids[index]}/cells`,
        'PATCH',
        { cells },
      );
    await test('real ACL before pagination and global summaries', async () => {
      const page = await rows(actors.editor);
      assert.equal(page.items.length, 100);
      assert.equal(page.items[0].pageId, ids[100]);
      assert.equal(page.items[0].canWrite, false);
      const totals = await summary(actors.reader, {
        ...state,
        calculations: { [properties[1].id]: 'sum' },
      });
      assert.equal(totals.count, 900);
      assert.equal(totals.values[properties[1].id], 494550);
      const denied = await patch(actors.editor, 100, [
        { propertyId: properties[0].id, value: 'Forbidden' },
      ]);
      assert.equal(denied.status(), 403);
      assert.equal(
        (
          await patch(actors.reader, 101, [
            { propertyId: properties[0].id, value: 'Forbidden' },
          ])
        ).status(),
        403,
      );
      assert.equal(
        (
          await patch(actors.editor, 0, [
            { propertyId: properties[0].id, value: 'Forbidden' },
          ])
        ).status(),
        403,
      );
    });
    await test('AND/OR filters, multiple sorts, groups and unique global totals', async () => {
      const view = {
        ...state,
        groupBy: properties[3].id,
        filter: {
          conjunction: 'and',
          conditions: [
            {
              conjunction: 'or',
              conditions: [102, 103].map((value) => ({
                propertyId: properties[1].id,
                operator: 'equals',
                value,
              })),
            },
          ],
        },
        sorts: [
          { propertyId: properties[1].id, direction: 'desc' },
          { propertyId: 'title', direction: 'asc' },
        ],
        calculations: { [properties[1].id]: 'sum' },
      };
      const totals = await summary(actors.editor, view);
      assert.equal(totals.count, 2);
      assert.equal(totals.values[properties[1].id], 205);
      assert.deepEqual(
        totals.groups.map((group) => group.count),
        [2, 1],
      );
      assert.deepEqual(
        (await rows(actors.editor, view)).items.map((row) => row.pageId),
        [ids[103], ids[102]],
      );
      const first = await rows(actors.editor);
      const second = await rows(actors.editor, state, {
        cursor: first.nextCursor,
      });
      assert.equal(
        new Set([...first.items, ...second.items].map((row) => row.pageId))
          .size,
        200,
      );
    });
    await test('HTTP cell and view revision conflicts preserve committed values', async () => {
      const payload = [
        { propertyId: properties[1].id, value: 955, expectedRevision: 1 },
      ];
      const responses = await Promise.all([
        patch(actors.editor, 955, payload),
        patch(actors.editor, 955, payload),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status()).sort(),
        [200, 409],
      );
      const responses2 = await Promise.all(
        ['First', 'Second'].map((name) =>
          fetchApi(
            actors.editor,
            `/databases/${database.id}/views/${shared.id}`,
            'PATCH',
            { name, config: state, expectedRevision: shared.revision },
          ),
        ),
      );
      assert.deepEqual(
        responses2.map((response) => response.status()).sort(),
        [200, 409],
      );
      const latest = (
        await api(actors.editor, `/databases/${database.id}/views`)
      ).find((view) => view.id === shared.id);
      await api(
        actors.editor,
        `/databases/${database.id}/views/${shared.id}`,
        'PATCH',
        {
          name: 'Shared view',
          config: state,
          expectedRevision: latest.revision,
        },
      );
    });
    await test('HTTP types and row atomicity reject invalid data', async () => {
      const invalid = await patch(actors.editor, 956, [
        { propertyId: properties[0].id, value: 'Must roll back' },
        { propertyId: properties[1].id, value: 'bad number' },
      ]);
      assert.equal(invalid.status(), 400);
      const [stored] =
        await sql`select value from database_cells where page_id=${ids[956]}::uuid and property_id=${properties[0].id}::uuid`;
      assert.equal(stored.value, 'Value 956');
      for (const [field, value] of [
        [2, { start: '2026-10-13', end: '2026-10-12' }],
        [3, ['unknown']],
        [4, 'javascript:alert(1)'],
        [5, 'invalid'],
        [6, 'no digits'],
      ])
        assert.equal(
          (
            await patch(actors.editor, 956, [
              { propertyId: properties[field].id, value },
            ])
          ).status(),
          400,
        );
    });
    await test('real partial batches report ACL failures and preserve successful rows', async () => {
      const result = await api(
        actors.editor,
        `/databases/${database.id}/rows/batch`,
        'PATCH',
        {
          rows: [
            {
              pageId: ids[100],
              operation: 'upsert_cells',
              cells: [{ propertyId: properties[0].id, value: 'Denied' }],
            },
            {
              pageId: ids[957],
              operation: 'upsert_cells',
              cells: [{ propertyId: properties[0].id, value: 'Batch saved' }],
            },
          ],
        },
      );
      assert.deepEqual(result.updatedRows, [ids[957]]);
      assert.deepEqual(result.failures, [
        { pageId: ids[100], code: 'forbidden' },
      ]);
    });
    await test('assignment outbox rolls back and delivers through real Redis workers', async () => {
      const [before] =
        await sql`select count(*)::int as count from queue_outbox where kind='notification_dispatch'`;
      assert.equal(
        (
          await patch(actors.editor, 958, [
            { propertyId: properties[9].id, value: { id: actors.reader.id } },
            { propertyId: properties[1].id, value: 'bad' },
          ])
        ).status(),
        400,
      );
      const [after] =
        await sql`select count(*)::int as count from queue_outbox where kind='notification_dispatch'`;
      assert.equal(after.count, before.count);
      assert.equal(
        (
          await patch(actors.editor, 958, [
            { propertyId: properties[9].id, value: { id: actors.reader.id } },
          ])
        ).status(),
        200,
      );
      const end = Date.now() + 20_000;
      let delivered = false;
      while (Date.now() < end) {
        const [count] =
          await sql`select count(*)::int as count from notifications where user_id=${actors.reader.id}::uuid and page_id=${ids[958]}::uuid`;
        if (count.count) {
          delivered = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      assert(delivered, 'Assignment notification was not delivered');
    });
    await test('real export and queued import preserve 1000 rows, 20 fields and view settings', async () => {
      const readableExport = await fetchApi(
        actors.editor,
        `/databases/${database.id}/export`,
        'POST',
        { format: 'docmost', includeChildren: true, includeAttachments: true },
      );
      assert.equal(readableExport.status(), 200);
      const readableZip = await JSZip.loadAsync(await readableExport.body());
      const readable = JSON.parse(
        await readableZip.file('docmost-data.json').async('string'),
      );
      assert.equal(readable.databaseRows.length, 900);
      assert(
        readable.databaseCells.every(
          (cell) => !ids.slice(0, 100).includes(cell.pageId),
        ),
      );
      const fullExport = await fetchApi(
        admin,
        `/databases/${database.id}/export`,
        'POST',
        { format: 'docmost', includeChildren: true, includeAttachments: true },
      );
      assert.equal(fullExport.status(), 200);
      const buffer = await fullExport.body();
      const zip = await JSZip.loadAsync(buffer);
      const original = JSON.parse(
        await zip.file('docmost-data.json').async('string'),
      );
      assert.equal(original.databaseRows.length, 1000);
      assert.equal(original.databaseCells.length, 20_000);
      const target = await api(admin, '/spaces', 'POST', {
        name: 'Imported acceptance',
        slug: `import${randomBytes(4).toString('hex')}`,
      });
      const preview = await api(
        admin,
        `/pages/actions/import-zip/preview?spaceId=${target.id}`,
        'POST',
        undefined,
        {
          multipart: {
            spaceId: target.id,
            source: 'docmost',
            file: {
              name: 'acceptance.zip',
              mimeType: 'application/zip',
              buffer,
            },
          },
        },
      );
      await api(admin, '/pages/actions/import-zip/confirm', 'POST', {
        fileTaskId: preview.fileTaskId,
        applyDocumentFields: false,
        applyDictionary: false,
        applyHeadingNumbering: false,
        applyTags: false,
        cleanupLegacyHeadingNumbers: true,
      });
      const end = Date.now() + 120_000;
      let task;
      while (Date.now() < end) {
        task = await api(admin, '/file-tasks/info', 'POST', {
          fileTaskId: preview.fileTaskId,
        });
        if (['success', 'failed'].includes(task.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.equal(
        task.status,
        'success',
        `Queued archive import did not complete: ${task.errorMessage ?? 'timeout'}`,
      );
      const [imported] =
        await sql`select id from databases where space_id=${target.id}::uuid and deleted_at is null`;
      assert(imported);
      assert.notEqual(imported.id, database.id);
      const importedProperties = await api(
        admin,
        `/databases/${imported.id}/properties`,
      );
      const importedViews = await api(admin, `/databases/${imported.id}/views`);
      const byName = Object.fromEntries(
        importedProperties.map((property) => [property.name, property]),
      );
      for (const property of properties) {
        assert.equal(byName[property.name].type, property.type);
        assert.deepEqual(byName[property.name].settings, property.settings);
      }
      assert.equal(importedViews[0].config.version, 2);
      assert.equal(
        importedViews[0].config.sorts[0].propertyId,
        byName.Amount.id,
      );
      const actual =
        await sql`select p.title,pr.name,c.value from database_cells c join pages p on p.id=c.page_id join database_properties pr on pr.id=c.property_id where c.database_id=${imported.id}::uuid`;
      assert.equal(actual.length, 20_000);
      const actualMap = new Map(
        actual.map((cell) => [`${cell.title}:${cell.name}`, cell.value]),
      );
      const oldProperties = new Map(
        original.databaseProperties.map((property) => [
          property.id,
          property.name,
        ]),
      );
      const oldPages = new Map(
        original.pages.map((page) => [page.id, page.title]),
      );
      for (const cell of original.databaseCells) {
        const restored = actualMap.get(
          `${oldPages.get(cell.pageId)}:${oldProperties.get(cell.propertyId)}`,
        );
        if (oldProperties.get(cell.propertyId) === 'Assignee' && cell.value)
          assert.equal(restored.id, actors.reader.id);
        else assert.deepEqual(restored, cell.value);
      }
      report.archive = {
        rows: 1000,
        fields: 20,
        cellsCompared: 20_000,
        aclExportRows: 900,
        queuedImport: true,
      };
    });
    await writeFile(
      path.join(output, 'api-results.json'),
      JSON.stringify(report.tests, null, 2),
    );
    if (!process.argv.includes('--api-only')) {
      const sessions = {};
      for (const [key, actor] of Object.entries(actors))
        sessions[key] = await actor.api.storageState();
      const child = spawn(
        process.execPath,
        [
          createRequire(path.join(repo, 'apps/client/package.json')).resolve(
            '@playwright/test/cli',
          ),
          'test',
          '--config',
          path.join(repo, 'apps/client/e2e/database/playwright.live.config.ts'),
          ...process.argv.slice(2),
        ],
        {
          cwd: path.join(repo, 'apps/client'),
          windowsHide: true,
          stdio: 'inherit',
          env: {
            ...process.env,
            DATABASE_LIVE_URL: baseURL,
            DATABASE_LIVE_OUTPUT: output,
            DATABASE_LIVE_FIXTURE: JSON.stringify(fixture),
            DATABASE_LIVE_SESSIONS: JSON.stringify(sessions),
          },
        },
      );
      const [code] = await once(child, 'exit');
      assert.equal(code, 0, 'Live browser acceptance failed');
    }
    await writeFile(
      path.join(output, 'api-results.json'),
      JSON.stringify(report.tests, null, 2),
    );
  } finally {
    for (const api of contexts) await api.dispose();
  }
}
