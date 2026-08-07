import { pathToFileURL } from 'node:url';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:3000/mcp';
const DEFAULT_RAG_ENDPOINT = 'http://127.0.0.1:3000/api/rag/pages?limit=1';
const PROTOCOL_VERSION = '2025-06-18';

function parseJsonResponse(text, contentType) {
  if (!text) return null;
  if (contentType.includes('text/event-stream')) {
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== '[DONE]');
    for (const line of dataLines.reverse()) {
      try {
        return JSON.parse(line);
      } catch {
        // Ignore non-JSON SSE frames and keep looking for the protocol payload.
      }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request(endpoint, token, options = {}) {
  const headers = {
    accept: 'application/json, text/event-stream',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(options.contentType === false
      ? {}
      : { 'content-type': options.contentType ?? 'application/json' }),
  };
  const response = await fetch(endpoint, {
    method: options.method ?? 'POST',
    headers,
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body),
    redirect: 'manual',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  return {
    status: response.status,
    contentType: contentType.split(';')[0],
    payload: parseJsonResponse(text, contentType),
  };
}

function rpc(method, params, id) {
  return { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
}

function summarize(name, response, passed, details = {}) {
  return {
    name,
    passed,
    status: response.status,
    rpcErrorCode: response.payload?.error?.code ?? null,
    ...details,
  };
}

export async function auditInboundMcp(options = {}) {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const ragEndpoint = options.ragEndpoint ?? DEFAULT_RAG_ENDPOINT;
  const mcpToken = options.mcpToken;
  const ragToken = options.ragToken;
  const readToolName = options.readToolName ?? 'getTree';
  const writeToolName = options.writeToolName ?? 'editPageText';
  const checks = [];

  if (!mcpToken) {
    throw new Error('DOCMOST_MCP_TOKEN is required');
  }

  const initialize = await request(
    endpoint,
    mcpToken,
    {
      body: rpc(
        'initialize',
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'docmost-inbound-audit', version: '1.0.0' },
        },
        1,
      ),
    },
  );
  checks.push(
    summarize(
      'initialize',
      initialize,
      initialize.status === 200 && Boolean(initialize.payload?.result),
      {
        protocolVersion: initialize.payload?.result?.protocolVersion ?? null,
        serverName: initialize.payload?.result?.serverInfo?.name ?? null,
      },
    ),
  );

  const toolsList = await request(endpoint, mcpToken, {
    body: rpc('tools/list', {}, 2),
  });
  const tools = Array.isArray(toolsList.payload?.result?.tools)
    ? toolsList.payload.result.tools
    : [];
  const toolNames = tools
    .map((tool) => tool?.name)
    .filter((name) => typeof name === 'string')
    .sort();
  const unsafeAnnotations = tools.filter(
    (tool) => tool?.annotations?.readOnlyHint !== true,
  );
  checks.push(
    summarize(
      'tools/list is read-only',
      toolsList,
      toolsList.status === 200 &&
        toolNames.length > 0 &&
        !toolNames.includes(writeToolName) &&
        unsafeAnnotations.length === 0,
      { toolCount: toolNames.length, toolNames },
    ),
  );

  const readCall = await request(endpoint, mcpToken, {
    body: rpc('tools/call', { name: readToolName, arguments: {} }, 3),
  });
  checks.push(
    summarize(
      'read tool call',
      readCall,
      readCall.status === 200 && readCall.payload?.result?.isError !== true,
      { tool: readToolName },
    ),
  );

  const writeCall = await request(endpoint, mcpToken, {
    body: rpc('tools/call', { name: writeToolName, arguments: {} }, 4),
  });
  checks.push(
    summarize(
      'write tool denied',
      writeCall,
      writeCall.status >= 400 ||
        Boolean(writeCall.payload?.error) ||
        writeCall.payload?.result?.isError === true,
      { tool: writeToolName },
    ),
  );

  const replay = await Promise.all([
    request(endpoint, mcpToken, { body: rpc('tools/list', {}, 5) }),
    request(endpoint, mcpToken, { body: rpc('tools/list', {}, 6) }),
  ]);
  checks.push({
    name: 'stateless replay',
    passed: replay.every(
      (response) =>
        response.status === 200 && Array.isArray(response.payload?.result?.tools),
    ),
    statuses: replay.map((response) => response.status),
  });

  const invalidBearer = await request(endpoint, 'invalid-audit-token', {
    body: rpc('tools/list', {}, 7),
  });
  checks.push(
    summarize(
      'invalid bearer denied',
      invalidBearer,
      invalidBearer.status === 401,
    ),
  );

  const wrongContentType = await request(endpoint, mcpToken, {
    body: JSON.stringify(rpc('tools/list', {}, 8)),
    contentType: false,
  });
  checks.push(
    summarize(
      'wrong content type denied',
      wrongContentType,
      wrongContentType.status >= 400,
    ),
  );

  const malformedJson = await request(endpoint, mcpToken, {
    body: '{',
  });
  checks.push(
    summarize(
      'malformed JSON denied',
      malformedJson,
      malformedJson.status >= 400,
    ),
  );

  const malformedRpc = await request(endpoint, mcpToken, {
    body: { jsonrpc: '1.0', id: 9, method: 'tools/list' },
  });
  checks.push(
    summarize(
      'malformed JSON-RPC denied',
      malformedRpc,
      malformedRpc.status >= 400 || Boolean(malformedRpc.payload?.error),
    ),
  );

  const unknownMethod = await request(endpoint, mcpToken, {
    body: rpc('pages/create', {}, 10),
  });
  checks.push(
    summarize(
      'unknown method denied',
      unknownMethod,
      unknownMethod.status >= 400 ||
        unknownMethod.payload?.error?.code === -32601,
    ),
  );

  if (ragToken) {
    const ragAsMcp = await request(endpoint, ragToken, {
      body: rpc('tools/list', {}, 11),
    });
    checks.push(
      summarize('RAG key denied by MCP', ragAsMcp, ragAsMcp.status === 401),
    );

    const mcpAsRag = await request(ragEndpoint, mcpToken, { method: 'GET' });
    checks.push(
      summarize('MCP key denied by RAG', mcpAsRag, mcpAsRag.status === 401),
    );
  }

  const concurrency = Math.max(0, Number(options.concurrency ?? 0));
  if (concurrency > 0) {
    const responses = await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        request(endpoint, mcpToken, {
          body: rpc('tools/list', {}, 100 + index),
        }),
      ),
    );
    checks.push({
      name: 'concurrency probe',
      passed: responses.every((response) =>
        [200, 429, 503].includes(response.status),
      ),
      statuses: responses.map((response) => response.status),
    });
  }

  const rateRequests = Math.max(0, Number(options.rateRequests ?? 0));
  if (rateRequests > 0) {
    const statuses = [];
    for (let index = 0; index < rateRequests; index += 1) {
      const response = await request(endpoint, mcpToken, {
        body: rpc('tools/list', {}, 1_000 + index),
      });
      statuses.push(response.status);
    }
    checks.push({
      name: 'rate limit probe',
      passed: statuses.includes(429),
      statuses,
    });
  }

  return {
    endpoint: new URL(endpoint).origin + new URL(endpoint).pathname,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function main() {
  const result = await auditInboundMcp({
    endpoint: process.env.DOCMOST_MCP_ENDPOINT,
    ragEndpoint: process.env.DOCMOST_RAG_ENDPOINT,
    mcpToken: process.env.DOCMOST_MCP_TOKEN,
    ragToken: process.env.DOCMOST_RAG_TOKEN,
    readToolName: process.env.DOCMOST_MCP_READ_TOOL,
    writeToolName: process.env.DOCMOST_MCP_WRITE_TOOL,
    concurrency: process.env.DOCMOST_MCP_CONCURRENCY,
    rateRequests: process.env.DOCMOST_MCP_RATE_REQUESTS,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (
  typeof process !== 'undefined' &&
  process.argv?.[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        passed: false,
        error: error instanceof Error ? error.message : 'Audit client failed',
      }),
    );
    process.exitCode = 1;
  });
}
