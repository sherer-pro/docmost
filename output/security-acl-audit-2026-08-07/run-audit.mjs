import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(path.resolve('package.json'));
const { chromium } = require('playwright');
const JSZip = require('jszip');

const baseUrl = process.env.ACL_AUDIT_BASE_URL ?? 'http://localhost:3000';
const typesenseUrl = process.env.ACL_AUDIT_TYPESENSE_URL;
const typesenseApiKey = process.env.ACL_AUDIT_TYPESENSE_API_KEY;
const outputDir = path.resolve('output/security-acl-audit-2026-08-07');
const seedPath = path.join(outputDir, 'seed-fixture.mjs');
const runId = randomBytes(4).toString('hex');
const auditPassword = randomBytes(24).toString('base64url');
const results = [];
const runtime = {
  runId,
  baseUrl,
  startedAt: new Date().toISOString(),
};
let fixture;

function redact(value) {
  return String(value ?? '').replaceAll(auditPassword, '[REDACTED]');
}

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function record({ name, actor, channel = 'api', expected, response, check, detail }) {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  const pass = check ? check(response) : expectedStatuses.includes(response.status);
  results.push({
    name,
    actor,
    channel,
    expected,
    actual: response.status,
    pass,
    detail: detail?.(response) ?? response.summary,
  });
  return pass;
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

function summarizeBody(body) {
  if (body == null) return null;
  if (typeof body === 'string') return body.slice(0, 160);
  if (Array.isArray(body)) return { type: 'array', length: body.length };
  if (typeof body === 'object') {
    const value = unwrap(body);
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    const message = body.message ?? body.error ?? value?.message ?? value?.error;
    return {
      keys: Object.keys(body).sort().slice(0, 20),
      ...(message ? { message: String(message).slice(0, 160) } : {}),
    };
  }
  return String(body);
}

class ApiClient {
  constructor(actor, cookies = {}) {
    this.actor = actor;
    this.cookies = cookies;
  }

  cookieHeader() {
    return Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  absorbCookies(headers) {
    const setCookies = headers.getSetCookie?.() ?? [];
    for (const setCookie of setCookies) {
      const pair = setCookie.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) this.cookies[pair.slice(0, index)] = pair.slice(index + 1);
    }
  }

  async request(method, urlPath, body, options = {}) {
    const headers = new Headers(options.headers ?? {});
    if (!headers.has('Accept')) headers.set('Accept', options.accept ?? 'application/json');
    if (Object.keys(this.cookies).length > 0) headers.set('Cookie', this.cookieHeader());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers.set('Origin', baseUrl);
      if (this.cookies.csrfToken) headers.set('x-csrf-token', decodeURIComponent(this.cookies.csrfToken));
    }
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: payload,
      redirect: 'manual',
      cache: options.cache ?? 'no-store',
    });
    this.absorbCookies(response.headers);
    const contentType = response.headers.get('content-type') ?? '';
    let responseBody;
    if (options.binary || contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
      responseBody = Buffer.from(await response.arrayBuffer());
    } else {
      const text = await response.text();
      try {
        responseBody = text ? JSON.parse(text) : null;
      } catch {
        responseBody = text;
      }
    }
    return {
      status: response.status,
      body: responseBody,
      headers: Object.fromEntries(response.headers.entries()),
      summary: summarizeBody(responseBody),
    };
  }

  get(urlPath, options) {
    return this.request('GET', urlPath, undefined, options);
  }

  post(urlPath, body, options) {
    return this.request('POST', urlPath, body, options);
  }

  patch(urlPath, body, options) {
    return this.request('PATCH', urlPath, body, options);
  }

  delete(urlPath, options) {
    return this.request('DELETE', urlPath, undefined, options);
  }
}

async function login(actor, email) {
  const client = new ApiClient(actor);
  const response = await client.post('/api/auth/login', { email, password: auditPassword });
  record({ name: 'login', actor, expected: 200, response });
  if (response.status !== 200 || !client.cookies.authToken || !client.cookies.csrfToken) {
    throw new Error(`Login failed for ${actor}: ${response.status}`);
  }
  return client;
}

async function sessionClient(actor, credential) {
  const client = new ApiClient(actor, {
    authToken: credential.authToken,
    csrfToken: credential.csrfToken,
  });
  const response = await client.get('/api/users/me');
  record({ name: 'session-bound authentication', actor, expected: 200, response });
  if (response.status !== 200) throw new Error(`Session authentication failed for ${actor}: ${response.status}`);
  return client;
}

function seedFixture() {
  docker(['cp', seedPath, 'docmost-docmost-1:/tmp/acl-audit-seed.mjs']);
  const raw = docker([
    'exec',
    '-e',
    `ACL_AUDIT_PASSWORD=${auditPassword}`,
    '-e',
    `ACL_AUDIT_RUN_ID=${runId}`,
    'docmost-docmost-1',
    'node',
    '/tmp/acl-audit-seed.mjs',
  ]);
  const marker = 'ACL_AUDIT_MANIFEST=';
  const markerIndex = raw.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error('Seed manifest marker was not emitted');
  return JSON.parse(raw.slice(markerIndex + marker.length).trim());
}

function runSql(query) {
  return docker([
    'exec',
    'docmost-db-1',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'docmost',
    '-d',
    'docmost',
    '-Atc',
    query,
  ]).trim();
}

