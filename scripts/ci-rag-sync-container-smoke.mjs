import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const image = option('--image') ?? 'docmost-rag-sync:ci';
const redisImage = option('--redis-image') ?? 'redis:8';
const suffix = `${process.pid}-${Date.now()}`;
const network = `rag-sync-smoke-${suffix}`;
const redisContainer = `rag-sync-smoke-redis-${suffix}`;
const syncContainer = `rag-sync-smoke-app-${suffix}`;
const docmostToken = 'ci-docmost-rag-key';
const openWebUiToken = 'ci-open-webui-writer-key';
const observed = {
  knowledgeListed: false,
  pageFetched: false,
  uploadCompleted: false,
  processingChecked: false,
};
const server = createMockServer(docmostToken, openWebUiToken, observed);

try {
  const port = await listen(server);
  await docker(['network', 'create', network]);
  await docker([
    'run',
    '-d',
    '--name',
    redisContainer,
    '--network',
    network,
    redisImage,
    'redis-server',
    '--appendonly',
    'no',
    '--maxmemory-policy',
    'noeviction',
  ]);
  await waitForRedis();

  await docker([
    'run',
    '-d',
    '--name',
    syncContainer,
    '--network',
    network,
    '--add-host',
    'host.docker.internal:host-gateway',
    '-e',
    `RAG_SYNC_REDIS_URL=redis://${redisContainer}:6379/15`,
    '-e',
    'RAG_SYNC_REDIS_PREFIX=docmost:rag-sync:ci',
    '-e',
    'RAG_SYNC_POLL_INTERVAL_MS=5000',
    '-e',
    'RAG_SYNC_REQUEST_TIMEOUT_MS=5000',
    '-e',
    'RAG_SYNC_PROCESSING_TIMEOUT_MS=10000',
    '-e',
    'RAG_SYNC_MAX_ATTACHMENT_BYTES=1048576',
    '-e',
    'RAG_SYNC_BINDING_ID=binding-ci',
    '-e',
    `RAG_SYNC_DOCMOST_BASE_URL=http://host.docker.internal:${port}`,
    '-e',
    `RAG_SYNC_DOCMOST_API_KEY=${docmostToken}`,
    '-e',
    `RAG_SYNC_OPEN_WEBUI_API_KEY=${openWebUiToken}`,
    image,
  ]);

  const logs = await waitForCompletedCycle();
  const keys = await docker([
    'exec',
    redisContainer,
    'redis-cli',
    '-n',
    '15',
    '--scan',
    '--pattern',
    'docmost:rag-sync:ci:binding-ci:*',
  ]);
  if (!keys.stdout.trim()) {
    throw new Error('RAG Sync did not persist namespaced Redis state');
  }
  if (!logs.includes('"source.uploaded:none":1')) {
    throw new Error('RAG Sync did not upload the Docmost page');
  }
  if (
    !observed.knowledgeListed ||
    !observed.pageFetched ||
    !observed.uploadCompleted ||
    !observed.processingChecked
  ) {
    throw new Error(`Incomplete mock HTTP cycle: ${JSON.stringify(observed)}`);
  }

  const user = await docker([
    'inspect',
    '--format',
    '{{.Config.User}}',
    image,
  ]);
  if (user.stdout.trim() !== 'node') {
    throw new Error(`RAG Sync image runs as unexpected user: ${user.stdout.trim()}`);
  }

  process.stdout.write(logs);
  console.log('RAG Sync container smoke passed');
} finally {
  await docker(['rm', '-f', syncContainer, redisContainer], true);
  await docker(['network', 'rm', network], true);
  await new Promise((resolve) => server.close(resolve));
}

async function waitForRedis() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await docker(
      ['exec', redisContainer, 'redis-cli', 'ping'],
      true,
    );
    if (result.stdout.trim() === 'PONG') return;
    await delay(1_000);
  }
  throw new Error('Redis smoke container did not become ready');
}

async function waitForCompletedCycle() {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = await docker(['logs', syncContainer], true);
    const logs = `${result.stdout}${result.stderr}`;
    if (logs.includes('"event":"sync.completed"')) return logs;
    await delay(1_000);
  }
  const result = await docker(['logs', syncContainer], true);
  throw new Error(
    `RAG Sync container did not complete a cycle:\n${result.stdout}${result.stderr}`,
  );
}

