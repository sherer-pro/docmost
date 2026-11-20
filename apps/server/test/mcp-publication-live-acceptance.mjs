import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cells =
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="Start" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="40" as="geometry"/></mxCell>' +
  '<mxCell id="b" value="Finish" vertex="1" parent="1"><mxGeometry x="150" y="20" width="80" height="40" as="geometry"/></mxCell>' +
  '<mxCell id="e" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell></root>';
const model = Buffer.from(
  '<mxfile>\r\n<!--' +
    'x'.repeat(155 * 1024) +
    '-->\r\n' +
    ['First', 'Second']
      .map(
        (name) =>
          `<diagram id="${name}" name="${name}"><mxGraphModel>${cells}</mxGraphModel></diagram>`,
      )
      .join('\n') +
    '\n</mxfile>',
);
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAPAAAABQCAIAAACoK28rAAADwklEQVR4nO3bP0jjYBiA8UQPai3aDIo61MFZLeoiongO1kWKDnYT/0wizi4iXZ0q6CB0qLMguDhIEUFBXMStqINTtkoVi4Md9Du4YChXmlYu1Pj2+U2heQNJvqexCNGVUhogRcN3nwDgJoKGKAQNUQgaohA0RCFoiELQEIWgIQpBQxSChigEDVEIGqIQNEQhaIhC0BCFoCEKQUMUgoYoBA1Rfjnv1nVdqzM/7iVL1ugLQf/EBa7DOFgjGz85IApBQxSChigEDVEIGqIQNEQhaIhC0BCFoCEKQUMUgoYoBA1RXA765uYmEolMTExMTk6apqlp2tbWVsWjqpmBW5qbm39/SiQSmUxmb2+v3HC5vYZheHRFlKOKA/8Ih8OmaSqlDg8PY7GYUioYDFY8qpqZ2vjq9f7Ecw66cbe/ccmcr9flJ3Q2m317e9M0LRqNrq2txePx19fXSCSSyWRGR0d7e3u3t7etScMwlpaWdnZ27Bl3zwTVsx+3hmFsbGyMj4+Hw+Gjo6Pivbu7uwMDA4ODg+l02vrcmuzr67MnPeF/vg2l9vf3Ozs7l5eXz87Oir/KKysrFxcXuVyuq6vL+rypqenk5KR4xgu8/4QuPcP/f0IHPz/x+/2JREIp9fDwEAqFive2t7fn8/nb29v5+Xlr+azJ+/t7e7I2nK/X5aCVUk9PT6lUqr+/Px6P27cjn88nk8n19fVAIGCNBQKB9/d3a5ugq1f6JPrqGvn9/vFPd3d3xfff5/M9Pz9b262trcWrs7CwMDMzk06nHSalBZ3NZi8vL+3tjo4O+3ZMTU0lk0nTNFtaWkojJujqlf6BdfEJ3fK5OsUf2hvn5+ezs7OLi4vlJmvD+Xorv4JVPV3XY7HY1dVVKBTK5XLd3d2apn38dX19fXBw8Pj4WCgUSg+0ZhoaPPE/xJ/1Fpa7Z9tQZgleXl6i0ejp6enQ0FBPT4/D5LdzM+i2trZkMjk3N+f3+xsbG1OplKZpY2Nj0Wh0dXV1ZGQkHA4bhlEoFHw+X/GB1szx8bHmAR5/P++fgpVSNfgGBoPB6enp4eHhj4+Pzc1NzcN05/XT9QoDwnj/eu187fP0/jm7y/l63XxCozbqKt+v8ugvIZRDzc4IGqIQNEQhaIhC0BCFoCEKQUMUgoYoBA1RCBqiEDREIWiIQtAQhaAhCkFDFIKGKL+EvWNXn1gjW329vQPx+MkBUQgaohA0RCFoiELQEIWgIQpBQxSChigEDVEIGqIQNEQhaIhC0BCFoCEKQUMUgoYoBA1RCBqaJH8AAmP067elf0oAAAAASUVORK5CYII=';