async function seedTypesenseFixture() {
  if (!typesenseUrl && !typesenseApiKey) {
    runtime.searchBackend = 'database';
    return;
  }
  if (!typesenseUrl || !typesenseApiKey) {
    throw new Error('Both ACL_AUDIT_TYPESENSE_URL and ACL_AUDIT_TYPESENSE_API_KEY are required');
  }

  const pageSpecs = [
    [fixture.pages.rootA, fixture.users.owner.id, `acl-root-secret-${runId}`],
    [fixture.pages.childA, fixture.users.owner.id, `acl-child-secret-${runId}`],
    [fixture.pages.grandchildA, fixture.users.owner.id, `acl-grandchild-secret-${runId}`],
    [fixture.pages.siblingA, fixture.users.owner.id, `acl-sibling-secret-${runId}`],
    [fixture.pages.otherSpacePageA, fixture.users.owner.id, `acl-other-space-secret-${runId}`],
    [fixture.pages.databasePageA, fixture.users.owner.id, `acl-database-secret-${runId}`],
    [fixture.pages.databaseRowPageA, fixture.users.owner.id, `acl-row-secret-${runId}`],
    [fixture.pages.rootB, fixture.users.tenantB.id, `acl-tenant-b-secret-${runId}`],
    [fixture.pages.childB, fixture.users.tenantB.id, `acl-tenant-b-child-secret-${runId}`],
    [fixture.pages.databasePageB, fixture.users.tenantB.id, `acl-tenant-b-database-secret-${runId}`],
    [fixture.pages.databaseRowPageB, fixture.users.tenantB.id, `acl-tenant-b-row-secret-${runId}`],
  ];
  const pageDocuments = pageSpecs.map(([page, creatorId, content]) => ({
    id: page.id,
    workspaceId: page.workspace_id,
    spaceId: page.space_id,
    creatorId,
    title: page.title,
    content,
    updatedAt: Date.now(),
  }));
  const attachmentDocuments = [
    {
      id: fixture.attachments.attachmentA.id,
      workspaceId: fixture.attachments.attachmentA.workspace_id,
      spaceId: fixture.spaces.target.id,
      pageId: fixture.pages.rootA.id,
      fileName: fixture.attachments.attachmentA.file_name,
      content: `acl-tenant-a-attachment-${runId}`,
      updatedAt: Date.now(),
    },
    {
      id: fixture.attachments.attachmentB.id,
      workspaceId: fixture.attachments.attachmentB.workspace_id,
      spaceId: fixture.spaces.tenantB.id,
      pageId: fixture.pages.rootB.id,
      fileName: fixture.attachments.attachmentB.file_name,
      content: `acl-tenant-b-attachment-${runId}`,
      updatedAt: Date.now(),
    },
  ];

  for (const [collection, documents] of [
    ['docmost_pages_v2', pageDocuments],
    ['docmost_attachments_v2', attachmentDocuments],
  ]) {
    for (const document of documents) {
      const response = await fetch(`${typesenseUrl}/collections/${collection}/documents?action=upsert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TYPESENSE-API-KEY': typesenseApiKey,
        },
        body: JSON.stringify(document),
      });
      if (!response.ok) {
        throw new Error(`Typesense seed failed for ${collection}: ${response.status}`);
      }
    }
  }
  runtime.searchBackend = 'typesense';
}

function cleanupFixture() {
  if (!fixture) return;
  const workspaceIds = [fixture.workspaces.a.id, fixture.workspaces.b.id];
  for (const id of workspaceIds) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`Unsafe workspace id: ${id}`);
  }
  const scope = `('${workspaceIds[0]}'::uuid, '${workspaceIds[1]}'::uuid)`;
  runSql(`
    begin;
    delete from comments where workspace_id in ${scope};
    delete from attachments where workspace_id in ${scope};
    delete from shares where workspace_id in ${scope};
    delete from pages where workspace_id in ${scope};
    delete from space_members where space_id in (select id from spaces where workspace_id in ${scope});
    delete from group_users where group_id in (select id from groups where workspace_id in ${scope});
    update workspaces set default_space_id = null where id in ${scope};
    delete from groups where workspace_id in ${scope};
    delete from spaces where workspace_id in ${scope};
    delete from workspaces where id in ${scope};
    commit;
  `);
  for (const id of workspaceIds) {
    const storagePath = `/app/data/storage/${id}`;
    docker([
      'exec',
      '-e',
      `ACL_STORAGE_PATH=${storagePath}`,
      'docmost-docmost-1',
      'node',
      '-e',
      "const fs=require('fs');const path=require('path');const p=path.resolve(process.env.ACL_STORAGE_PATH);const root='/app/data/storage/';if(!p.startsWith(root)||!/^\\/[a-z0-9/_-]+$/i.test(p))throw new Error('unsafe path');fs.rmSync(p,{recursive:true,force:true});",
    ]);
  }
}

async function createTemporaryPage(owner, title) {
  const response = await owner.post('/api/pages', {
    title,
    spaceId: fixture.spaces.target.id,
    content: `Temporary audit page ${runId}`,
    format: 'markdown',
  });
  if (response.status !== 200) throw new Error(`Cannot create temporary page: ${response.status}`);
  return unwrap(response.body);
}

async function publicAndTenantChecks(anonymous, owner) {
  const foreignShareId = fixture.foreignObjects.shareB.id;
  const randomId = randomUUID();
  const foreignInfo = await anonymous.get(`/api/shares/info?shareId=${foreignShareId}`);
  const randomInfo = await anonymous.get(`/api/shares/info?shareId=${randomId}`);
  record({ name: 'foreign share info is tenant-scoped', actor: 'anonymous', expected: 404, response: foreignInfo });
  record({
    name: 'foreign share oracle matches nonexistent share',
    actor: 'anonymous',
    expected: 404,
    response: foreignInfo,
    check: () => foreignInfo.status === randomInfo.status && JSON.stringify(foreignInfo.summary) === JSON.stringify(randomInfo.summary),
    detail: () => ({ foreign: foreignInfo.summary, nonexistent: randomInfo.summary, nonexistentStatus: randomInfo.status }),
  });

  const foreignPageInfo = await anonymous.get(`/api/shares/page-info?shareId=${foreignShareId}`);
  record({ name: 'foreign public page is tenant-scoped', actor: 'anonymous', expected: 404, response: foreignPageInfo });

  const shareCreate = await owner.post('/api/shares/actions/create', {
    pageId: fixture.pages.rootA.id,
    includeSubPages: true,
    searchIndexing: true,
  });
  record({ name: 'create public share', actor: 'owner', expected: 200, response: shareCreate });
  const share = unwrap(shareCreate.body);
  if (!share?.id) return;

  const beforeDisable = await anonymous.get(`/api/shares/page-info?shareId=${share.id}`);
  record({ name: 'public share read before disable', actor: 'anonymous', expected: 200, response: beforeDisable });
  results.push({
    name: 'public share response is non-cacheable',
    actor: 'anonymous',
    channel: 'cache',
    expected: 'private, no-store',
    actual: beforeDisable.headers['cache-control'] ?? null,
    pass: (beforeDisable.headers['cache-control'] ?? '').includes('no-store'),
    detail: { cacheControl: beforeDisable.headers['cache-control'] ?? null },
  });
  const publicSearch = await anonymous.post('/api/search/share-search', {
    query: `acl-root-secret-${runId}`,
    shareId: share.id,
    limit: 20,
  });
  record({ name: 'public share search', actor: 'anonymous', expected: 200, response: publicSearch });
  results.push({
    name: 'public share search is non-cacheable',
    actor: 'anonymous',
    channel: 'cache',
    expected: 'private, no-store',
    actual: publicSearch.headers['cache-control'] ?? null,
    pass: (publicSearch.headers['cache-control'] ?? '').includes('no-store'),
    detail: { cacheControl: publicSearch.headers['cache-control'] ?? null },
  });
  const publicAttachment = await anonymous.get(
    `/api/attachments/files/public/${fixture.attachments.attachmentA.id}/${encodeURIComponent(fixture.attachments.attachmentA.file_name)}`,
    { binary: true },
  );
  record({ name: 'public attachment read before disable', actor: 'anonymous', channel: 'attachment/public', expected: 200, response: publicAttachment });
  results.push({
    name: 'public attachment response is non-cacheable',
    actor: 'anonymous',
    channel: 'cache',
    expected: 'private, no-store',
    actual: publicAttachment.headers['cache-control'] ?? null,
    pass: (publicAttachment.headers['cache-control'] ?? '').includes('no-store'),
    detail: { cacheControl: publicAttachment.headers['cache-control'] ?? null },
  });

  const neutralSpacePolicy = await owner.patch(`/api/spaces/${fixture.spaces.target.id}`, { disablePublicSharing: null });
  record({ name: 'clear space sharing override', actor: 'owner', expected: 200, response: neutralSpacePolicy });
  const disableWorkspace = await owner.post('/api/workspace/update', { disablePublicSharing: true });
  record({ name: 'disable workspace public sharing', actor: 'owner', expected: 200, response: disableWorkspace });
  const afterWorkspaceDisable = await anonymous.get(`/api/shares/page-info?shareId=${share.id}`, { cache: 'reload' });
  record({ name: 'workspace share disable is immediate', actor: 'anonymous', expected: 404, response: afterWorkspaceDisable });
  const searchAfterWorkspaceDisable = await anonymous.post('/api/search/share-search', {
    query: `acl-root-secret-${runId}`,
    shareId: share.id,
    limit: 20,
  });
  record({
    name: 'workspace share disable removes public search immediately',
    actor: 'anonymous',
    channel: 'cache/search',
    expected: [200, 404],
    response: searchAfterWorkspaceDisable,
    check: (value) => [200, 404].includes(value.status) && !JSON.stringify(value.body).includes(`acl-root-secret-${runId}`),
    detail: (value) => ({ containsDisabledShareMarker: JSON.stringify(value.body).includes(`acl-root-secret-${runId}`) }),
  });
  const attachmentAfterWorkspaceDisable = await anonymous.get(
    `/api/attachments/files/public/${fixture.attachments.attachmentA.id}/${encodeURIComponent(fixture.attachments.attachmentA.file_name)}`,
    { binary: true, cache: 'reload' },
  );
  record({ name: 'workspace share disable invalidates attachment cookie immediately', actor: 'anonymous', channel: 'cache/attachment', expected: 404, response: attachmentAfterWorkspaceDisable });

  await owner.post('/api/workspace/update', { disablePublicSharing: false });
  const recreated = await owner.post('/api/shares/actions/create', {
    pageId: fixture.pages.rootA.id,
    includeSubPages: true,
    searchIndexing: true,
  });
  const recreatedShare = unwrap(recreated.body);
  record({ name: 'recreate share after workspace enable', actor: 'owner', expected: 200, response: recreated });
  if (recreatedShare?.id) {
    const disableSpace = await owner.patch(`/api/spaces/${fixture.spaces.target.id}`, { disablePublicSharing: true });
    record({ name: 'disable space public sharing', actor: 'owner', expected: 200, response: disableSpace });
    const afterSpaceDisable = await anonymous.get(`/api/shares/page-info?shareId=${recreatedShare.id}`, { cache: 'reload' });
    record({ name: 'space share disable is immediate', actor: 'anonymous', expected: 404, response: afterSpaceDisable });
    await owner.patch(`/api/spaces/${fixture.spaces.target.id}`, { disablePublicSharing: false });
  }
}

async function roleMatrix(clients, owner) {
  const roleExpectations = {
    workspaceAdmin: { read: true, write: true, moveDelete: true },
    spaceAdmin: { read: true, write: true, moveDelete: true },
    editor: { read: true, write: true, moveDelete: true },
    viewer: { read: true, write: false, moveDelete: false },
    groupMember: { read: true, write: false, moveDelete: false },
    otherSpace: { read: false, write: false, moveDelete: false },
    revoked: { read: true, write: false, moveDelete: false },
  };

  for (const [actor, expectation] of Object.entries(roleExpectations)) {
    const client = clients[actor];
    const page = await createTemporaryPage(owner, `ACL ${actor} delete ${runId}`);
    const read = await client.get(`/api/pages/info?pageId=${fixture.pages.rootA.id}`);
    record({ name: 'page read', actor, expected: expectation.read ? 200 : 403, response: read });

    const update = await client.post('/api/pages/actions/update', {
      pageId: fixture.pages.rootA.id,
      title: fixture.pages.rootA.title,
    });
    record({ name: 'page update', actor, expected: expectation.write ? 200 : 403, response: update });

    const move = await client.post('/api/pages/move', {
      pageId: page.id,
      position: 'a0000',
      parentPageId: null,
    });
    record({ name: 'page move', actor, expected: expectation.moveDelete ? 200 : 403, response: move });

    const remove = await client.post('/api/pages/actions/delete', { pageId: page.id });
    record({ name: 'page delete', actor, expected: expectation.moveDelete ? 200 : 403, response: remove });

    const search = await client.post('/api/search', {
      query: `acl-root-secret-${runId}`,
      spaceId: fixture.spaces.target.id,
      limit: 20,
    });
    record({
      name: 'search respects page access',
      actor,
      expected: expectation.read ? 200 : [403, 404],
      response: search,
      check: (value) => {
        if (!expectation.read) return [200, 403, 404].includes(value.status) && !JSON.stringify(value.body).includes(`acl-root-secret-${runId}`);
        return value.status === 200 && JSON.stringify(value.body).includes(fixture.pages.rootA.id);
      },
      detail: (value) => ({ containsRoot: JSON.stringify(value.body).includes(fixture.pages.rootA.id) }),
    });

    const attachment = fixture.attachments.attachmentA;
    const download = await client.get(`/api/attachments/files/${attachment.id}/${encodeURIComponent(attachment.file_name)}`, { binary: true });
    record({ name: 'attachment download', actor, expected: expectation.read ? 200 : 403, response: download });

    const database = await client.get(`/api/databases/${fixture.databases.databaseA.id}`);
    record({ name: 'database read', actor, expected: expectation.read ? 200 : [403, 404], response: database });

    const rows = await client.get(`/api/databases/${fixture.databases.databaseA.id}/rows`);
    record({
      name: 'database row hydration',
      actor,
      expected: expectation.read ? 200 : [403, 404],
      response: rows,
      check: (value) => expectation.read
        ? value.status === 200 && JSON.stringify(value.body).includes(fixture.pages.databaseRowPageA.id)
        : [403, 404].includes(value.status),
      detail: (value) => ({ containsRow: JSON.stringify(value.body).includes(fixture.pages.databaseRowPageA.id) }),
    });

    const comment = await client.post('/api/comments/actions/create', {
      pageId: fixture.pages.rootA.id,
      content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Comment ${actor} ${runId}` }] }] }),
      type: 'page',
    });
    record({ name: 'comment create follows write access', actor, expected: expectation.write ? 200 : 403, response: comment });
  }
}

