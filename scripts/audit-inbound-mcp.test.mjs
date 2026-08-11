import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { auditInboundMcp } from './audit-inbound-mcp.mjs';

test('the audit client exercises protocol failures without returning secrets', async () => {
  const expectedToken = 'one-time-secret-for-test';
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    const authorized =
      request.headers.authorization === `Bearer ${expectedToken}`;

    if (!authorized) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (raw.includes('"id":101')) {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'concurrency limited' }));
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'wrong key type' }));
      return;
    }
    if (request.headers['content-type'] !== 'application/json') {
      response.writeHead(415, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unsupported media type' }));
      return;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'malformed JSON' }));
      return;
    }

    let payload;
    if (body.jsonrpc !== '2.0') {
      payload = { jsonrpc: '2.0', id: body.id, error: { code: -32600 } };
    } else if (body.method === 'initialize') {
      payload = {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'docmost', version: '1.0.0' },
        },
      };
    } else if (body.method === 'tools/list') {
      payload = {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [
            {
              name: 'getTree',
              annotations: { readOnlyHint: true },
            },
          ],
        },
      };
    } else if (body.method === 'tools/call') {
      payload = {
        jsonrpc: '2.0',
        id: body.id,
        result:
          body.params.name === 'editPageText'
            ? { isError: true, content: [] }
            : { content: [] },
      };
    } else {
      payload = { jsonrpc: '2.0', id: body.id, error: { code: -32601 } };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/mcp`;
    const result = await auditInboundMcp({
      endpoint,
      ragEndpoint: `${endpoint}/rag`,
      mcpToken: expectedToken,
      ragToken: 'wrong-rag-token',
      concurrency: 2,
      requireConcurrencyLimit: true,
    });

    assert.equal(result.passed, true);
    assert.equal(JSON.stringify(result).includes(expectedToken), false);
    assert.equal(result.checks.some((check) => check.name === 'write tool denied'), true);
    assert.deepEqual(
      result.checks.find(
        (check) => check.name === 'concurrency limit enforcement',
      ),
      {
        name: 'concurrency limit enforcement',
        passed: true,
        enforcementObserved: true,
        statuses: [200, 429],
      },
    );
  } finally {
    server.close();
    await once(server, 'close');
  }
});
