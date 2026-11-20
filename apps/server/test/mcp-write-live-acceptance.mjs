import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { runMcpPublicationAcceptance } from './mcp-publication-live-acceptance.mjs';

const WRITE_TOOLS = [
  'createPage',
  'updatePageTitle',
  'editPageContent',
  'uploadPageImage',
  'replyToComment',
  'setCommentResolved',
];
const sha = (value) => createHash('sha256').update(value).digest('hex');

export async function runMcpWriteAcceptance({
  api,
  actors,
  space,
  parent,
  sql,
  test,
  baseURL,
  exactSecrets,
  output,
}) {
  const { admin, editor } = actors;
  const keys = [];
  const createKey = async (actor, allowedCapabilities) => {
    if (actor === editor)
      await sql`update users set role = 'admin' where id = ${editor.id}`;
    try {
      const key = await api(actor, '/api-keys/create', 'POST', {
        name: 'Synthetic write fixture',
        spaceId: space.id,
        keyType: 'mcp',
        allowedCapabilities,
      });
      exactSecrets.add(key.token);
      keys.push(key);
      return key;
    } finally {
      if (actor === editor)
        await sql`update users set role = 'member' where id = ${editor.id}`;
    }
  };
  const rpc = async (key, method, params, retries = 2) => {
    const response = await fetch(`${baseURL}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await response.text();
    if (response.status === 429 && retries > 0) {
      const seconds = Number(response.headers.get('retry-after'));
      assert(Number.isFinite(seconds) && seconds > 0 && seconds <= 60);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      return rpc(key, method, params, retries - 1);
    }
    const data = body.split('\n').find((line) => line.startsWith('data:'));
    const payload = data ? JSON.parse(data.slice(5)) : JSON.parse(body);
    return {
      status: response.status,
      ...payload.result,
      protocolError: payload.error,
    };
  };
  const call = (key, name, args) =>
    rpc(key, 'tools/call', {
      name,
      arguments: WRITE_TOOLS.includes(name)
        ? { spaceId: space.id, ...args }
        : args,
    });
  const success = async (key, name, args) => {
    const response = await call(key, name, args);
    assert.equal(response.status, 200, name);
    assert(
      !response.isError && !response.protocolError,
      `${name} ${args.mode} failed: ${response.structuredContent?.code ?? 'protocol error'} ${response.structuredContent?.message ?? ''}`,
    );
    return JSON.parse(response.content[0].text);
  };
  const prepare = async (key, name, target, payload, expectedRevision) => {
    const revision =
      expectedRevision ??
      (await success(key, name, { ...target, mode: 'inspect' })).revision;
    const args = {
      ...target,
      ...payload,
      operationId: randomUUID(),
      expectedRevision: revision,
    };
    const preview = await success(key, name, { ...args, mode: 'preview' });
    return { ...args, previewHash: preview.previewHash, mode: 'commit' };
  };
  const recover = (key, name, target, operationId) =>
    success(key, name, { ...target, operationId, mode: 'status' });
  const policy = await api(admin, '/ai/tool-policy');
  const readCapabilities = [
    'page.metadata.read',
    'page.node.read',
    'page.attachments.file.read',
  ];
  const [originalSpace] =
    await sql`select settings from spaces where id=${space.id}`;
  const writeCapabilities = policy.catalog
    .filter((tool) => WRITE_TOOLS.includes(tool.name))
    .map((tool) => tool.capability);
  const spacePolicy = await api(admin, `/spaces/${space.id}/ai/tool-policy`);
  try {
    await sql`update spaces set settings=coalesce(settings,'{}'::jsonb) || ${sql.json({ documentFields: { status: true, assignee: true, aiRole: true } })} where id=${space.id}`;
    await api(admin, '/ai/tool-policy', 'PATCH', {
      enabled: true,
      readOnly: false,
      knowledgeOnly: false,
      allowedCapabilities: [
        ...new Set([
          ...policy.allowedCapabilities,
          ...writeCapabilities,
          ...readCapabilities,
          'page.content.read',
        ]),
      ],
    });
    await api(admin, `/spaces/${space.id}/ai/tool-policy`, 'PUT', {
      allowedCapabilities: null,
      readOnly: false,
      knowledgeOnly: false,
    });
    const reader = await createKey(admin);
    const writer = await createKey(editor, [
      ...writeCapabilities,
      ...readCapabilities,
    ]);
    let pageId;
    await test('MCP default key denies writes, scoped writer creates exactly once and status recovers a lost response', async () => {
      assert(
        (await rpc(reader, 'tools/list')).tools.every(
          (tool) => tool.annotations.readOnlyHint,
        ),
      );
      assert.equal(
        (
          await call(reader, 'createPage', {
            mode: 'inspect',
            parentPageId: parent.id,
          })
        ).isError,
        true,
      );
      const names = (await rpc(writer, 'tools/list')).tools.map(
        ({ name }) => name,
      );
      assert(WRITE_TOOLS.every((tool) => names.includes(tool)));
      assert.equal(
        (
          await call(writer, 'createPage', {
            mode: 'inspect',
            spaceId: randomUUID(),
            parentPageId: null,
          })
        ).isError,
        true,
      );
      const target = { parentPageId: parent.id };
      const operation = await prepare(writer, 'createPage', target, {
        title: 'Synthetic MCP write page',
      });
      await success(writer, 'createPage', operation);
      const recovered = await recover(
        writer,
        'createPage',
        target,
        operation.operationId,
      );
      pageId = recovered.result.pageId;
      assert.deepEqual(
        await success(writer, 'createPage', operation),
        recovered,
      );
      assert.equal(
        (
          await call(writer, 'createPage', {
            ...operation,
            title: 'Different payload',
          })
        ).structuredContent.code,
        'MCP_OPERATION_MISMATCH',
      );
      const rows =
        await sql`select id from pages where parent_page_id = ${parent.id} and title = 'Synthetic MCP write page'`;
      assert.deepEqual(
        rows.map(({ id }) => id),
        [pageId],
      );
    });
    const target = { pageId };
    await test('MCP writes a Markdown block to a newly created page', async () => {
      const edit = await prepare(writer, 'editPageContent', target, {
        edit: { kind: 'appendBlock', markdown: 'A **synthetic** paragraph.' },
      });
      const receipt = await success(writer, 'editPageContent', edit);
      assert.equal(receipt.status, 'committed');
      const [{ content }] =
        await sql`select content from pages where id = ${pageId}`;
      const paragraph = content.content.at(-1);
      assert(paragraph.attrs.id);
      assert.equal(paragraph.content[1].text, 'synthetic');
      assert.equal(paragraph.content[1].marks[0].type, 'bold');
    });
    await test('MCP title compare-and-set rejects a stale parallel preview', async () => {
      const revision = (
        await success(writer, 'updatePageTitle', { ...target, mode: 'inspect' })
      ).revision;
      const first = await prepare(
        writer,
        'updatePageTitle',
        target,
        { title: 'First title' },
        revision,
      );
      const second = await prepare(
        writer,
        'updatePageTitle',
        target,
        { title: 'Second title' },
        revision,
      );
      const results = await Promise.all([
        call(writer, 'updatePageTitle', first),
        call(writer, 'updatePageTitle', second),
      ]);
      assert.equal(
        results.filter(
          (item) => item.structuredContent?.code === 'MCP_WRITE_STALE',
        ).length,
        1,
      );
      assert.equal(
        results.filter((item) => !item.isError && !item.protocolError).length,
        1,
      );
    });
    const { id: threadId } = await api(
      editor,
      '/comments/actions/create',
      'POST',
      {
        pageId,
        type: 'inline',
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Synthetic anchor' }],
            },
          ],
        }),
      },
    );
    const paragraphId = randomUUID();
    await api(editor, '/pages/actions/update', 'POST', {
      pageId,
      format: 'json',
      operation: 'replace',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: paragraphId },
            content: [
              {
                type: 'text',
                text: 'Anchor',
                marks: [{ type: 'comment', attrs: { commentId: threadId } }],
              },
              { type: 'text', text: ' editable', marks: [{ type: 'bold' }] },
            ],
          },
        ],
      },
    });
    await test('MCP preserves live formatting and inline anchors with durable Yjs receipts', async () => {
      const { revision } = await success(writer, 'editPageContent', {
        ...target,
        mode: 'inspect',
      });
      const invalid = await call(writer, 'editPageContent', {
        ...target,
        mode: 'preview',
        operationId: randomUUID(),
        expectedRevision: revision,
        edit: {
          kind: 'editText',
          nodeId: paragraphId,
          oldText: 'Anchor',
          newText: 'Different',
        },
      });
      assert.equal(
        invalid.structuredContent.code,
        'MCP_COMMENT_ANCHOR_CONFLICT',
      );
      const edit = await prepare(
        writer,
        'editPageContent',
        target,
        {
          edit: {
            kind: 'editText',
            nodeId: paragraphId,
            oldText: 'editable',
            newText: 'edited',
          },
        },
        revision,
      );
      const result = await success(writer, 'editPageContent', edit);
      assert.notEqual(result.result.afterHash, revision);
      assert.deepEqual(
        await recover(writer, 'editPageContent', target, edit.operationId),
        result,
      );
      assert.deepEqual(await success(writer, 'editPageContent', edit), result);
      const [{ content, ydoc }] =
        await sql`select content, ydoc from pages where id = ${pageId}`;
      assert(ydoc?.length > 0);
      const [paragraph] = content.content;
      assert.equal(paragraph.attrs.id, paragraphId);
      assert.equal(paragraph.content[0].marks[0].attrs.commentId, threadId);
      assert.equal(paragraph.content[1].text, ' edited');
      assert.equal(paragraph.content[1].marks[0].type, 'bold');
      const [{ count }] =
        await sql`select count(*)::int as count from mcp_write_operations where page_id = ${pageId} and tool = 'editPageContent' and result is not null`;
      assert.equal(count, 2);
    });
    await test('MCP replies once, resolves and reopens while reporting the current thread revision', async () => {
      const thread = { pageId, threadId };
      const reply = await prepare(writer, 'replyToComment', thread, {
        text: 'Synthetic reply',
      });
      const receipt = await success(writer, 'replyToComment', reply);
      assert.deepEqual(await success(writer, 'replyToComment', reply), receipt);
      assert(receipt.result.commentId);
      const [{ count }] =
        await sql`select count(*)::int as count from comments where parent_comment_id = ${threadId}`;
      assert.equal(count, 1);
      for (const resolved of [true, false]) {
        const operation = await prepare(writer, 'setCommentResolved', thread, {
          resolved,
        });
        assert.equal(
          (await success(writer, 'setCommentResolved', operation)).result
            .resolved,
          resolved,
        );
        assert.equal(
          (
            await recover(
              writer,
              'setCommentResolved',
              thread,
              operation.operationId,
            )
          ).result.resolved,
          resolved,
        );
      }
    });
    await test('MCP accepts a bounded large PNG and rejects malformed and oversized uploads', async () => {
      const pixel = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
        'base64',
      );
      const image = Buffer.concat([pixel, Buffer.alloc(900_000)]);
      const payload = {
        fileName: 'synthetic.png',
        sha256: sha(image),
        base64: image.toString('base64'),
      };
      const { revision } = await success(writer, 'uploadPageImage', {
        ...target,
        mode: 'inspect',
      });
      const invalid = {
        ...target,
        ...payload,
        expectedRevision: revision,
        operationId: randomUUID(),
        mode: 'preview',
      };
      assert.equal(
        (
          await call(writer, 'uploadPageImage', {
            ...invalid,
            sha256: '0'.repeat(64),
          })
        ).isError,
        true,
      );
      assert.equal(
        (
          await call(writer, 'uploadPageImage', {
            ...invalid,
            fileName: '../synthetic.png',
          })
        ).isError,
        true,
      );
      const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
      assert.equal(
        (
          await call(writer, 'uploadPageImage', {
            ...invalid,
            base64: oversized,
          })
        ).isError,
        true,
      );
      const operation = await prepare(
        writer,
        'uploadPageImage',
        target,
        payload,
        revision,
      );
      const receipt = await success(writer, 'uploadPageImage', operation);
      assert.deepEqual(
        await success(writer, 'uploadPageImage', operation),
        receipt,
      );
      assert.equal(receipt.result.sha256, payload.sha256);
      const imageRead = await editor.api.get(receipt.result.url);
      assert.equal(imageRead.status(), 200);
      assert.equal(sha(await imageRead.body()), payload.sha256);
      const append = await prepare(writer, 'editPageContent', target, {
        edit: {
          kind: 'appendImage',
          attachmentId: receipt.result.attachmentId,
          alt: 'Synthetic image',
        },
      });
      assert.equal(
        (await success(writer, 'editPageContent', append)).status,
        'committed',
      );
    });
    await runMcpPublicationAcceptance({
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
    });
    await test('MCP checks current page ACL, administrator policy and revocation on writes', async () => {
      const edit = await prepare(writer, 'updatePageTitle', target, {
        title: 'Must not be written',
      });
      await api(admin, `/pages/${pageId}/actions/access/close-user`, 'POST', {
        userId: editor.id,
      });
      assert.equal((await call(writer, 'updatePageTitle', edit)).isError, true);
      await api(admin, `/pages/${pageId}/actions/access/grant-user`, 'POST', {
        userId: editor.id,
        role: 'writer',
      });
      await api(admin, `/spaces/${space.id}/ai/tool-policy`, 'PUT', {
        allowedCapabilities: null,
        readOnly: true,
      });
      assert.equal((await call(writer, 'updatePageTitle', edit)).isError, true);
      await api(admin, '/api-keys/revoke', 'POST', { apiKeyId: writer.id });
      assert.equal((await call(writer, 'updatePageTitle', edit)).status, 401);
      const [{ title }] =
        await sql`select title from pages where id = ${pageId}`;
      assert.notEqual(title, 'Must not be written');
    });
  } finally {
    await sql`update spaces set settings=${originalSpace.settings === null ? null : sql.json(originalSpace.settings)} where id=${space.id}`;
    for (const key of keys)
      await api(admin, '/api-keys/revoke', 'POST', { apiKeyId: key.id }).catch(
        () => {},
      );
    await api(admin, `/spaces/${space.id}/ai/tool-policy`, 'PUT', {
      allowedCapabilities: spacePolicy.allowedCapabilities,
      readOnly: spacePolicy.readOnly,
      knowledgeOnly: spacePolicy.knowledgeOnly,
    });
    await api(admin, '/ai/tool-policy', 'PATCH', {
      allowedCapabilities: policy.allowedCapabilities,
      enabled: policy.enabled,
      readOnly: policy.readOnly,
      knowledgeOnly: policy.knowledgeOnly,
    });
  }
}