async function memberVisibilityChecks(clients) {
  const members = await clients.groupMember.get('/api/workspace/members?limit=100');
  record({
    name: 'member directory is limited to shared groups or spaces',
    actor: 'groupMember',
    channel: 'member-visibility',
    expected: 200,
    response: members,
    check: (value) => {
      const serialized = JSON.stringify(value.body);
      return value.status === 200
        && serialized.includes(fixture.users.groupMember.id)
        && serialized.includes(fixture.users.viewer.id)
        && !serialized.includes(fixture.users.otherSpace.id)
        && !serialized.includes(fixture.users.tenantB.id);
    },
    detail: (value) => ({
      seesSelf: JSON.stringify(value.body).includes(fixture.users.groupMember.id),
      seesSharedSpaceMember: JSON.stringify(value.body).includes(fixture.users.viewer.id),
      seesUnrelatedMember: JSON.stringify(value.body).includes(fixture.users.otherSpace.id),
      seesForeignTenantMember: JSON.stringify(value.body).includes(fixture.users.tenantB.id),
    }),
  });

  const groups = await clients.groupMember.get('/api/groups?limit=100');
  record({
    name: 'member group list hides Everyone and unrelated groups',
    actor: 'groupMember',
    channel: 'member-visibility',
    expected: 200,
    response: groups,
    check: (value) => {
      const serialized = JSON.stringify(value.body);
      return value.status === 200
        && serialized.includes(fixture.groups.aclGroupA.id)
        && !serialized.includes(fixture.groups.everyoneA.id)
        && !serialized.includes(fixture.groups.everyoneB.id);
    },
    detail: (value) => ({
      seesAclGroup: JSON.stringify(value.body).includes(fixture.groups.aclGroupA.id),
      seesEveryone: JSON.stringify(value.body).includes(fixture.groups.everyoneA.id),
      seesForeignEveryone: JSON.stringify(value.body).includes(fixture.groups.everyoneB.id),
    }),
  });

  const everyoneInfo = await clients.groupMember.get(`/api/groups/info?groupId=${fixture.groups.everyoneA.id}`);
  record({ name: 'member cannot probe Everyone by object ID', actor: 'groupMember', channel: 'member-visibility/oracle', expected: 404, response: everyoneInfo });
  const foreignGroupInfo = await clients.groupMember.get(`/api/groups/info?groupId=${fixture.groups.everyoneB.id}`);
  record({ name: 'member cannot probe foreign tenant group by object ID', actor: 'groupMember', channel: 'cross-tenant/oracle', expected: 404, response: foreignGroupInfo });
}

