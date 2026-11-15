import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
const JSZip = createRequire(import.meta.url)('jszip');
import path from 'node:path';

const paragraph = (text) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const document = (text) => ({ type: 'doc', content: [paragraph(text)] });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function originalBytes(extension, text) {
  if (extension === '.bin') return Buffer.alloc(0);
  if (extension === '.png')
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
      'base64',
    );
  if (extension === '.svg')
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><text x="10" y="20">${text}</text></svg>`,
    );
  if (extension === '.pdf') {
    const stream = 'BT /F1 12 Tf 20 40 Td (Synthetic PDF original) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ];
    let result = '%PDF-1.4\n';
    const offsets = [0];
    for (const [i, object] of objects.entries()) {
      offsets.push(Buffer.byteLength(result));
      result += `${i + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(result);
    result += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join(
        '',
      )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(result);
  }
  if (extension === '.docx' || extension === '.xlsx') {
    const zip = new JSZip();
    const docx = extension === '.docx';
    const target = docx ? 'word/document.xml' : 'xl/workbook.xml';
    const type = docx
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
    zip.file(
      '[Content_Types].xml',
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${target}" ContentType="${type}"/>${docx ? '' : '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'}</Types>`,
    );
    zip.file(
      '_rels/.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`,
    );
    if (docx)
      zip.file(
        target,
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      );
    else {
      zip.file(
        target,
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      );
      zip.file(
        'xl/_rels/workbook.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      );
      zip.file(
        'xl/worksheets/sheet1.xml',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Synthetic workbook</t></is></c></row></sheetData></worksheet>',
      );
    }
    return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  }
  return Buffer.from(text);
}