export async function runMcpPublicationAcceptance({
  api,
  editor,
  writer,
  reader,
  space,
  parent,
  call,
  success,
  prepare,
  recover,
  sql,
  test,
  output,
  createKey,
}) {
  const read = (name, args) => success(writer, name, args);
  const readJson = async (name, args, field) => {
    let json = '',
      cursor;
    do {
      const part = await read(name, { ...args, ...(cursor && { cursor }) });
      if (name === 'getNode' && part.node) return part.node;
      assert.equal(typeof part[field], 'string');
      json += part[field];
      assert(!part.nextCursor || part.nextCursor !== cursor);
      cursor = part.nextCursor;
    } while (cursor);
    return JSON.parse(json);
  };
  const readFile = async (attachmentId) => {
    let cursor,
      offset = 0,
      version;
    const chunks = [];
    do {
      const part = await read('getAttachmentFileChunk', {
        attachmentId,
        ...(cursor && { cursor }),
      });
      assert.equal(part.offset, offset);
      version ??= part.version;
      assert.equal(part.version, version);
      const chunk = Buffer.from(part.data, 'base64');
      chunks.push(chunk);
      offset += chunk.length;
      cursor = part.nextCursor;
      if (!cursor) assert.equal(offset, part.totalBytes);
    } while (cursor);
    return { version, bytes: Buffer.concat(chunks) };
  };
  let pageId;
  await test('MCP creates document fields atomically and reads them back with the same space key', async () => {
    const target = { parentPageId: parent.id };
    const settings = {
      status: 'IN_PROGRESS',
      aiRole: 'COAUTHOR',
      assigneeId: editor.id,
    };
    const title = 'Synthetic publication';
    const revision = (await read('createPage', { mode: 'inspect', ...target }))
      .revision;
    for (const bad of [
      { assigneeId: 'bad-id' },
      { assigneeId: randomUUID() },
      { status: 'INVALID' },
      { aiRole: 'INVALID' },
    ]) {
      const rejected = await call(writer, 'createPage', {
        mode: 'preview',
        operationId: randomUUID(),
        expectedRevision: revision,
        ...target,
        title,
        settings: bad,
      });
      assert.equal(rejected.isError, true);
    }
    const operation = await prepare(
      writer,
      'createPage',
      target,
      { title, settings },
      revision,
    );
    const receipt = await read('createPage', operation);
    assert.deepEqual(
      await recover(writer, 'createPage', target, operation.operationId),
      receipt,
    );
    pageId = receipt.result.pageId;
    const meta = await readJson(
      'getPageMetadata',
      { pageId },
      'metadataJsonChunk',
    );
    assert.equal(meta.assignee.id, editor.id);
    for (const [key, value] of Object.entries(settings))
      assert.equal(meta.customFields[key], value);
    const pages =
      await sql`select id from pages where space_id=${space.id} and title=${title}`;
    assert.deepEqual(
      pages.map((p) => p.id),
      [pageId],
    );
  });

  const node = (nodeId) =>
    readJson('getNode', { pageId, nodeId }, 'nodeJsonChunk');
  const target = { pageId };
  const planEdit = (edit) =>
    prepare(writer, 'editPageContent', target, { edit });
  const commitEdit = async (edit) =>
    read('editPageContent', await planEdit(edit));
  await test('MCP previews and persists native inline tags, list repeats, links and literal code', async () => {
    const edit = {
      kind: 'appendBlock',
      markdown:
        'Before ::tag[TBD] [link](https://example.com) ::tag[TODO] ::tag[DONE] `::tag[TODO]`',
    };
    const operation = await planEdit(edit);
    const { previewHash, ...args } = operation;
    const preview = await read('editPageContent', { ...args, mode: 'preview' });
    const tags = (block) =>
      block.content.filter((n) => n.type === 'tag').map((n) => n.attrs.value);
    assert.deepEqual(tags(preview.after), ['tbd', 'todo', 'done']);
    await read('editPageContent', operation);
    const stored = await node(preview.after.attrs.id);
    assert.deepEqual(tags(stored), ['tbd', 'todo', 'done']);
    assert(stored.content.some((n) => n.marks?.some((m) => m.type === 'link')));
    assert(
      stored.content.some(
        (n) =>
          n.text === '::tag[TODO]' && n.marks?.some((m) => m.type === 'code'),
      ),
    );
    await commitEdit({
      kind: 'replaceBlock',
      nodeId: preview.after.attrs.id,
      markdown: 'Replaced ::tag[DONE]',
    });
    assert.deepEqual(tags(await node(preview.after.attrs.id)), ['done']);
    const insert = await planEdit({
      kind: 'insertBlock',
      nodeId: preview.after.attrs.id,
      position: 'before',
      markdown: '- ::tag[TODO] ::tag[TODO]',
    });
    const { previewHash: _, ...insertArgs } = insert;
    const list = (
      await read('editPageContent', { ...insertArgs, mode: 'preview' })
    ).after;
    await read('editPageContent', insert);
    assert.deepEqual(tags(await node(list.content[0].content[0].attrs.id)), [
      'todo',
      'todo',
    ]);
    const code = await planEdit({
      kind: 'appendBlock',
      markdown: '```\n::tag[TBD]\n```',
    });
    await read('editPageContent', code);
    const [{ content }] =
      await sql`select content from pages where id=${pageId}`;
    assert.equal(content.content.at(-1).type, 'codeBlock');
    assert.deepEqual(content.content.at(-1).content, [{ type: 'text', text: '::tag[TBD]\n' }]);
  });

  await test('MCP replaces only the active Draw.io node, conflicts on page and file changes and recovers the exact model', async () => {
    const upload = (text, attachmentId) =>
      api(
        editor,
        `/attachments/actions/upload-file?pageId=${pageId}`,
        'POST',
        undefined,
        {
          multipart: {
            pageId,
            ...(attachmentId && { attachmentId }),
            file: {
              name: 'diagram.drawio.svg',
              mimeType: 'image/svg+xml',
              buffer: Buffer.from(
                `<svg xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`,
              ),
            },
          },
        },
      );
    const old = await upload('historical'),
      active = await upload('active');
    const anchorId = randomUUID();
    const body = {
      type: 'doc',
      content: [
        {
          type: 'drawio',
          attrs: {
            attachmentId: active.id,
            src: `/api/attachments/files/${active.id}/diagram.drawio.svg`,
            title: 'Original caption',
            width: '72%',
            align: 'left',
          },
        },
        {
          type: 'paragraph',
          attrs: { id: randomUUID() },
          content: [
            {
              type: 'text',
              text: 'Keep anchor',
              marks: [{ type: 'comment', attrs: { commentId: anchorId } }],
            },
          ],
        },
      ],
    };
    await api(editor, '/pages/actions/update', 'POST', {
      pageId,
      format: 'json',
      operation: 'replace',
      content: body,
    });
    const oldFile = await readFile(old.id);
    const plan = async () =>
      planEdit({
        kind: 'replaceDrawio',
        nodeId: '#0',
        attachmentId: active.id,
        attachmentVersion: (await readFile(active.id)).version,
        modelBase64: model.toString('base64'),
        modelSha256: sha(model),
        pngBase64,
      });
    const first = await plan();
    await upload('newer source', active.id);
    const newer = await readFile(active.id);
    assert.equal(
      (await call(writer, 'editPageContent', first)).structuredContent.code,
      'MCP_SOURCE_CHANGED',
    );
    const stalePage = await plan();
    await commitEdit({ kind: 'appendBlock', markdown: 'Keep new neighbor' });
    assert.equal(
      (await call(writer, 'editPageContent', stalePage)).structuredContent.code,
      'MCP_WRITE_STALE',
    );
    const operation = await plan();
    assert.equal(
      (await call(reader, 'editPageContent', operation)).isError,
      true,
    );
    const editOnly = await createKey(editor, ['page.content.write']);
    assert.equal(
      (await call(editOnly, 'editPageContent', operation)).structuredContent
        .code,
      'MCP_HTTP_403',
    );
    const { previewHash, ...args } = operation;
    const preview = await read('editPageContent', { ...args, mode: 'preview' });
    assert.equal(preview.before.attrs.attachmentId, active.id);
    assert.equal(preview.target.pageId, pageId);
    assert.equal(preview.edit.modelSha256, sha(model));
    assert.equal(preview.edit.sheets, 2);
    assert(Buffer.byteLength(JSON.stringify(preview)) < 24 * 1024);
    const receipt = await read('editPageContent', operation);
    assert.deepEqual(
      await recover(writer, 'editPageContent', target, operation.operationId),
      receipt,
    );
    assert.deepEqual(await read('editPageContent', operation), receipt);
    const result = await node('#0');
    assert.equal(result.type, 'drawio');
    assert.equal(result.attrs.attachmentId, receipt.result.attachmentId);
    assert.equal(result.attrs.title, 'Original caption');
    assert.equal(result.attrs.width, '72%');
    assert.equal(result.attrs.align, 'left');
    assert.equal(
      (await node(body.content[1].attrs.id)).content[0].marks[0].attrs
        .commentId,
      anchorId,
    );
    const file = await readFile(result.attrs.attachmentId);
    assert.equal(sha(file.bytes), receipt.result.svgSha256);
    const svg = new DOMParser().parseFromString(
      file.bytes.toString(),
      'image/svg+xml',
    ).documentElement;
    assert.equal(svg.tagName, 'svg');
    assert.deepEqual(Buffer.from(svg.getAttribute('content')), model);
    assert.equal(
      svg.getElementsByTagName('image')[0].getAttribute('xlink:href'),
      'data:image/png;base64,' + pngBase64,
    );
    assert.deepEqual(await readFile(old.id), oldFile);
    assert.deepEqual(await readFile(active.id), newer);
    const rows =
      await sql`select id from attachments where page_id=${pageId} and file_name='diagram.drawio.svg'`;
    assert.equal(rows.length, 3);
    await writeFile(path.join(output, 'mcp-drawio-readback.svg'), file.bytes);

    const secondModel = Buffer.from(model.toString().replace('name="Second"', 'name="Architecture"'));
    const append = {
      kind: 'appendDrawio', modelBase64: secondModel.toString('base64'), modelSha256: sha(secondModel), pngBase64,
    };
    const outdated = await planEdit(append);
    await commitEdit({ kind: 'appendBlock', markdown: '## Second diagram' });
    assert.equal((await call(writer, 'editPageContent', outdated)).structuredContent.code, 'MCP_WRITE_STALE');
    const insertion = await planEdit(append);
    assert((await call(reader, 'editPageContent', insertion)).isError);
    assert.equal((await call(editOnly, 'editPageContent', insertion)).structuredContent.code, 'MCP_HTTP_403');
    const insertionPreview = await read('editPageContent', { ...insertion, mode: 'preview', previewHash: undefined });
    assert.equal(insertionPreview.before, null);
    assert.equal(insertionPreview.after.type, 'drawio');
    const appended = await read('editPageContent', insertion);
    assert.deepEqual(await read('editPageContent', insertion), appended);
    assert.deepEqual(await recover(writer, 'editPageContent', target, insertion.operationId), appended);
    assert.notEqual(appended.result.attachmentId, receipt.result.attachmentId);
    assert.equal((await node('#0')).attrs.attachmentId, receipt.result.attachmentId);
    assert.equal((await node('#4')).attrs.attachmentId, appended.result.attachmentId);
    const secondFile = await readFile(appended.result.attachmentId);
    assert.equal(sha(secondFile.bytes), appended.result.svgSha256);
    assert.notEqual(appended.result.svgSha256, receipt.result.svgSha256);
    const secondSvg = new DOMParser().parseFromString(secondFile.bytes.toString(), 'image/svg+xml').documentElement;
    assert.deepEqual(Buffer.from(secondSvg.getAttribute('content')), secondModel);
    assert.deepEqual((await readFile(receipt.result.attachmentId)).bytes, file.bytes);
    assert.equal((await sql`select id from attachments where page_id=${pageId} and file_name='diagram.drawio.svg'`).length, 4);
  });

  await test('MCP appends, inserts and replaces pipe tables with readable header cells and inline links', async () => {
    const table = '| Name | Status |\n| --- | --- |\n| [Product](https://example.org/product) | ::tag[TODO] ' + 'x'.repeat(2250) + ' |';
    const tableRefs = async () => {
      const outline = await read('getOutline', { pageId });
      assert(!outline.nextCursor);
      return outline.items.filter(item => item.type === 'table').map(item => `#${item.index}`);
    };
    const check = (block, name) => {
      assert.equal(block.type, 'table');
      assert.deepEqual(block.content.map(row => row.type), ['tableRow','tableRow']);
      assert.deepEqual(block.content[0].content.map(cell => cell.type), ['tableHeader','tableHeader']);
      assert.deepEqual(block.content[1].content.map(cell => cell.type), ['tableCell','tableCell']);
      const label = block.content[1].content[0].content[0].content[0];
      assert.equal(label.text, name);
      assert.equal(label.marks.find(mark => mark.type === 'link').attrs.href, 'https://example.org/product');
      assert.equal(block.content[1].content[1].content[0].content[0].type, 'tag');
    };
    const first = await read('editPageContent', {...target, mode:'inspect'});
    const args = {...target, expectedRevision:first.revision, operationId:randomUUID(), edit:{kind:'appendBlock', markdown:table}};
    const preview = await read('editPageContent', {...args, mode:'preview'});
    check(preview.after, 'Product');
    // Model a delayed save of identical Yjs content between two previews.
    await sql`update pages set updated_at=updated_at+interval '1 second' where id=${pageId}`;
    const repeat = await read('editPageContent',{...args,mode:'preview'});
    assert.equal(repeat.previewHash, preview.previewHash);
    assert.deepEqual(repeat.after, preview.after);
    const operation = {...args,mode:'commit',previewHash:preview.previewHash};
    await read('editPageContent', operation);
    const [originalRef] = await tableRefs();
    check(await node(originalRef), 'Product');
    await commitEdit({kind:'insertBlock',nodeId:originalRef,position:'before',markdown:table.replace('Product','Inserted')});
    const [insertedRef, followingRef] = await tableRefs();
    check(await node(insertedRef), 'Inserted');
    await commitEdit({kind:'replaceBlock',nodeId:followingRef,markdown:table.replace('Product','Updated')});
    check(await node(followingRef), 'Updated');
    check(await node(insertedRef), 'Inserted');
  });
}