async function exportAndSearchChecks(clients, owner) {
  const closeChild = await owner.post(`/api/pages/${fixture.pages.grandchildA.id}/actions/access/close-user`, {
    userId: fixture.users.viewer.id,
  });
  record({ name: 'deny viewer on export descendant', actor: 'owner', expected: 200, response: closeChild });

  const search = await clients.viewer.post('/api/search', {
    query: `acl-grandchild-secret-${runId}`,
    spaceId: fixture.spaces.target.id,
    limit: 20,
  });
  record({
    name: 'search hydration drops page immediately after ACL revoke',
    actor: 'viewer',
    channel: 'search/cache',
    expected: 200,
    response: search,
    check: (value) => value.status === 200 && !JSON.stringify(value.body).includes(fixture.pages.grandchildA.id),
    detail: (value) => ({ containsRevokedPage: JSON.stringify(value.body).includes(fixture.pages.grandchildA.id) }),
  });

  const exported = await clients.viewer.post('/api/pages/actions/export', {
    pageId: fixture.pages.childA.id,
    format: 'markdown',
    includeChildren: true,
    includeAttachments: false,
  }, { binary: true });
  let exportedText = '';
  let exportedFiles = [];
  if (exported.status === 200 && Buffer.isBuffer(exported.body)) {
    const archive = await JSZip.loadAsync(exported.body);
    exportedFiles = Object.values(archive.files).filter((entry) => !entry.dir).map((entry) => entry.name);
    const contents = await Promise.all(
      Object.values(archive.files)
        .filter((entry) => !entry.dir)
        .map((entry) => entry.async('string')),
    );
    exportedText = contents.join('\n');
  }
  record({
    name: 'export prunes denied descendant subtree',
    actor: 'viewer',
    channel: 'export',
    expected: 200,
    response: exported,
    check: (value) => value.status === 200
      && exportedText.includes(`acl-child-secret-${runId}`)
      && !exportedText.includes(`acl-grandchild-secret-${runId}`),
    detail: () => ({
      files: exportedFiles,
      containsRoot: exportedText.includes(`acl-child-secret-${runId}`),
      containsDeniedGrandchild: exportedText.includes(`acl-grandchild-secret-${runId}`),
    }),
  });
}

