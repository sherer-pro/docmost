import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createQualityProviderProxy } from './ai-quality-provider-proxy.mjs';

test('capture rejects external targets, credentials and non-isolated runtimes', async () => {
  for (const upstream of [
    'https://127.0.0.1:1234/v1',
    'http://localhost:1234/v1',
    'http://example.test/v1',
    'http://user:password@127.0.0.1:1234/v1',
    'http://127.0.0.1:1234/api',
    'http://127.0.0.1:1234/v1?x=y',
  ]) {
    await assert.rejects(
      createQualityProviderProxy({
        upstream,
        model: 'fixture-model',
        isolated: true,
      }),
    );
  }
  await assert.rejects(
    createQualityProviderProxy({
      upstream: 'http://127.0.0.1:1234/v1',
      model: 'fixture-model',
      isolated: false,
    }),
  );
});

test('capture forwards exact inference bytes and SSE while keeping headers and its token out of records', async () => {
  const seen = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({
      body: Buffer.concat(chunks).toString(),
      authorization: request.headers.authorization,
      custom: request.headers['x-private-fixture'],
    });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"fixture"}}]}\n\n');
    await new Promise((resolve) => setTimeout(resolve, 20));
    response.end('data: [DONE]\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const stored = [];
  const proxy = await createQualityProviderProxy({
    upstream: `http://127.0.0.1:${upstream.address().port}/v1`,
    model: 'fixture-model',
    isolated: true,
    onCapture: async (record) => stored.push(record),
  });
  try {
    proxy.setCase('q001');
    const body = JSON.stringify({
      model: 'fixture-model',
      messages: [{ role: 'user', content: 'Exact synthetic evidence\n[ S1 ]' }],
      temperature: 0,
      stream: true,
    });
    const result = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${proxy.token}`,
        'content-type': 'application/json',
        'x-private-fixture': 'not-forwarded',
      },
      body,
    });
    assert.equal(result.status, 200);
    assert.equal(
      await result.text(),
      'data: {"choices":[{"delta":{"content":"fixture"}}]}\n\ndata: [DONE]\n\n',
    );
    const records = await proxy.takeCase('q001');
    assert.equal(records.length, 1);
    assert.equal(stored.length, 1);
    assert.equal(
      records[0].requestHash,
      createHash('sha256').update(body).digest('hex'),
    );
    assert.equal(
      records[0].messages[0].content,
      'Exact synthetic evidence\n[ S1 ]',
    );
    assert.equal(records[0].transmitted, true);
    assert.equal(seen[0].body, body);
    assert.equal(seen[0].authorization, undefined);
    assert.equal(seen[0].custom, undefined);
    assert(!JSON.stringify(records).includes(proxy.token));
    assert(!JSON.stringify(proxy).includes(proxy.token));
    assert.deepEqual(await proxy.takeCase('q001'), []);
    for (const [path, payload] of [
      ['/chat/completions', { model: 'another-model', messages: [] }],
      [
        '/chat/completions',
        {
          model: 'fixture-model',
          messages: [],
          api_key: 'synthetic-rejected-key',
        },
      ],
      ['/models/load', { model: 'fixture-model' }],
    ]) {
      const denied = await fetch(`${proxy.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${proxy.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      assert([400, 404].includes(denied.status));
      await denied.text();
    }
    const unauthenticated = await fetch(`${proxy.baseUrl}/models`);
    assert.equal(unauthenticated.status, 401);
    await unauthenticated.text();
    assert.equal(seen.length, 1);
  } finally {
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
