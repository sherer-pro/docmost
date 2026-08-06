import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
} from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { OpenWebUiClient } from './clients.js';
import { BoundedHttpClient } from './http-client.js';
import type { RagSyncBinding } from './types.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe('OpenWebUiClient', () => {
  it('uses the Open WebUI 0.9.6 file and knowledge contracts', async () => {
    const requests: Array<{
      method: string;
      url: string;
      authorization: string | undefined;
      body: string;
    }> = [];
    const baseUrl = await startServer(async (request, response) => {
      const body = await readRequestBody(request);
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      });

      if (request.method === 'POST' && request.url?.startsWith('/api/v1/files/')) {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ id: 'file-new' }));
        return;
      }
      if (request.url === '/api/v1/files/file-new/process/status') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ status: 'completed' }));
        return;
      }
      if (
        request.url ===
        '/api/v1/knowledge/knowledge-1/files?page=1&limit=500&include_content=false'
      ) {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            items: [{ id: 'file-new' }, { id: 'file-old' }],
            total: 2,
          }),
        );
        return;
      }
      if (request.method === 'DELETE' && request.url === '/api/v1/files/missing') {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 500;
      response.end();
    });
    const client = new OpenWebUiClient(binding(baseUrl), 5_000, 5_000);
    const metadata = {
      knowledge_id: 'knowledge-1',
      docmost: {
        schemaVersion: 1,
        workspaceId: '0198f2f5-a5a3-7000-8000-000000000001',
        spaceId: '0198f2f5-a5a3-7000-8000-000000000002',
      },
    };

    const uploaded = await client.upload(
      'page.md',
      'text/markdown',
      new TextEncoder().encode('# Page'),
      metadata,
    );
    await client.waitUntilProcessed(uploaded.id);
    const files = await client.listKnowledgeFiles();
    await client.deleteFile('missing');

    assert.equal(uploaded.id, 'file-new');
    assert.deepEqual(
      files.map((file) => file.id),
      ['file-new', 'file-old'],
    );
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(
      requests[0]?.url,
      '/api/v1/files/?process=true&process_in_background=true',
    );
    assert.equal(requests[0]?.authorization, 'Bearer writer-key');
    assert.match(requests[0]?.body ?? '', /name="metadata"/);
    assert.match(requests[0]?.body ?? '', /"knowledge_id":"knowledge-1"/);
    assert.match(requests[0]?.body ?? '', /name="file"; filename="page.md"/);
  });
});

describe('BoundedHttpClient', () => {
  it('rejects redirects and oversized responses without reading remote bodies', async () => {
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/redirect') {
        response.statusCode = 302;
        response.setHeader('location', '/target');
        response.end('remote body');
        return;
      }
      response.setHeader('content-length', '1024');
      response.end('x'.repeat(1024));
    });
    const client = new BoundedHttpClient(baseUrl, 'secret', 5_000);

    await assert.rejects(
      client.json('redirect'),
      /Remote redirects are not allowed/,
    );
    await assert.rejects(
      client.bytes('oversized', {}, 32),
      /configured size limit/,
    );
  });
});

function binding(baseUrl: string): RagSyncBinding {
  return {
    id: 'binding-1',
    workspaceId: '0198f2f5-a5a3-7000-8000-000000000001',
    spaceId: '0198f2f5-a5a3-7000-8000-000000000002',
    docmostBaseUrl: 'https://docmost.example',
    docmostApiKey: 'docmost-key',
    openWebUiBaseUrl: baseUrl,
    openWebUiApiKey: 'writer-key',
    knowledgeId: 'knowledge-1',
  };
}

async function startServer(
  handler: RequestListener,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test HTTP server did not expose an address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function readRequestBody(
  request: IncomingMessage,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