async function aclInheritanceChecks(clients, owner) {
  const closeViewer = await owner.post(`/api/pages/${fixture.pages.rootA.id}/actions/access/close-user`, {
    userId: fixture.users.viewer.id,
  });
  record({ name: 'deny viewer on parent', actor: 'owner', expected: 200, response: closeViewer });
  for (const page of [fixture.pages.rootA, fixture.pages.childA, fixture.pages.grandchildA]) {
    const response = await clients.viewer.get(`/api/pages/info?pageId=${page.id}`);
    record({ name: 'parent deny inherited by descendant', actor: 'viewer', expected: 403, response, detail: () => ({ pageId: page.id }) });
  }

  const newChildResponse = await owner.post('/api/pages', {
    title: `ACL New Child ${runId}`,
    parentPageId: fixture.pages.rootA.id,
    spaceId: fixture.spaces.target.id,
    content: `acl-new-child-secret-${runId}`,
    format: 'markdown',
  });
  record({ name: 'create descendant under denied parent', actor: 'owner', expected: 200, response: newChildResponse });
  const newChild = unwrap(newChildResponse.body);
  if (newChild?.id) {
    const response = await clients.viewer.get(`/api/pages/info?pageId=${newChild.id}`);
    record({ name: 'new descendant inherits deny', actor: 'viewer', expected: 403, response });
  }

  const grantGroup = await owner.post(`/api/pages/${fixture.pages.rootA.id}/actions/access/grant-group`, {
    groupId: fixture.groups.aclGroupA.id,
    role: 'writer',
  });
  record({ name: 'grant group writer on parent', actor: 'owner', expected: 200, response: grantGroup });
  const groupUpdate = await clients.groupMember.post('/api/pages/actions/update', {
    pageId: fixture.pages.childA.id,
    title: fixture.pages.childA.title,
  });
  record({ name: 'group writer grant inherited by child', actor: 'groupMember', expected: 200, response: groupUpdate });
  const groupDelete = await clients.groupMember.post('/api/pages/actions/delete', { pageId: fixture.pages.childA.id });
  record({ name: 'page ACL writer cannot move or delete', actor: 'groupMember', expected: 403, response: groupDelete });

  const grantOtherSpace = await owner.post(`/api/pages/${fixture.pages.rootA.id}/actions/access/grant-user`, {
    userId: fixture.users.otherSpace.id,
    role: 'reader',
  });
  record({ name: 'grant user from another space', actor: 'owner', expected: 200, response: grantOtherSpace });
  const directRead = await clients.otherSpace.get(`/api/pages/info?pageId=${fixture.pages.childA.id}`);
  record({ name: 'direct ACL read crosses space-membership boundary intentionally', actor: 'otherSpace', expected: 200, response: directRead });
}

async function crossTenantChecks(clients) {
  const admin = clients.workspaceAdmin;
  const randomId = randomUUID();
  const foreignPage = fixture.pages.rootB;
  const requests = [
    ['foreign page read', () => admin.get(`/api/pages/info?pageId=${foreignPage.id}`)],
    ['foreign page update', () => admin.post('/api/pages/actions/update', { pageId: foreignPage.id, title: 'tampered' })],
    ['foreign page delete', () => admin.post('/api/pages/actions/delete', { pageId: foreignPage.id })],
    ['foreign page move', () => admin.post('/api/pages/move', { pageId: foreignPage.id, position: 'a0000', parentPageId: null })],
    ['foreign database read', () => admin.get(`/api/databases/${fixture.databases.databaseB.id}`)],
    ['foreign database row context', () => admin.get(`/api/databases/rows/${fixture.pages.databaseRowPageB.id}/context`)],
    ['foreign comment read', () => admin.get(`/api/comments/info?commentId=${fixture.foreignObjects.commentB.id}`)],
    ['foreign comment delete', () => admin.post('/api/comments/actions/delete', { commentId: fixture.foreignObjects.commentB.id })],
    ['foreign attachment download', () => admin.get(`/api/attachments/files/${fixture.attachments.attachmentB.id}/${encodeURIComponent(fixture.attachments.attachmentB.file_name)}`, { binary: true })],
    ['foreign share delete', () => admin.post('/api/shares/actions/delete', { shareId: fixture.foreignObjects.shareB.id })],
    ['foreign page export', () => admin.post('/api/pages/actions/export', { pageId: foreignPage.id, format: 'markdown', includeChildren: true }, { binary: true })],
  ];
  for (const [name, invoke] of requests) {
    const response = await invoke();
    record({ name, actor: 'workspaceAdmin', channel: 'cross-tenant', expected: 404, response });
  }

  const foreignSearch = await admin.post('/api/search', {
    query: `acl-tenant-b-secret-${runId}`,
    limit: 20,
  });
  record({
    name: 'foreign search marker is absent',
    actor: 'workspaceAdmin',
    channel: 'cross-tenant',
    expected: 200,
    response: foreignSearch,
    check: (value) => value.status === 200 && !JSON.stringify(value.body).includes(`acl-tenant-b-secret-${runId}`),
    detail: (value) => ({ containsForeignMarker: JSON.stringify(value.body).includes(`acl-tenant-b-secret-${runId}`) }),
  });

  const foreignOracle = await admin.get(`/api/pages/info?pageId=${foreignPage.id}`);
  const randomOracle = await admin.get(`/api/pages/info?pageId=${randomId}`);
  record({
    name: 'foreign page oracle matches nonexistent page',
    actor: 'workspaceAdmin',
    channel: 'oracle',
    expected: 404,
    response: foreignOracle,
    check: () => foreignOracle.status === randomOracle.status && JSON.stringify(foreignOracle.summary) === JSON.stringify(randomOracle.summary),
    detail: () => ({ foreign: foreignOracle.summary, nonexistent: randomOracle.summary, nonexistentStatus: randomOracle.status }),
  });

  const batchForeign = await admin.patch(`/api/databases/${fixture.databases.databaseA.id}/rows/batch`, {
    rows: [{ pageId: fixture.pages.databaseRowPageB.id, operation: 'delete_row' }],
  });
  const batchRandom = await admin.patch(`/api/databases/${fixture.databases.databaseA.id}/rows/batch`, {
    rows: [{ pageId: randomId, operation: 'delete_row' }],
  });
  record({
    name: 'bulk endpoint does not distinguish foreign and nonexistent row',
    actor: 'workspaceAdmin',
    channel: 'bulk',
    expected: batchRandom.status,
    response: batchForeign,
    check: () => batchForeign.status === batchRandom.status && JSON.stringify(batchForeign.summary) === JSON.stringify(batchRandom.summary),
    detail: () => ({ foreign: batchForeign.summary, nonexistent: batchRandom.summary }),
  });

  const integrity = runSql(`
    select concat_ws(':',
      count(*) filter (where p.id = '${fixture.pages.rootB.id}'::uuid and p.deleted_at is null and p.title = '${fixture.pages.rootB.title.replaceAll("'", "''")}' ),
      (select count(*) from shares s where s.id = '${fixture.foreignObjects.shareB.id}'::uuid and s.deleted_at is null),
      (select count(*) from comments c where c.id = '${fixture.foreignObjects.commentB.id}'::uuid and c.deleted_at is null),
      (select count(*) from attachments a where a.id = '${fixture.attachments.attachmentB.id}'::uuid and a.deleted_at is null)
    ) from pages p where p.workspace_id = '${fixture.workspaces.b.id}'::uuid;
  `);
  results.push({
    name: 'foreign objects remain unchanged after destructive attempts',
    actor: 'workspaceAdmin',
    channel: 'database-integrity',
    expected: '1:1:1:1',
    actual: integrity,
    pass: integrity === '1:1:1:1',
    detail: { pageShareCommentAttachmentCounts: integrity },
  });
}