async function docker(args, allowFailure = false) {
  try {
    return await execFileAsync('docker', args, {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFailure) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? String(error),
      };
    }
    throw error;
  }
}

function createMockServer(
  expectedDocmostToken,
  expectedOpenWebUiToken,
  state,
) {
  const pageId = '0198f2f5-a5a3-7000-8000-000000000003';
  const updatedAtMs = 1_754_000_000_000;
  const emptyUpdateFeed = {
    items: [],
    hasMore: false,
    nextCursor: null,
    maxUpdatedAtMs: 0,
  };
  const emptyDeletedFeed = {
    items: [],
    hasMore: false,
    nextCursor: null,
    maxDeletedAtMs: 0,
  };

  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const isOpenWebUi = url.pathname.startsWith('/api/v1/');
    const expectedToken = isOpenWebUi
      ? expectedOpenWebUiToken
      : expectedDocmostToken;
    if (request.headers.authorization !== `Bearer ${expectedToken}`) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    if (url.pathname === '/api/rag/scope') {
      sendJson(response, 200, {
        schemaVersion: 2,
        workspaceId: '0198f2f5-a5a3-7000-8000-000000000001',
        spaceId: '0198f2f5-a5a3-7000-8000-000000000002',
        syncTarget: {
          adapter: 'open-webui-knowledge-v1',
          baseUrl: `http://host.docker.internal:${server.address().port}`,
          knowledgeId: 'knowledge-ci',
        },
        fingerprint: 'ci-scope',
        excludedPageIds: [],
      });
      return;
    }
    if (url.pathname === '/api/rag/scope/blocked') {
      sendJson(response, 200, {
        items: [],
        hasMore: false,
        nextCursor: null,
      });
      return;
    }
    if (url.pathname === '/api/rag/updates') {
      const since = Number(url.searchParams.get('updatedSince') ?? 0);
      sendJson(response, 200, {
        items:
          since < updatedAtMs
            ? [
                {
                  type: 'page',
                  id: pageId,
                  slugId: 'ci-page',
                  title: 'CI page',
                  updatedAt: new Date(updatedAtMs).toISOString(),
                  updatedAtMs,
                },
              ]
            : [],
        hasMore: false,
        nextCursor: null,
        maxUpdatedAtMs: updatedAtMs,
      });
      return;
    }
    if (url.pathname === '/api/rag/attachments/updates') {
      sendJson(response, 200, emptyUpdateFeed);
      return;
    }
    if (
      url.pathname === '/api/rag/deleted' ||
      url.pathname === '/api/rag/attachments/deleted'
    ) {
      sendJson(response, 200, emptyDeletedFeed);
      return;
    }
    if (url.pathname === `/api/rag/pages/${pageId}`) {
      state.pageFetched = true;
      sendJson(response, 200, {
        id: pageId,
        slugId: 'ci-page',
        type: 'page',
        title: 'CI page',
        spaceId: '0198f2f5-a5a3-7000-8000-000000000002',
        databaseId: null,
        updatedAt: new Date(updatedAtMs).toISOString(),
        contentMarkdown: 'Container smoke content.',
      });
      return;
    }
    if (url.pathname === '/api/v1/knowledge/knowledge-ci/files') {
      state.knowledgeListed = true;
      const items = state.uploadCompleted ? [{ id: 'file-ci' }] : [];
      sendJson(response, 200, { items, total: items.length });
      return;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/v1/files/'
    ) {
      readRequestBody(request)
        .then((body) => {
          if (!body.includes('"knowledge_id":"knowledge-ci"')) {
            sendJson(response, 400, { error: 'missing_knowledge_id' });
            return;
          }
          state.uploadCompleted = true;
          sendJson(response, 200, { id: 'file-ci' });
        })
        .catch((error) => {
          sendJson(response, 500, { error: String(error) });
        });
      return;
    }
    if (url.pathname === '/api/v1/files/file-ci/process/status') {
      state.processingChecked = true;
      sendJson(response, 200, { status: 'completed' });
      return;
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        reject(new Error('Mock upload exceeded 1 MiB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function listen(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '0.0.0.0', () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to resolve smoke server port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