// This fixture runs only inside the isolated application's owned database/storage.
export async function runMcpReadAcceptance({
  api,
  actors,
  space,
  parent,
  workspaceId,
  sql,
  test,
  baseURL,
  output,
  exactSecrets,
}) {
  const originalPolicy = await api(actors.admin, '/ai/tool-policy');
  const originalSpacePolicy = await api(
    actors.admin,
    `/spaces/${space.id}/ai/tool-policy`,
  );
  const capabilities = originalPolicy.catalog
    .filter((entry) => entry.exposures.includes('mcp'))
    .map((entry) => entry.capability);
  const keys = [];
  const policyBody = (view) => ({
    enabled: view.enabled,
    readOnly: view.readOnly,
    knowledgeOnly: view.knowledgeOnly,
    allowedCapabilities: view.allowedCapabilities,
  });
  await api(actors.admin, '/ai/tool-policy', 'PATCH', {
    ...policyBody(originalPolicy),
    enabled: true,
    allowedCapabilities: [
      ...new Set([...originalPolicy.allowedCapabilities, ...capabilities]),
    ],
  });
  await api(actors.admin, `/spaces/${space.id}/ai/tool-policy`, 'PUT', {
    allowedCapabilities: null,
  });
  const key = async (allowed = capabilities) => {
    // Create a member-owned key through the real admin-only API, then remove the temporary fixture role.
    const [actor] =
      await sql`select role from users where id=${actors.editor.id}`;
    await sql`update users set role='admin' where id=${actors.editor.id}`;
    let created;
    try {
      created = await api(actors.editor, '/api-keys/create', 'POST', {
        spaceId: space.id,
        keyType: 'mcp',
        name: 'Synthetic MCP read matrix',
        allowedCapabilities: allowed,
      });
    } finally {
      await sql`update users set role=${actor.role} where id=${actors.editor.id}`;
    }
    exactSecrets.add(created.token);
    keys.push(created);
    return created;
  };
  const rpc = async (token, name, args = {}) => {
    const response = await fetch(`${baseURL}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const text = await response.text();
    const payload =
      text.startsWith('event:') || text.startsWith('data:')
        ? text
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => JSON.parse(line.slice(5)))
            .find((value) => value.result || value.error)
        : JSON.parse(text);
    return {
      status: response.status,
      ...payload.result,
      protocolError: payload.error,
    };
  };
  const read = async (token, name, args = {}) => {
    const result = await rpc(token, name, args);
    assert.equal(result.status, 200, `${name} HTTP status`);
    assert(
      !result.isError && !result.protocolError,
      `${name} must return actual data`,
    );
    const serialized = result.content[0].text;
    assert(Buffer.byteLength(serialized) <= 32768, `${name} result budget`);
    return JSON.parse(serialized);
  };
  const collect = async (token, name, args, field = 'text') => {
    let cursor,
      result = '',
      rounds = 0;
    do {
      const part = await read(token, name, {
        ...args,
        ...(cursor ? { cursor } : {}),
      });
      result += part[field];
      assert(
        !part.nextCursor || part.nextCursor !== cursor,
        `${name} cursor must advance`,
      );
      cursor = part.nextCursor;
      assert(++rounds < 100, `${name} bounded continuation`);
    } while (cursor);
    return result;
  };
  try {
    const page = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      title: 'MCP bounded source',
    });
    const unicode = '\u0416\ud83d\ude42'.repeat(12000);
    const paragraphs = Array.from({ length: 600 }, (_, index) =>
      paragraph(`Section ${index}: ${'x'.repeat(20)}`),
    );
    const table = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [paragraph('Nested table cell')] },
          ],
        },
      ],
    };
    const pageDocument = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph('Before nested table')] },
          ],
        },
        { type: 'blockquote', content: [table] },
        paragraph(unicode),
        ...paragraphs,
      ],
    };
    await sql`update pages set content=${sql.json(pageDocument)}, settings=${sql.json({ status: 'draft', assigneeId: actors.editor.id, stakeholderIds: [actors.reader.id] })}, contributor_ids=${[actors.editor.id]}::uuid[] where id=${page.id}`;
    const [spaceRow] =
      await sql`select settings from spaces where id=${space.id}`;
    await sql`update spaces set settings=coalesce(settings,'{}'::jsonb) || ${sql.json({ documentFields: { status: true, assignee: true, stakeholders: true, aiRole: true } })} where id=${space.id}`;
    const labelId = randomUUID();
    await sql`insert into labels(id,workspace_id,space_id,name) values (${labelId},${workspaceId},${space.id},'MCP source label')`;
    await sql`insert into page_labels(page_id,label_id) values (${page.id},${labelId})`;
    const children = Array.from({ length: 601 }, (_, index) => ({
      id: randomUUID(),
      slug_id: randomUUID(),
      title: `MCP child ${index}`,
      position: `P${String(index).padStart(5, '0')}`,
      parent_page_id: parent.id,
      creator_id: actors.admin.id,
      last_updated_by_id: actors.admin.id,
      space_id: space.id,
      workspace_id: workspaceId,
      content: document(`Child ${index}`),
    }));
    await sql`insert into pages(id,slug_id,title,position,parent_page_id,creator_id,last_updated_by_id,space_id,workspace_id,content)
      select id,slug_id,title,position,parent_page_id,creator_id,last_updated_by_id,space_id,workspace_id,content
      from jsonb_to_recordset(${sql.json(children)}) x(id uuid,slug_id text,title text,position text,parent_page_id uuid,creator_id uuid,last_updated_by_id uuid,space_id uuid,workspace_id uuid,content jsonb)`;

    await test('MCP real HTTP preserves full Unicode page/node content and all outline references', async () => {
      const { token } = await key();
      const text = await collect(token, 'getPage', { pageId: page.id });
      assert(
        text.includes(unicode) && text.includes('Section 599:'),
        'Complete page text must survive byte pagination',
      );
      const outline = [];
      let cursor;
      do {
        const part = await read(token, 'getOutline', {
          pageId: page.id,
          ...(cursor ? { cursor } : {}),
        });
        outline.push(...part.items);
        cursor = part.nextCursor;
      } while (cursor);
      assert(outline.length > 600);
      const tableItem = outline.find((item) => item.type === 'table');
      const result = await read(token, 'getTable', {
        pageId: page.id,
        tableRef: `#${tableItem.index}`,
      });
      assert.deepEqual(result.cells, [['Nested table cell']]);
      const largeNode = outline.find(
        (item) => item.type === 'paragraph' && item.text.startsWith('\u0416'),
      );
      assert.deepEqual(
        JSON.parse(
          await collect(
            token,
            'getNode',
            { pageId: page.id, nodeId: `#${largeNode.index}` },
            'nodeJsonChunk',
          ),
        ),
        paragraph(unicode),
      );
      const first = await read(token, 'getPage', { pageId: page.id });
      await sql`update pages set content=${sql.json(document('Changed source'))} where id=${page.id}`;
      const stale = await rpc(token, 'getPage', {
        pageId: page.id,
        cursor: first.nextCursor,
      });
      assert.equal(stale.isError, true);
      assert.equal(stale.structuredContent.code, 'MCP_SOURCE_CHANGED');
      await sql`update pages set content=${sql.json(pageDocument)} where id=${page.id}`;
    });

    await test('MCP tree and direct children enumerate more than 500 pages without duplicates', async () => {
      const { token } = await key();
      for (const [name, args, field] of [
        ['getTree', { limit: 100 }, 'items'],
        ['getPageContext', { pageId: parent.id }, 'children'],
      ]) {
        const ids = [];
        let cursor;
        do {
          const part = await read(token, name, {
            ...args,
            ...(cursor ? { cursor } : {}),
          });
          ids.push(...part[field].map((item) => item.id));
          cursor = part.nextCursor;
        } while (cursor);
        assert.equal(new Set(ids).size, ids.length);
        for (const child of children)
          assert(
            ids.includes(child.id),
            'Every fixture child must be returned',
          );
      }
      const metadata = JSON.parse(
        await collect(
          token,
          'getPageMetadata',
          { pageId: page.id },
          'metadataJsonChunk',
        ),
      );
      assert.equal(metadata.customFields.status, 'draft');
      assert.equal(metadata.assignee.id, actors.editor.id);
      assert.equal(metadata.stakeholders[0].id, actors.reader.id);
      assert(metadata.creator?.name && metadata.lastUpdatedBy?.name);
      assert(metadata.labels.some((label) => label.id === labelId));
      assert(!JSON.stringify(metadata).includes('@example.test'));
    });

    const database = await api(actors.admin, '/databases', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      name: 'MCP large-cell fixture',
    });
    const property = await api(
      actors.admin,
      `/databases/${database.id}/properties`,
      'POST',
      { name: 'Large notes', type: 'multiline_text' },
    );
    const rowPage = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      parentPageId: database.pageId,
      title: 'MCP oversized first row',
    });
    await sql`insert into database_rows(database_id,workspace_id,page_id,created_by_id,updated_by_id) values (${database.id},${workspaceId},${rowPage.id},${actors.admin.id},${actors.admin.id})`;
    await sql`insert into database_cells(database_id,workspace_id,page_id,property_id,value) values (${database.id},${workspaceId},${rowPage.id},${property.id},${sql.json(unicode)})`;
    await test('MCP database discovery and oversized cells preserve the first row and complete value', async () => {
      const { token } = await key();
      assert.equal(
        (await read(token, 'getPageContext', { pageId: database.pageId })).page
          .databaseId,
        database.id,
      );
      assert(
        (
          await read(token, 'getDatabaseContext', { databaseId: database.id })
        ).properties.some((item) => item.id === property.id),
      );
      const rows = await read(token, 'listDatabaseRows', {
        databaseId: database.id,
        limit: 1,
      });
      assert.equal(rows.items[0].pageId, rowPage.id);
      assert.equal(
        rows.items[0].cells.find((cell) => cell.propertyId === property.id)
          .valueTruncated,
        true,
      );
      assert.equal(
        JSON.parse(
          await collect(
            token,
            'getDatabaseCellContent',
            { pageId: rowPage.id, propertyId: property.id },
            'valueJsonChunk',
          ),
        ),
        unicode,
      );
      await read(token, 'getDatabaseRowContext', { pageId: rowPage.id });
      const first = await read(token, 'getDatabaseCellContent', {
        pageId: rowPage.id,
        propertyId: property.id,
      });
      await sql`update database_properties set name='Changed property' where id=${property.id}`;
      assert.equal(
        (
          await rpc(token, 'getDatabaseCellContent', {
            pageId: rowPage.id,
            propertyId: property.id,
            cursor: first.nextCursor,
          })
        ).structuredContent.code,
        'MCP_SOURCE_CHANGED',
      );
      await sql`update database_properties set name='Large notes' where id=${property.id}`;
      await api(
        actors.admin,
        `/pages/${rowPage.id}/actions/access/close-user`,
        'POST',
        { userId: actors.editor.id },
      );
      assert.equal(
        (await read(token, 'listDatabaseRows', { databaseId: database.id }))
          .items.length,
        0,
      );
      assert.equal(
        (
          await rpc(token, 'getDatabaseCellContent', {
            pageId: rowPage.id,
            propertyId: property.id,
          })
        ).isError,
        true,
      );
      await api(
        actors.admin,
        `/pages/${rowPage.id}/actions/access/grant-user`,
        'POST',
        { userId: actors.editor.id, role: 'writer' },
      );
    });

    const commentId = randomUUID(),
      replyId = randomUUID(),
      historyId = randomUUID();
    await sql`insert into comments(id,page_id,space_id,workspace_id,creator_id,content,resolved_at,resolved_by_id) values (${commentId},${page.id},${space.id},${workspaceId},${actors.admin.id},${sql.json(document(unicode))},now(),${actors.admin.id})`;
    await sql`insert into comments(id,page_id,space_id,workspace_id,creator_id,parent_comment_id,content) values (${replyId},${page.id},${space.id},${workspaceId},${actors.reader.id},${commentId},${sql.json(document('Reply'))})`;
    await sql`insert into page_history(id,page_id,space_id,workspace_id,title,version,content) values (${historyId},${page.id},${space.id},${workspaceId},'Saved source',777,${sql.json(document(unicode))})`;
    await test('MCP comments, resolution/thread state and saved versions are completely readable', async () => {
      const { token } = await key();
      const comments = await read(token, 'listComments', { pageId: page.id });
      assert(
        comments.items.some(
          (comment) => comment.id === commentId && comment.resolvedAt,
        ),
      );
      assert(
        comments.items.some((comment) => comment.parentCommentId === commentId),
      );
      assert.equal(
        await collect(token, 'getComment', { pageId: page.id, commentId }),
        unicode,
      );
      assert(
        (await read(token, 'listPageHistory', { pageId: page.id })).items.some(
          (history) => history.id === historyId,
        ),
      );
      assert.equal(
        await collect(token, 'getPageVersion', { pageId: page.id, historyId }),
        unicode,
      );
    });

    const files = [];
    const storageRoot = path.join(output, 'runtime', 'data', 'storage');
    for (const extension of [
      '.txt',
      '.md',
      '.pdf',
      '.docx',
      '.xlsx',
      '.svg',
      '.png',
      '.bin',
    ]) {
      const id = randomUUID(),
        name = `original${extension}`,
        relative = `mcp-fixture/${id}/${name}`;
      // Pre-extracted fixtures test the read contract independently of extraction workers.
      const bytes = await originalBytes(extension, unicode);
      await mkdir(path.dirname(path.join(storageRoot, relative)), {
        recursive: true,
      });
      await writeFile(path.join(storageRoot, relative), bytes);
      const supported = ['.txt', '.md', '.pdf', '.docx'].includes(extension);
      await sql`insert into attachments(id,page_id,space_id,workspace_id,creator_id,file_name,file_path,file_size,file_ext,mime_type,type,text_content,content_index_status,content_index_version,content_indexed_at)
        values (${id},${page.id},${space.id},${workspaceId},${actors.admin.id},${name},${relative},${bytes.length},${extension},'application/octet-stream','file',${supported ? unicode : null},${supported ? 'ready' : 'skipped'},1,now())`;
      files.push({
        id,
        bytes,
        supported,
        absolutePath: path.join(storageRoot, relative),
      });
    }
    await test('MCP reads pre-extracted PDF DOCX TXT MD text and explicit unsupported states', async () => {
      const { token } = await key();
      for (const file of files) {
        if (file.supported)
          assert.equal(
            await collect(token, 'getAttachmentText', {
              attachmentId: file.id,
            }),
            unicode,
          );
        else
          assert.equal(
            (await read(token, 'getAttachmentText', { attachmentId: file.id }))
              .status,
            'unsupported',
          );
      }
    });
    await test('MCP original binary chunks reconstruct exact bytes and reject changed files', async () => {
      const { token } = await key();
      for (const file of files) {
        let cursor;
        const chunks = [];
        do {
          const part = await read(token, 'getAttachmentFileChunk', {
            attachmentId: file.id,
            ...(cursor ? { cursor } : {}),
          });
          const bytes = Buffer.from(part.data, 'base64');
          assert(bytes.length <= 16384);
          chunks.push(bytes);
          cursor = part.nextCursor;
        } while (cursor);
        assert.equal(sha(Buffer.concat(chunks)), sha(file.bytes));
      }
      const first = await read(token, 'getAttachmentFileChunk', {
        attachmentId: files[0].id,
      });
      const foreignCursor = await rpc(token, 'getAttachmentFileChunk', {
        attachmentId: files[1].id,
        cursor: first.nextCursor,
      });
      assert.equal(foreignCursor.structuredContent.code, 'MCP_INVALID_CURSOR');
      await writeFile(
        files[0].absolutePath,
        Buffer.alloc(files[0].bytes.length, 42),
      );
      assert.equal(
        (
          await rpc(token, 'getAttachmentFileChunk', {
            attachmentId: files[0].id,
            cursor: first.nextCursor,
          })
        ).structuredContent.code,
        'MCP_SOURCE_CHANGED',
      );
      await writeFile(files[0].absolutePath, files[0].bytes);
      await unlink(files[1].absolutePath);
      assert.equal(
        (
          await rpc(token, 'getAttachmentFileChunk', {
            attachmentId: files[1].id,
          })
        ).isError,
        true,
      );
      await writeFile(files[1].absolutePath, files[1].bytes);

      const metadataFirst = await read(token, 'getAttachmentFileChunk', {
        attachmentId: files[0].id,
      });
      await sql`update attachments set updated_at=now() where id=${files[0].id}`;
      const stale = await rpc(token, 'getAttachmentFileChunk', {
        attachmentId: files[0].id,
        cursor: metadataFirst.nextCursor,
      });
      assert.equal(stale.isError, true);
      assert.equal(stale.structuredContent.code, 'MCP_SOURCE_CHANGED');
    });

    await test('MCP enforces member ACL, exclusions, key capability revocation and scope on every chunk', async () => {
      const full = await key();
      const first = await read(full.token, 'getAttachmentFileChunk', {
        attachmentId: files[0].id,
      });
      await api(
        actors.admin,
        `/pages/${page.id}/actions/access/close-user`,
        'POST',
        { userId: actors.editor.id },
      );
      assert.equal(
        (
          await rpc(full.token, 'getAttachmentFileChunk', {
            attachmentId: files[0].id,
            cursor: first.nextCursor,
          })
        ).isError,
        true,
      );
      assert.equal(
        (await rpc(full.token, 'getComment', { pageId: page.id, commentId }))
          .isError,
        true,
      );
      await api(
        actors.admin,
        `/pages/${page.id}/actions/access/grant-user`,
        'POST',
        { userId: actors.editor.id, role: 'writer' },
      );
      const before = await api(
        actors.admin,
        `/spaces/${space.id}/ai/exclusions`,
      );
      await api(actors.admin, `/spaces/${space.id}/ai/exclusions`, 'PUT', {
        expectedRevision: before.revision,
        ragSearchDoneOnly: before.ragSearchDoneOnly,
        exclusions: [
          ...before.exclusions.map(({ pageId, includeDescendants }) => ({
            pageId,
            includeDescendants,
          })),
          { pageId: page.id, includeDescendants: false },
        ],
      });
      assert.equal(
        (
          await rpc(full.token, 'getAttachmentText', {
            attachmentId: files[0].id,
          })
        ).isError,
        true,
      );
      assert.equal(
        (
          await rpc(full.token, 'getPageVersion', {
            pageId: page.id,
            historyId,
          })
        ).isError,
        true,
      );
      const excluded = await api(
        actors.admin,
        `/spaces/${space.id}/ai/exclusions`,
      );
      await api(actors.admin, `/spaces/${space.id}/ai/exclusions`, 'PUT', {
        expectedRevision: excluded.revision,
        ragSearchDoneOnly: before.ragSearchDoneOnly,
        exclusions: before.exclusions.map(({ pageId, includeDescendants }) => ({
          pageId,
          includeDescendants,
        })),
      });

      const narrow = await key(['page.content.read']);
      assert.equal(
        (await rpc(narrow.token, 'listComments', { pageId: page.id })).isError,
        true,
      );
      await api(actors.admin, '/api-keys/update', 'POST', {
        apiKeyId: full.id,
        name: 'Narrowed fixture',
        allowedCapabilities: ['page.content.read'],
      });
      assert.equal(
        (
          await rpc(full.token, 'getAttachmentFileChunk', {
            attachmentId: files[0].id,
          })
        ).isError,
        true,
      );
      const otherSpace = await api(actors.admin, '/spaces', 'POST', {
        name: 'Foreign MCP fixture',
        slug: `foreign${randomUUID().slice(0, 8)}`,
      });
      const foreign = await api(actors.admin, '/pages', 'POST', {
        spaceId: otherSpace.id,
        title: 'Foreign content',
      });
      assert.equal(
        (await rpc(full.token, 'getPage', { pageId: foreign.id })).isError,
        true,
      );
      await api(actors.admin, '/api-keys/revoke', 'POST', {
        apiKeyId: narrow.id,
      });
      const revoked = await fetch(`${baseURL}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${narrow.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      assert.equal(revoked.status, 401);
    });
    await sql`update spaces set settings=${sql.json(spaceRow.settings)} where id=${space.id}`;
  } finally {
    for (const created of keys)
      await api(actors.admin, '/api-keys/revoke', 'POST', {
        apiKeyId: created.id,
      }).catch(() => {});
    await api(actors.admin, `/spaces/${space.id}/ai/tool-policy`, 'PUT', {
      allowedCapabilities: originalSpacePolicy.allowedCapabilities,
      readOnly: originalSpacePolicy.readOnly,
      knowledgeOnly: originalSpacePolicy.knowledgeOnly,
    });
    await api(
      actors.admin,
      '/ai/tool-policy',
      'PATCH',
      policyBody(originalPolicy),
    );
  }
}
