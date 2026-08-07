import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const require = createRequire('/app/apps/server/package.json');
const bcrypt = require('bcrypt');
const postgres = require('postgres');
const jwt = require('jsonwebtoken');

const password = process.env.ACL_AUDIT_PASSWORD;
const runId = process.env.ACL_AUDIT_RUN_ID;

if (!password || !runId) {
  throw new Error('ACL_AUDIT_PASSWORD and ACL_AUDIT_RUN_ID are required');
}

const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.searchParams.delete('schema');
const sql = postgres(databaseUrl.toString(), { max: 1 });
const passwordHash = await bcrypt.hash(password, 12);
const attachmentPayload = `ACL audit fixture ${runId}\n`;
const attachmentSize = Buffer.byteLength(attachmentPayload);

const pageContent = (text) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    },
  ],
});

const result = await sql.begin(async (tx) => {
  const [workspaceA] = await tx`
    insert into workspaces (name, hostname, created_at)
    values (${`ACL Audit A ${runId}`}, ${`acl-a-${runId}`}, '1900-01-01T00:00:00Z')
    returning id, name
  `;
  const [workspaceB] = await tx`
    insert into workspaces (name, hostname, created_at)
    values (${`ACL Audit B ${runId}`}, ${`acl-b-${runId}`}, '1900-01-02T00:00:00Z')
    returning id, name
  `;

  const insertUser = async (workspaceId, key, role = 'member') => {
    const [user] = await tx`
      insert into users (
        name, email, email_verified_at, password, role, workspace_id,
        locale, last_login_at
      ) values (
        ${`ACL ${key} ${runId}`},
        ${`acl-${runId}-${key}@example.invalid`},
        now(), ${passwordHash}, ${role}, ${workspaceId}, 'en-US', now()
      )
      returning id, email, role, workspace_id
    `;
    return user;
  };

  const usersA = {
    owner: await insertUser(workspaceA.id, 'owner', 'owner'),
    workspaceAdmin: await insertUser(workspaceA.id, 'workspace-admin', 'admin'),
    spaceAdmin: await insertUser(workspaceA.id, 'space-admin'),
    editor: await insertUser(workspaceA.id, 'editor'),
    viewer: await insertUser(workspaceA.id, 'viewer'),
    groupMember: await insertUser(workspaceA.id, 'group-member'),
    otherSpace: await insertUser(workspaceA.id, 'other-space'),
    revoked: await insertUser(workspaceA.id, 'revoked'),
  };
  const userB = await insertUser(workspaceB.id, 'tenant-b-owner', 'owner');

  const credentials = {};
  for (const [key, user] of Object.entries(usersA)) {
    const [session] = await tx`
      insert into user_sessions (
        user_id, workspace_id, device_name, user_agent, expires_at
      ) values (
        ${user.id}, ${workspaceA.id}, ${`ACL Audit ${key}`}, 'Docmost ACL audit harness', now() + interval '4 hours'
      )
      returning id
    `;
    credentials[key] = {
      authToken: jwt.sign(
        {
          sub: user.id,
          email: user.email,
          workspaceId: workspaceA.id,
          sessionId: session.id,
          type: 'access',
        },
        process.env.APP_SECRET,
        { algorithm: 'HS256', issuer: 'Docmost', expiresIn: '4h' },
      ),
      csrfToken: randomBytes(32).toString('hex'),
    };
  }

  const [tenantBSession] = await tx`
    insert into user_sessions (
      user_id, workspace_id, device_name, user_agent, expires_at
    ) values (
      ${userB.id}, ${workspaceB.id}, 'ACL Audit tenantB', 'Docmost ACL audit harness', now() + interval '4 hours'
    )
    returning id
  `;
  credentials.tenantB = {
    authToken: jwt.sign(
      {
        sub: userB.id,
        email: userB.email,
        workspaceId: workspaceB.id,
        sessionId: tenantBSession.id,
        type: 'access',
      },
      process.env.APP_SECRET,
      { algorithm: 'HS256', issuer: 'Docmost', expiresIn: '4h' },
    ),
    csrfToken: randomBytes(32).toString('hex'),
  };

  const [everyoneA] = await tx`
    insert into groups (name, description, is_default, workspace_id, creator_id)
    values ('Everyone', ${`ACL default group ${runId}`}, true, ${workspaceA.id}, ${usersA.owner.id})
    returning id, name
  `;
  const [aclGroupA] = await tx`
    insert into groups (name, description, is_default, workspace_id, creator_id)
    values (${`ACL Group ${runId}`}, 'Explicit ACL test group', false, ${workspaceA.id}, ${usersA.owner.id})
    returning id, name
  `;
  const [everyoneB] = await tx`
    insert into groups (name, description, is_default, workspace_id, creator_id)
    values ('Everyone', ${`ACL default group ${runId}`}, true, ${workspaceB.id}, ${userB.id})
    returning id, name
  `;

  for (const user of Object.values(usersA)) {
    await tx`insert into group_users (user_id, group_id) values (${user.id}, ${everyoneA.id})`;
  }
  await tx`insert into group_users (user_id, group_id) values (${usersA.groupMember.id}, ${aclGroupA.id})`;
  await tx`insert into group_users (user_id, group_id) values (${userB.id}, ${everyoneB.id})`;

  const insertSpace = async (workspaceId, creatorId, name, slug) => {
    const [space] = await tx`
      insert into spaces (name, slug, visibility, default_role, creator_id, workspace_id)
      values (${name}, ${slug}, 'private', 'reader', ${creatorId}, ${workspaceId})
      returning id, name, slug, workspace_id
    `;
    return space;
  };

  const spacesA = {
    general: await insertSpace(workspaceA.id, usersA.owner.id, 'General', `general-${runId}`),
    target: await insertSpace(workspaceA.id, usersA.owner.id, `ACL Target ${runId}`, `acl-target-${runId}`),
    other: await insertSpace(workspaceA.id, usersA.owner.id, `ACL Other ${runId}`, `acl-other-${runId}`),
  };
  const spaceB = await insertSpace(workspaceB.id, userB.id, `ACL Tenant B ${runId}`, `acl-b-${runId}`);

  await tx`update workspaces set default_space_id = ${spacesA.general.id} where id = ${workspaceA.id}`;
  await tx`update workspaces set default_space_id = ${spaceB.id} where id = ${workspaceB.id}`;

  const addUserToSpace = async (userId, spaceId, role, addedById) => {
    await tx`
      insert into space_members (user_id, space_id, role, added_by_id)
      values (${userId}, ${spaceId}, ${role}, ${addedById})
    `;
  };
  const addGroupToSpace = async (groupId, spaceId, role, addedById) => {
    await tx`
      insert into space_members (group_id, space_id, role, added_by_id)
      values (${groupId}, ${spaceId}, ${role}, ${addedById})
    `;
  };

  await addUserToSpace(usersA.owner.id, spacesA.general.id, 'admin', usersA.owner.id);
  await addGroupToSpace(everyoneA.id, spacesA.general.id, 'writer', usersA.owner.id);
  await addUserToSpace(usersA.owner.id, spacesA.target.id, 'admin', usersA.owner.id);
  await addUserToSpace(usersA.workspaceAdmin.id, spacesA.target.id, 'admin', usersA.owner.id);
  await addUserToSpace(usersA.spaceAdmin.id, spacesA.target.id, 'admin', usersA.owner.id);
  await addUserToSpace(usersA.editor.id, spacesA.target.id, 'writer', usersA.owner.id);
  await addUserToSpace(usersA.viewer.id, spacesA.target.id, 'reader', usersA.owner.id);
  await addUserToSpace(usersA.revoked.id, spacesA.target.id, 'reader', usersA.owner.id);
  await addGroupToSpace(aclGroupA.id, spacesA.target.id, 'reader', usersA.owner.id);
  await addUserToSpace(usersA.owner.id, spacesA.other.id, 'admin', usersA.owner.id);
  await addUserToSpace(usersA.otherSpace.id, spacesA.other.id, 'reader', usersA.owner.id);
  await addUserToSpace(userB.id, spaceB.id, 'admin', userB.id);
  await addGroupToSpace(everyoneB.id, spaceB.id, 'writer', userB.id);

  const insertPage = async ({ workspaceId, spaceId, creatorId, slug, title, text, parentPageId = null }) => {
    const [page] = await tx`
      insert into pages (
        slug_id, title, position, content, text_content, parent_page_id,
        creator_id, last_updated_by_id, space_id, workspace_id
      ) values (
        ${slug}, ${title}, 'a0', ${tx.json(pageContent(text))}, ${text}, ${parentPageId},
        ${creatorId}, ${creatorId}, ${spaceId}, ${workspaceId}
      )
      returning id, slug_id, title, parent_page_id, space_id, workspace_id
    `;
    return page;
  };

  const rootA = await insertPage({
    workspaceId: workspaceA.id,
    spaceId: spacesA.target.id,
    creatorId: usersA.owner.id,
    slug: `acl-root-${runId}`,
    title: `ACL Root ${runId}`,
    text: `acl-root-secret-${runId}`,
  });
  const childA = await insertPage({
    workspaceId: workspaceA.id,
    spaceId: spacesA.target.id,
    creatorId: usersA.owner.id,
    slug: `acl-child-${runId}`,
    title: `ACL Child ${runId}`,
    text: `acl-child-secret-${runId}`,
    parentPageId: rootA.id,
  });
  const grandchildA = await insertPage({
    workspaceId: workspaceA.id,
    spaceId: spacesA.target.id,
    creatorId: usersA.owner.id,
    slug: `acl-grandchild-${runId}`,
    title: `ACL Grandchild ${runId}`,
    text: `acl-grandchild-secret-${runId}`,
    parentPageId: childA.id,
  });
  const siblingA = await insertPage({
    workspaceId: workspaceA.id,
    spaceId: spacesA.target.id,
    creatorId: usersA.owner.id,
    slug: `acl-sibling-${runId}`,
    title: `ACL Sibling ${runId}`,
    text: `acl-sibling-secret-${runId}`,
  });
  const otherSpacePageA = await insertPage({
    workspaceId: workspaceA.id,
    spaceId: spacesA.other.id,
    creatorId: usersA.owner.id,
    slug: `acl-other-page-${runId}`,
    title: `ACL Other Space Page ${runId}`,
    text: `acl-other-space-secret-${runId}`,
  });
  const rootB = await insertPage({
    workspaceId: workspaceB.id,
    spaceId: spaceB.id,
    creatorId: userB.id,
    slug: `acl-tenant-b-root-${runId}`,
    title: `ACL Tenant B Root ${runId}`,
    text: `acl-tenant-b-secret-${runId}`,
  });
  const childB = await insertPage({
    workspaceId: workspaceB.id,
    spaceId: spaceB.id,
    creatorId: userB.id,
    slug: `acl-tenant-b-child-${runId}`,
    title: `ACL Tenant B Child ${runId}`,
    text: `acl-tenant-b-child-secret-${runId}`,
    parentPageId: rootB.id,
  });

  const databasePageA = await insertPage({
    workspaceId: workspaceA.id,
    spaceId: spacesA.target.id,
    creatorId: usersA.owner.id,
    slug: `acl-database-${runId}`,
    title: `ACL Database ${runId}`,
    text: `acl-database-secret-${runId}`,
  });
  const databaseRowPageA = await insertPage({
    workspaceId: workspaceA.id,
    spaceId: spacesA.target.id,
    creatorId: usersA.owner.id,
    slug: `acl-row-${runId}`,
    title: `ACL Row ${runId}`,
    text: `acl-row-secret-${runId}`,
    parentPageId: databasePageA.id,
  });
  const databasePageB = await insertPage({
    workspaceId: workspaceB.id,
    spaceId: spaceB.id,
    creatorId: userB.id,
    slug: `acl-tenant-b-database-${runId}`,
    title: `ACL Tenant B Database ${runId}`,
    text: `acl-tenant-b-database-secret-${runId}`,
  });
  const databaseRowPageB = await insertPage({
    workspaceId: workspaceB.id,
    spaceId: spaceB.id,
    creatorId: userB.id,
    slug: `acl-tenant-b-row-${runId}`,
    title: `ACL Tenant B Row ${runId}`,
    text: `acl-tenant-b-row-secret-${runId}`,
    parentPageId: databasePageB.id,
  });

  const [databaseA] = await tx`
    insert into databases (
      name, description, space_id, workspace_id, creator_id,
      last_updated_by_id, page_id
    ) values (
      ${`ACL Database ${runId}`}, 'Tenant A database fixture', ${spacesA.target.id},
      ${workspaceA.id}, ${usersA.owner.id}, ${usersA.owner.id}, ${databasePageA.id}
    )
    returning id, page_id, space_id, workspace_id
  `;
  const [databaseRowA] = await tx`
    insert into database_rows (database_id, workspace_id, page_id, created_by_id, updated_by_id)
    values (${databaseA.id}, ${workspaceA.id}, ${databaseRowPageA.id}, ${usersA.owner.id}, ${usersA.owner.id})
    returning id, database_id, page_id, workspace_id
  `;
  const [databaseB] = await tx`
    insert into databases (
      name, description, space_id, workspace_id, creator_id,
      last_updated_by_id, page_id
    ) values (
      ${`ACL Tenant B Database ${runId}`}, 'Tenant B database fixture', ${spaceB.id},
      ${workspaceB.id}, ${userB.id}, ${userB.id}, ${databasePageB.id}
    )
    returning id, page_id, space_id, workspace_id
  `;
  const [databaseRowB] = await tx`
    insert into database_rows (database_id, workspace_id, page_id, created_by_id, updated_by_id)
    values (${databaseB.id}, ${workspaceB.id}, ${databaseRowPageB.id}, ${userB.id}, ${userB.id})
    returning id, database_id, page_id, workspace_id
  `;

  const [commentB] = await tx`
    insert into comments (content, type, creator_id, page_id, workspace_id, space_id)
    values (
      ${tx.json(pageContent(`acl-tenant-b-comment-${runId}`))}, 'comment', ${userB.id},
      ${rootB.id}, ${workspaceB.id}, ${spaceB.id}
    )
    returning id, page_id, workspace_id
  `;

  const [{ id: attachmentAId }] = await tx`select gen_uuid_v7() as id`;
  const attachmentAPath = `${workspaceA.id}/files/${attachmentAId}/tenant-a-${runId}.txt`;
  const [attachmentA] = await tx`
    insert into attachments (
      id, file_name, file_path, file_size, file_ext, mime_type, type,
      creator_id, page_id, space_id, workspace_id, text_content
    ) values (
      ${attachmentAId}, ${`tenant-a-${runId}.txt`}, ${attachmentAPath}, ${attachmentSize}, '.txt', 'text/plain', 'file',
      ${usersA.owner.id}, ${rootA.id}, ${spacesA.target.id}, ${workspaceA.id}, ${`acl-tenant-a-attachment-${runId}`}
    )
    returning id, file_name, file_path, page_id, workspace_id
  `;

  const [{ id: attachmentBId }] = await tx`select gen_uuid_v7() as id`;
  const attachmentBPath = `${workspaceB.id}/files/${attachmentBId}/tenant-b-${runId}.txt`;
  const [attachmentB] = await tx`
    insert into attachments (
      id, file_name, file_path, file_size, file_ext, mime_type, type,
      creator_id, page_id, space_id, workspace_id, text_content
    ) values (
      ${attachmentBId}, ${`tenant-b-${runId}.txt`}, ${attachmentBPath}, ${attachmentSize}, '.txt', 'text/plain', 'file',
      ${userB.id}, ${rootB.id}, ${spaceB.id}, ${workspaceB.id}, ${`acl-tenant-b-attachment-${runId}`}
    )
    returning id, file_name, file_path, page_id, workspace_id
  `;

  const [shareB] = await tx`
    insert into shares (
      key, page_id, include_sub_pages, search_indexing, creator_id,
      space_id, workspace_id
    ) values (
      ${`acl-b-share-${runId}`}, ${rootB.id}, true, true, ${userB.id},
      ${spaceB.id}, ${workspaceB.id}
    )
    returning id, key, page_id, space_id, workspace_id
  `;

  return {
    runId,
    workspaces: { a: workspaceA, b: workspaceB },
    users: { ...usersA, tenantB: userB },
    credentials,
    groups: { everyoneA, aclGroupA, everyoneB },
    spaces: { ...spacesA, tenantB: spaceB },
    pages: {
      rootA,
      childA,
      grandchildA,
      siblingA,
      otherSpacePageA,
      rootB,
      childB,
      databasePageA,
      databaseRowPageA,
      databasePageB,
      databaseRowPageB,
    },
    databases: { databaseA, databaseRowA, databaseB, databaseRowB },
    attachments: { attachmentA, attachmentB },
    foreignObjects: { commentB, attachmentB, shareB },
  };
});

for (const attachment of Object.values(result.attachments)) {
  const absolutePath = path.join('/app/data/storage', attachment.file_path);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, attachmentPayload, 'utf8');
}

await sql.end();
process.stdout.write(`\nACL_AUDIT_MANIFEST=${JSON.stringify(result)}`);
