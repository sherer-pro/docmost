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
      gateway: request.headers['x-docmost-quality-gateway-token'],
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
    assert.equal(seen[0].gateway, undefined);
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

test('capture forwards only its configured gateway token and never records it', async () => {
  const gatewayToken = 'gateway_fixture_'.padEnd(64, 'a');
  const seen = [];
  const upstream = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    seen.push(request.headers);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"data":[]}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const options = {
    upstream: `http://127.0.0.1:${upstream.address().port}/v1`,
    model: 'fixture-model',
    isolated: true,
  };
  for (const upstreamGatewayToken of [
    '',
    'short',
    'x'.repeat(129),
    'x'.repeat(32) + '\n',
    null,
  ])
    await assert.rejects(
      createQualityProviderProxy({ ...options, upstreamGatewayToken }),
    );
  const proxy = await createQualityProviderProxy({
    ...options,
    upstreamGatewayToken: gatewayToken,
  });
  try {
    const result = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${proxy.token}`,
        'content-type': 'application/json',
        'x-docmost-quality-gateway-token': 'untrusted-client-header',
        'x-private-fixture': 'private-client-header',
      },
      body: JSON.stringify({ model: 'fixture-model', messages: [] }),
    });
    assert.equal(result.status, 200);
    await result.text();
    const records = await proxy.takeCase('probe');
    assert.equal(seen[0]['x-docmost-quality-gateway-token'], gatewayToken);
    assert.equal(seen[0].authorization, undefined);
    assert.equal(seen[0]['x-private-fixture'], undefined);
    assert(!JSON.stringify(records).includes(gatewayToken));
    assert(!JSON.stringify(proxy).includes(gatewayToken));
    assert(!JSON.stringify(records).includes('untrusted-client-header'));
  } finally {
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('capture rejects decoded transport secrets before recording or forwarding them', async () => {
  let calls = 0,
    captures = 0;
  const upstream = createServer((_request, response) => {
    calls++;
    response.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const gatewayToken = 'upstream_fixture_'.padEnd(64, 'x');
  const proxy = await createQualityProviderProxy({
    upstream: `http://127.0.0.1:${upstream.address().port}/v1`,
    model: 'fixture-model',
    isolated: true,
    upstreamGatewayToken: gatewayToken,
    onCapture: async () => {
      captures++;
    },
  });
  const escaped = (secret) =>
    [...secret]
      .map((char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
      .join('');
  try {
    for (const secret of [proxy.token, gatewayToken]) {
      for (const payload of [
        {
          model: 'fixture-model',
          messages: [{ role: 'user', content: secret }],
        },
        {
          model: 'fixture-model',
          messages: [],
          tools: [{ [secret]: 'value' }],
        },
      ]) {
        const encoded = JSON.stringify(payload)
          .split(secret)
          .join(escaped(secret));
        assert(!encoded.includes(secret));
        const result = await fetch(proxy.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${proxy.token}`,
            'content-type': 'application/json',
          },
          body: encoded,
        });
        assert.equal(result.status, 400);
        const text = await result.text();
        assert(!text.includes(proxy.token));
        assert(!text.includes(gatewayToken));
      }
    }
    assert.equal(calls, 0);
    assert.equal(captures, 0);
    assert.deepEqual(await proxy.takeCase('probe'), []);
  } finally {
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