async function apiKeyChecks(clients, owner) {
  for (const actor of ['spaceAdmin', 'editor', 'viewer']) {
    const response = await clients[actor].post('/api/api-keys/create', {
      name: `Denied RAG ${actor} ${runId}`,
      spaceId: fixture.spaces.target.id,
      keyType: 'rag',
    });
    record({ name: 'non-workspace-admin cannot create API key', actor, expected: 403, response });
  }

  const ragCreate = await clients.workspaceAdmin.post('/api/api-keys/create', {
    name: `ACL RAG ${runId}`,
    spaceId: fixture.spaces.target.id,
    keyType: 'rag',
  });
  record({ name: 'workspace admin creates RAG key', actor: 'workspaceAdmin', expected: 200, response: ragCreate });
  const ragKey = unwrap(ragCreate.body);
  if (!ragKey?.token) return;

  const ragClient = new ApiClient('ragKey');
  const auth = { headers: { Authorization: `Bearer ${ragKey.token}` } };
  const ragOwn = await ragClient.get(`/api/rag/pages/${fixture.pages.rootA.id}`, auth);
  record({ name: 'RAG reads scoped page', actor: 'ragKey', channel: 'rag', expected: 200, response: ragOwn });
  const ragForeign = await ragClient.get(`/api/rag/pages/${fixture.pages.rootB.id}`, auth);
  record({ name: 'RAG rejects foreign page ID per documented scope contract', actor: 'ragKey', channel: 'rag', expected: 403, response: ragForeign });
  const ragList = await ragClient.get('/api/rag/pages?includeContent=true&limit=100', auth);
  record({
    name: 'RAG list excludes foreign markers',
    actor: 'ragKey',
    channel: 'rag',
    expected: 200,
    response: ragList,
    check: (value) => value.status === 200 && !JSON.stringify(value.body).includes(`acl-tenant-b-secret-${runId}`),
    detail: (value) => ({ containsForeignMarker: JSON.stringify(value.body).includes(`acl-tenant-b-secret-${runId}`) }),
  });

  const jwtOnRag = await clients.workspaceAdmin.get('/api/rag/pages?limit=10');
  record({ name: 'user JWT is rejected on RAG route', actor: 'workspaceAdmin', channel: 'rag', expected: 401, response: jwtOnRag });

  const mcpCreate = await clients.workspaceAdmin.post('/api/api-keys/create', {
    name: `ACL MCP ${runId}`,
    spaceId: fixture.spaces.target.id,
    keyType: 'mcp',
    allowedCapabilities: ['page.content.read', 'search.query', 'page.tree.read'],
  });
  record({ name: 'workspace admin creates MCP key', actor: 'workspaceAdmin', expected: 200, response: mcpCreate });
  const mcpKey = unwrap(mcpCreate.body);

  runSql(`
    update users set role = 'member' where id = '${fixture.users.workspaceAdmin.id}'::uuid and workspace_id = '${fixture.workspaces.a.id}'::uuid;
    update space_members set role = 'reader' where user_id = '${fixture.users.workspaceAdmin.id}'::uuid and space_id = '${fixture.spaces.target.id}'::uuid;
  `);
  const closeCreator = await owner.post(`/api/pages/${fixture.pages.rootA.id}/actions/access/close-user`, {
    userId: fixture.users.workspaceAdmin.id,
  });
  record({ name: 'deny downgraded API key creator', actor: 'owner', expected: 200, response: closeCreator });
  const ragDenied = await ragClient.get(`/api/rag/pages/${fixture.pages.rootA.id}`, auth);
  record({ name: 'RAG key never exceeds current creator ACL', actor: 'ragKey', channel: 'rag', expected: 403, response: ragDenied });
  const ragSibling = await ragClient.get(`/api/rag/pages/${fixture.pages.siblingA.id}`, auth);
  record({ name: 'RAG key retains creator-readable page', actor: 'ragKey', channel: 'rag', expected: 200, response: ragSibling });

  if (mcpKey?.token) {
    const mcpClient = new ApiClient('mcpKey');
    const mcpOptions = {
      headers: {
        Authorization: `Bearer ${mcpKey.token}`,
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
    };
    const list = await mcpClient.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, mcpOptions);
    record({ name: 'incoming MCP lists key-limited tools', actor: 'mcpKey', channel: 'mcp', expected: 200, response: list });
    const callOwn = await mcpClient.post('/mcp', {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'getPage', arguments: { pageId: fixture.pages.siblingA.id } },
    }, mcpOptions);
    record({ name: 'incoming MCP reads creator-readable page', actor: 'mcpKey', channel: 'mcp', expected: 200, response: callOwn });
    const callDenied = await mcpClient.post('/mcp', {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'getPage', arguments: { pageId: fixture.pages.rootA.id } },
    }, mcpOptions);
    record({
      name: 'incoming MCP follows downgraded creator ACL',
      actor: 'mcpKey',
      channel: 'mcp',
      expected: 200,
      response: callDenied,
      check: (value) => value.status === 200 && JSON.stringify(value.body).includes('isError') && !JSON.stringify(value.body).includes(`acl-root-secret-${runId}`),
      detail: (value) => ({ isError: JSON.stringify(value.body).includes('isError'), leakedMarker: JSON.stringify(value.body).includes(`acl-root-secret-${runId}`) }),
    });
    const callForeign = await mcpClient.post('/mcp', {
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'getPage', arguments: { pageId: fixture.pages.rootB.id } },
    }, mcpOptions);
    record({
      name: 'incoming MCP rejects foreign page ID',
      actor: 'mcpKey',
      channel: 'mcp',
      expected: 200,
      response: callForeign,
      check: (value) => value.status === 200 && JSON.stringify(value.body).includes('isError') && !JSON.stringify(value.body).includes(`acl-tenant-b-secret-${runId}`),
      detail: (value) => ({ isError: JSON.stringify(value.body).includes('isError'), leakedMarker: JSON.stringify(value.body).includes(`acl-tenant-b-secret-${runId}`) }),
    });
  }
}

async function uiChecks(clients) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const actor of ['workspaceAdmin', 'spaceAdmin', 'editor', 'viewer', 'groupMember', 'otherSpace', 'revoked']) {
      const client = clients[actor];
      const expectedRead = !['otherSpace'].includes(actor);
      const context = await browser.newContext();
      await context.addCookies(Object.entries(client.cookies).map(([name, value]) => ({ name, value, url: baseUrl })));
      const page = await context.newPage();
      const apiStatuses = [];
      page.on('response', (response) => {
        if (response.url().includes('/api/pages/info')) apiStatuses.push(response.status());
      });
      await page.goto(`${baseUrl}/s/${fixture.spaces.target.slug}/p/${fixture.pages.rootA.slug_id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (expectedRead) {
        await page.getByText(fixture.pages.rootA.title, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
      } else {
        await page.waitForTimeout(2_000);
      }
      const bodyText = (await page.locator('body').innerText()).slice(0, 4000);
      const canSeeTitle = bodyText.includes(fixture.pages.rootA.title);
      const editableCount = await page.locator('[contenteditable="true"]').count();
      await page.screenshot({ path: path.join(outputDir, `ui-${actor}-${runId}.png`), fullPage: true });
      results.push({
        name: 'role-isolated UI context',
        actor,
        channel: 'ui',
        expected: { canRead: expectedRead },
        actual: { canSeeTitle, editableCount, apiStatuses },
        pass: expectedRead ? canSeeTitle : !canSeeTitle,
        detail: { canSeeTitle, editableCount, apiStatuses },
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function openTabMembershipChecks(clients, owner) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(Object.entries(clients.viewer.cookies).map(([name, value]) => ({ name, value, url: baseUrl })));
  const page = await context.newPage();
  const pageInfoStatuses = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/pages/info')) pageInfoStatuses.push(response.status());
  });
  try {
    await page.goto(`${baseUrl}/s/${fixture.spaces.target.slug}/p/${fixture.pages.siblingA.slug_id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByText(fixture.pages.siblingA.title, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    const beforeText = await page.locator('body').innerText();
    results.push({
      name: 'open tab renders page before space membership removal',
      actor: 'viewer',
      channel: 'ui/cache',
      expected: true,
      actual: beforeText.includes(fixture.pages.siblingA.title),
      pass: beforeText.includes(fixture.pages.siblingA.title),
      detail: { pageInfoStatuses: [...pageInfoStatuses] },
    });

    const remove = await owner.post('/api/spaces/members/remove', {
      spaceId: fixture.spaces.target.id,
      userId: fixture.users.viewer.id,
    });
    record({ name: 'remove viewer space membership', actor: 'owner', channel: 'membership', expected: 200, response: remove });

    const apiAfter = await clients.viewer.get(`/api/pages/info?pageId=${fixture.pages.siblingA.id}`, { cache: 'reload' });
    record({ name: 'membership removal revokes API access immediately', actor: 'viewer', channel: 'membership/cache', expected: 403, response: apiAfter });
    const searchAfter = await clients.viewer.post('/api/search', {
      query: `acl-sibling-secret-${runId}`,
      spaceId: fixture.spaces.target.id,
      limit: 20,
    });
    record({
      name: 'membership removal revokes cached search hydration',
      actor: 'viewer',
      channel: 'membership/search/cache',
      expected: [200, 403, 404],
      response: searchAfter,
      check: (value) => [200, 403, 404].includes(value.status) && !JSON.stringify(value.body).includes(fixture.pages.siblingA.id),
      detail: (value) => ({ containsRevokedPage: JSON.stringify(value.body).includes(fixture.pages.siblingA.id) }),
    });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByText('Page not found', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    const afterText = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(outputDir, `ui-viewer-membership-revoked-${runId}.png`), fullPage: true });
    results.push({
      name: 'open tab loses page after membership removal and reload',
      actor: 'viewer',
      channel: 'ui/cache',
      expected: false,
      actual: afterText.includes(fixture.pages.siblingA.title),
      pass: !afterText.includes(fixture.pages.siblingA.title),
      detail: { canSeeTitle: afterText.includes(fixture.pages.siblingA.title), pageInfoStatuses },
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function revocationChecks(clients, owner) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(Object.entries(clients.revoked.cookies).map(([name, value]) => ({ name, value, url: baseUrl })));
  const page = await context.newPage();
  try {
    const before = await clients.revoked.get(`/api/pages/info?pageId=${fixture.pages.siblingA.id}`);
    record({ name: 'revoked user works before revocation', actor: 'revoked', expected: 200, response: before });
    await page.goto(`${baseUrl}/s/${fixture.spaces.target.slug}/p/${fixture.pages.siblingA.slug_id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByText(fixture.pages.siblingA.title, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    const beforeText = await page.locator('body').innerText();
    const deactivate = await owner.post('/api/workspace/members/deactivate', { userId: fixture.users.revoked.id });
    record({ name: 'deactivate member', actor: 'owner', expected: 200, response: deactivate });
    const after = await clients.revoked.get(`/api/pages/info?pageId=${fixture.pages.siblingA.id}`, { cache: 'reload' });
    record({ name: 'revoked session loses access immediately', actor: 'revoked', channel: 'cache/session', expected: 401, response: after });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByText('Page not found', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    const afterText = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(outputDir, `ui-revoked-session-${runId}.png`), fullPage: true });
    results.push({
      name: 'revoked open tab loses rendered private page after reload',
      actor: 'revoked',
      channel: 'ui/cache/session',
      expected: { before: true, after: false },
      actual: {
        before: beforeText.includes(fixture.pages.siblingA.title),
        after: afterText.includes(fixture.pages.siblingA.title),
      },
      pass: beforeText.includes(fixture.pages.siblingA.title) && !afterText.includes(fixture.pages.siblingA.title),
      detail: {
        beforeCanSeeTitle: beforeText.includes(fixture.pages.siblingA.title),
        afterCanSeeTitle: afterText.includes(fixture.pages.siblingA.title),
      },
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function tenantBReverseChecks(tenantB) {
  runSql(`
    begin;
    update workspaces set created_at = '1900-01-03T00:00:00Z' where id = '${fixture.workspaces.a.id}'::uuid;
    update workspaces set created_at = '1900-01-01T00:00:00Z' where id = '${fixture.workspaces.b.id}'::uuid;
    commit;
  `);
  try {
    const auth = await tenantB.get('/api/users/me');
    record({ name: 'tenant B session is valid on tenant B host resolution', actor: 'tenantB', channel: 'reverse-tenant', expected: 200, response: auth });
    const own = await tenantB.get(`/api/pages/info?pageId=${fixture.pages.rootB.id}`);
    record({ name: 'tenant B reads its own page', actor: 'tenantB', channel: 'reverse-tenant', expected: 200, response: own });
    const foreignRead = await tenantB.get(`/api/pages/info?pageId=${fixture.pages.rootA.id}`);
    record({ name: 'tenant B cannot read tenant A page', actor: 'tenantB', channel: 'reverse-tenant', expected: 404, response: foreignRead });
    const foreignUpdate = await tenantB.post('/api/pages/actions/update', { pageId: fixture.pages.rootA.id, title: 'tenant-b-tamper-attempt' });
    record({ name: 'tenant B cannot update tenant A page', actor: 'tenantB', channel: 'reverse-tenant/destructive', expected: 404, response: foreignUpdate });
    const foreignDatabase = await tenantB.get(`/api/databases/${fixture.databases.databaseA.id}`);
    record({ name: 'tenant B cannot read tenant A database', actor: 'tenantB', channel: 'reverse-tenant', expected: 404, response: foreignDatabase });
    const foreignAttachment = await tenantB.get(`/api/attachments/files/${fixture.attachments.attachmentA.id}/${encodeURIComponent(fixture.attachments.attachmentA.file_name)}`, { binary: true });
    record({ name: 'tenant B cannot download tenant A attachment', actor: 'tenantB', channel: 'reverse-tenant', expected: 404, response: foreignAttachment });
    const foreignSearch = await tenantB.post('/api/search', { query: `acl-root-secret-${runId}`, limit: 20 });
    record({
      name: 'tenant B search excludes tenant A marker',
      actor: 'tenantB',
      channel: 'reverse-tenant/search',
      expected: 200,
      response: foreignSearch,
      check: (value) => value.status === 200 && !JSON.stringify(value.body).includes(`acl-root-secret-${runId}`),
      detail: (value) => ({ containsTenantAMarker: JSON.stringify(value.body).includes(`acl-root-secret-${runId}`) }),
    });
    const integrity = runSql(`
      select count(*) from pages
      where id = '${fixture.pages.rootA.id}'::uuid
        and workspace_id = '${fixture.workspaces.a.id}'::uuid
        and title = '${fixture.pages.rootA.title.replaceAll("'", "''")}'
        and deleted_at is null;
    `);
    results.push({
      name: 'tenant A page remains unchanged after reverse destructive attempt',
      actor: 'tenantB',
      channel: 'reverse-tenant/database-integrity',
      expected: '1',
      actual: integrity,
      pass: integrity === '1',
      detail: { unchangedPageCount: integrity },
    });
  } finally {
    runSql(`
      begin;
      update workspaces set created_at = '1900-01-01T00:00:00Z' where id = '${fixture.workspaces.a.id}'::uuid;
      update workspaces set created_at = '1900-01-02T00:00:00Z' where id = '${fixture.workspaces.b.id}'::uuid;
      commit;
    `);
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  fixture = seedFixture();
  await seedTypesenseFixture();
  runtime.fixture = {
    workspaces: fixture.workspaces,
    spaces: fixture.spaces,
    users: Object.fromEntries(Object.entries(fixture.users).map(([key, user]) => [key, { id: user.id, role: user.role, workspace_id: user.workspace_id }])),
  };

  const owner = await sessionClient('owner', fixture.credentials.owner);
  const clients = {
    workspaceAdmin: await sessionClient('workspaceAdmin', fixture.credentials.workspaceAdmin),
    spaceAdmin: await sessionClient('spaceAdmin', fixture.credentials.spaceAdmin),
    editor: await sessionClient('editor', fixture.credentials.editor),
    viewer: await sessionClient('viewer', fixture.credentials.viewer),
    groupMember: await sessionClient('groupMember', fixture.credentials.groupMember),
    otherSpace: await sessionClient('otherSpace', fixture.credentials.otherSpace),
    revoked: await sessionClient('revoked', fixture.credentials.revoked),
  };
  const anonymous = new ApiClient('anonymous');
  const tenantB = new ApiClient('tenantB', {
    authToken: fixture.credentials.tenantB.authToken,
    csrfToken: fixture.credentials.tenantB.csrfToken,
  });

  await publicAndTenantChecks(anonymous, owner);
  await roleMatrix(clients, owner);
  await memberVisibilityChecks(clients);
  await uiChecks(clients);
  await exportAndSearchChecks(clients, owner);
  await aclInheritanceChecks(clients, owner);
  await crossTenantChecks(clients);
  await apiKeyChecks(clients, owner);
  await openTabMembershipChecks(clients, owner);
  await revocationChecks(clients, owner);
  await tenantBReverseChecks(tenantB);
}

let fatalError = null;
try {
  await main();
} catch (error) {
  fatalError = {
    name: error.name,
    message: redact(error.message),
    stack: redact(error.stack).split('\n').slice(0, 12),
  };
} finally {
  runtime.finishedAt = new Date().toISOString();
  runtime.fatalError = fatalError;
  runtime.summary = {
    total: results.length,
    passed: results.filter((item) => item.pass).length,
    failed: results.filter((item) => !item.pass).length,
  };
  await writeFile(path.join(outputDir, `baseline-${runId}.json`), JSON.stringify({ runtime, results }, null, 2));
  try {
    cleanupFixture();
    runtime.cleanup = 'completed';
  } catch (error) {
    runtime.cleanup = `failed: ${error.message}`;
  }
  await writeFile(path.join(outputDir, `baseline-${runId}.json`), JSON.stringify({ runtime, results }, null, 2));
}

process.stdout.write(JSON.stringify({
  report: path.join(outputDir, `baseline-${runId}.json`),
  summary: runtime.summary,
  fatalError,
  failed: results.filter((item) => !item.pass).map((item) => ({ name: item.name, actor: item.actor, channel: item.channel, expected: item.expected, actual: item.actual, detail: item.detail })),
  cleanup: runtime.cleanup,
}, null, 2));
