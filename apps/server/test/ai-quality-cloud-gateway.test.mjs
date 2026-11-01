import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  CLOUD_MODEL,
  GATEWAY_TOKEN_HEADER,
  GATEWAY_TOKEN_ENV,
  createCloudQualityGateway,
  readCloudCredential,
  parseCloudQualityArgs,
  runCloudQuality,
} from './ai-quality-cloud-gateway.mjs';
import { createQualityProviderProxy } from './ai-quality-provider-proxy.mjs';

const key = 'sk-ant-api03-' + 'synthetic'.repeat(8);
const token = 'gateway_test_'.padEnd(64, 'x');
const body = (extra = {}) => ({
  model: CLOUD_MODEL,
  messages: [{ role: 'user', content: 'Synthetic request' }],
  max_tokens: 64,
  temperature: 0,
  stream: true,
  stream_options: { include_usage: true },
  ...extra,
});
const sse = (usage = { prompt_tokens: 20, completion_tokens: 5 }) =>
  'data: {"choices":[{"delta":{"content":"Я"}}]}\n\n' +
  (usage ? `data: ${JSON.stringify({ choices: [], usage })}\n\n` : '') +
  'data: [DONE]\n\n';
const response = (text = sse()) =>
  new Response(text, { headers: { 'content-type': 'text/event-stream' } });
const send = (gateway, payload = body(), headers = {}) =>
  fetch(gateway.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      [GATEWAY_TOKEN_HEADER]: gateway.token,
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
async function idle(gateway) {
  for (let i = 0; i < 100; i++) {
    if (gateway.snapshot().inflight === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Gateway operation did not settle');
}

test('gateway refuses unauthenticated clients, forbidden routes, headers and unbounded inputs before transport', async () => {
  let calls = 0;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    gatewayToken: token,
    transport: async () => {
      calls++;
      return response();
    },
  });
  try {
    let result = await fetch(gateway.baseUrl + '/models');
    assert.equal(result.status, 401);
    await result.text();
    result = await fetch(gateway.baseUrl + '/models?upstream=other', {
      headers: { [GATEWAY_TOKEN_HEADER]: token },
    });
    assert.equal(result.status, 404);
    await result.text();
    for (const headers of [
      { authorization: 'Bearer not-forwarded' },
      { 'x-private-header': 'not-forwarded' },
    ]) {
      result = await send(gateway, body(), headers);
      assert.equal(result.status, 400);
      await result.text();
    }
    for (const payload of [
      '{',
      [],
      body({ model: 'another-model' }),
      body({ n: 2 }),
      body({ n: '1' }),
      body({ max_tokens: 4097 }),
      body({ max_completion_tokens: 4097 }),
      body({ max_tokens: undefined, max_completion_tokens: undefined }),
      body({ max_tokens: 0 }),
      body({ stream_options: { include_usage: false } }),
      body({ headers: { authorization: 'forbidden' } }),
      body({ metadata: { api_key: 'forbidden' } }),
      body({ audio: { voice: 'alloy' } }),
      body({
        messages: [{ role: 'user', content: 'text', audio: { data: 'AA==' } }],
      }),
      body({ messages: [{ role: 'user', content: key }] }),
      body({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: 'https://example.test/image.png' },
              },
            ],
          },
        ],
      }),
      body({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                file: { file_data: 'data:application/pdf;base64,AA==' },
              },
            ],
          },
        ],
      }),
      body({
        messages: [
          {
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: 'AA==' } }],
          },
        ],
      }),
      body({
        messages: Array.from({ length: 257 }, () => ({
          role: 'user',
          content: '',
        })),
      }),
      body({
        tools: Array.from({ length: 129 }, () => ({
          type: 'function',
          function: { name: 'test' },
        })),
      }),
    ]) {
      result = await send(gateway, payload);
      assert.equal(result.status, 400);
      await result.text();
    }
    result = await send(
      gateway,
      body({
        messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }],
      }),
    );
    assert.equal(result.status, 413);
    await result.text();
    assert.equal(calls, 0);
    assert.equal(gateway.snapshot().chargedUsd, 0);
  } finally {
    await gateway.close();
  }
});

test('reported usage above the declared text bound stops subsequent admission', async () => {
  let calls = 0;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    transport: async () => {
      calls++;
      return response(sse({ prompt_tokens: 10000, completion_tokens: 1 }));
    },
  });
  try {
    const result = await send(gateway);
    await result.text();
    await idle(gateway);
    assert.equal(gateway.snapshot().records[0].usageBoundExceeded, true);
    const denied = await send(gateway);
    assert.equal(denied.status, 402);
    await denied.text();
    assert.equal(calls, 1);
  } finally {
    await gateway.close();
  }
});

test('gateway refuses decoded credential strings and keys before transport or ledger', async () => {
  let calls = 0,
    ledgers = 0;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    gatewayToken: token,
    transport: async () => {
      calls++;
      return response();
    },
    onLedger: async () => {
      ledgers++;
    },
  });
  const escaped = (secret) =>
    [...secret]
      .map((char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
      .join('');
  try {
    for (const secret of [key, token]) {
      for (const payload of [
        body({ messages: [{ role: 'user', content: secret }] }),
        body({ metadata: { [secret]: 'value' } }),
      ]) {
        const encoded = JSON.stringify(payload)
          .split(secret)
          .join(escaped(secret));
        assert(!encoded.includes(secret));
        const result = await send(gateway, encoded);
        assert.equal(result.status, 400);
        const text = await result.text();
        assert(!text.includes(key));
        assert(!text.includes(token));
      }
    }
    assert.equal(calls, 0);
    assert.equal(ledgers, 0);
    assert.deepEqual(gateway.snapshot().records, []);
  } finally {
    await gateway.close();
  }
});

test('gateway preserves JSON request and SSE bytes while recording only bounded usage metadata', async () => {
  const seen = [];
  const ledger = [];
  const expected = sse({
    prompt_tokens: 20,
    completion_tokens: 5,
    cache_creation_input_tokens: 10,
  });
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    gatewayToken: token,
    onLedger: async (entry) => ledger.push(entry),
    transport: async (url, options) => {
      seen.push({ url, ...options });
      const bytes = Buffer.from(expected);
      return new Response(
        new ReadableStream({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 3)
              controller.enqueue(bytes.subarray(offset, offset + 3));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  try {
    const exact = JSON.stringify(body(), null, 2) + '\n';
    const result = await send(gateway, exact);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), expected);
    await idle(gateway);
    assert.equal(seen[0].url, 'https://api.anthropic.com/v1/chat/completions');
    assert.equal(seen[0].body.toString(), exact);
    assert.equal(seen[0].redirect, 'manual');
    assert.equal(seen[0].headers.authorization, 'Bearer ' + key);
    assert.equal(seen[0].headers[GATEWAY_TOKEN_HEADER], undefined);
    assert.equal(ledger.length, 1);
    assert.equal(
      ledger[0].bodySha256,
      createHash('sha256').update(exact).digest('hex'),
    );
    assert.equal(ledger[0].costUsd, 0.000195);
    assert.equal(
      ledger[0].inputTokenBound,
      Buffer.byteLength(exact) + 4096 + 128,
    );
    assert(ledger[0].reservedUsd < 0.05);
    assert.equal(gateway.snapshot().reservedUsd, 0);
    assert(!JSON.stringify(ledger).includes(key));
    assert(!JSON.stringify(ledger).includes(token));
    assert(!JSON.stringify(gateway).includes(token));
  } finally {
    await gateway.close();
  }
});

test('gateway supports max_completion_tokens and nonstream usage without rewriting bytes', async () => {
  const exactResponse =
    '{ "choices": [], "usage": {"prompt_tokens":30,"completion_tokens":7} }';
  let observed;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    transport: async (_url, options) => {
      observed = options.body.toString();
      return new Response(exactResponse, {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  try {
    const payload = body({
      max_tokens: undefined,
      max_completion_tokens: 32,
      stream: false,
    });
    const result = await send(gateway, payload);
    assert.equal(await result.text(), exactResponse);
    await idle(gateway);
    assert.equal(observed, JSON.stringify(payload));
    assert.equal(gateway.snapshot().chargedUsd, 0.000195);
  } finally {
    await gateway.close();
  }
});

test('malformed functions and unknown named choices never reach paid transport or ledger', async () => {
  let calls = 0,
    ledgers = 0;
  const tool = {
    type: 'function',
    function: {
      name: 'fixture_ok',
      parameters: { type: 'object', properties: { ok: { type: 'boolean' } } },
    },
  };
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    transport: async () => {
      calls++;
      return response();
    },
    onLedger: async () => {
      ledgers++;
    },
  });
  try {
    for (const payload of [
      body({ tools: [{ type: 'web_search' }] }),
      body({ tools: [{ type: 'function' }] }),
      body({ tools: [{ type: 'function', function: null }] }),
      body({
        tools: [
          { type: 'function', function: { name: 'bad.name', parameters: {} } },
        ],
      }),
      body({
        tools: [
          {
            type: 'function',
            function: { name: 'x'.repeat(65), parameters: {} },
          },
        ],
      }),
      body({
        tools: [
          {
            type: 'function',
            function: { name: 'fixture_ok', parameters: [] },
          },
        ],
      }),
      body({
        tools: [
          {
            type: 'function',
            function: { name: 'fixture_ok', parameters: { type: 'string' } },
          },
        ],
      }),
      body({
        tools: [
          {
            type: 'function',
            function: { name: 'fixture_ok', parameters: { properties: [] } },
          },
        ],
      }),
      body({
        tools: [
          {
            type: 'function',
            function: { name: 'fixture_ok', parameters: {}, strict: 'yes' },
          },
        ],
      }),
      body({ tools: [tool, tool] }),
      body({ tools: [tool], tool_choice: 'not-supported' }),
      body({ tool_choice: 'required' }),
      body({ tools: [], tool_choice: 'required' }),
      body({
        tools: [tool],
        tool_choice: { type: 'function', function: { name: 'unknown' } },
      }),
      body({ tools: [tool], tool_choice: { type: 'web_search' } }),
    ]) {
      const result = await send(gateway, payload);
      assert.equal(result.status, 400);
      await result.text();
    }
    assert.equal(calls, 0);
    assert.equal(ledgers, 0);
    assert.deepEqual(gateway.snapshot().records, []);
  } finally {
    await gateway.close();
  }
});

test('valid function schemas and choices pass through without rewriting', async () => {
  const seen = [];
  const tool = {
    type: 'function',
    function: {
      name: 'fixture_ok',
      description: 'Synthetic tool',
      parameters: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
      strict: true,
    },
  };
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    transport: async (_url, options) => {
      seen.push(options.body.toString());
      return response();
    },
  });
  try {
    for (const tool_choice of [
      'auto',
      'none',
      'required',
      { type: 'function', function: { name: 'fixture_ok' } },
    ]) {
      const exact = JSON.stringify(
        body({ tools: [tool], tool_choice }),
        null,
        2,
      );
      const result = await send(gateway, exact);
      assert.equal(result.status, 200);
      await result.text();
      await idle(gateway);
      assert.equal(seen.at(-1), exact);
    }
    assert.equal(seen.length, 4);
  } finally {
    await gateway.close();
  }
});

test('gateway retains missing usage reservation and stops before exceeding its cumulative admission budget', async () => {
  let calls = 0;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    budgetUsd: 0.05,
    transport: async () => {
      calls++;
      return response(sse(null));
    },
  });
  try {
    const first = await send(gateway);
    await first.text();
    await idle(gateway);
    const state = gateway.snapshot();
    assert.equal(state.retainedReservations, 1);
    assert.equal(state.chargedUsd, state.records[0].reservedUsd);
    const denied = await send(gateway);
    assert.equal(denied.status, 402);
    await denied.text();
    assert.equal(calls, 1);
    assert(gateway.snapshot().chargedUsd <= 0.05);
    assert.equal(gateway.snapshot().budgetStopped, true);
  } finally {
    await gateway.close();
  }
});

test('gateway reserves before concurrent transport and rejects excess inflight requests', async () => {
  let release;
  let calls = 0;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    concurrency: 2,
    budgetUsd: 0.05,
    transport: async () => {
      calls++;
      await held;
      return response();
    },
  });
  try {
    const first = send(gateway);
    while (!calls) await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await send(gateway);
    assert.equal(second.status, 402);
    await second.text();
    assert.equal(calls, 1);
    assert(gateway.snapshot().reservedUsd <= 0.05);
    release();
    await (await first).text();
    await idle(gateway);
    assert.equal(gateway.snapshot().reservedUsd, 0);
  } finally {
    release();
    await gateway.close();
  }
  let unblock;
  const blocker = new Promise((resolve) => {
    unblock = resolve;
  });
  const limited = await createCloudQualityGateway({
    apiKey: key,
    concurrency: 1,
    transport: async () => {
      await blocker;
      return response();
    },
  });
  try {
    const first = send(limited);
    while (!limited.snapshot().inflight)
      await new Promise((resolve) => setTimeout(resolve, 2));
    const denied = await send(limited);
    assert.equal(denied.status, 429);
    await denied.text();
    unblock();
    await (await first).text();
  } finally {
    unblock();
    await limited.close();
  }
});

test('gateway cancellation closes its upstream body and retains the payload reservation', async () => {
  let cancelled = false;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    transport: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('data: {"choices":[]}\n\n'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  try {
    const result = await send(gateway);
    const reader = result.body.getReader();
    await reader.read();
    await reader.cancel();
    await idle(gateway);
    assert.equal(cancelled, true);
    assert.equal(gateway.snapshot().retainedReservations, 1);
    assert.equal(gateway.snapshot().reservedUsd, 0);
  } finally {
    await gateway.close();
    await gateway.close();
  }
});

test('gateway rejects redirects without a second transport call', async () => {
  let calls = 0;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    transport: async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.test/leak' },
      });
    },
  });
  try {
    const result = await send(gateway);
    assert.equal(result.status, 502);
    await result.text();
    await idle(gateway);
    assert.equal(calls, 1);
    assert.equal(gateway.snapshot().retainedReservations, 1);
  } finally {
    await gateway.close();
  }
});

test('upstream authentication failures latch transport closed without probing credentials again', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const gateway = await createCloudQualityGateway({
      apiKey: key,
      transport: async () => {
        calls++;
        return new Response('{"error":"denied"}', {
          status,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    try {
      const first = await send(gateway);
      assert.equal(first.status, status);
      await first.text();
      await idle(gateway);
      const next = await send(gateway);
      assert.equal(next.status, 503);
      await next.text();
      assert.equal(calls, 1);
      assert.equal(gateway.snapshot().transportStopped, true);
    } finally {
      await gateway.close();
    }
  }
});

test('ledger failures stop admission without exposing callback secrets', async () => {
  let calls = 0;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    gatewayToken: token,
    transport: async () => {
      calls++;
      return response();
    },
    onLedger: async () => {
      throw new Error(key + token);
    },
  });
  try {
    const first = await send(gateway);
    await first.text();
    await idle(gateway);
    assert.equal(gateway.snapshot().ledgerFailed, true);
    const denied = await send(gateway);
    assert.equal(denied.status, 503);
    await denied.text();
    assert.equal(calls, 1);
    assert(!JSON.stringify(gateway.snapshot()).includes(key));
    assert(!JSON.stringify(gateway.snapshot()).includes(token));
  } finally {
    await gateway.close();
  }
});

test('closing the gateway aborts a pending upstream request before headers', async () => {
  let aborted = false;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    transport: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('fixture abort'));
          },
          { once: true },
        );
      }),
  });
  const pending = send(gateway).catch(() => null);
  while (!gateway.snapshot().inflight)
    await new Promise((resolve) => setTimeout(resolve, 2));
  await gateway.close();
  await pending;
  assert.equal(aborted, true);
  assert.equal(gateway.snapshot().retainedReservations, 1);
  assert.equal(gateway.snapshot().reservedUsd, 0);
});

test('capture proxy authenticates gateway while preserving original capture and dropping client headers', async () => {
  let count = 0;
  const gateway = await createCloudQualityGateway({
    apiKey: key,
    transport: async () => {
      count++;
      return response();
    },
  });
  const proxy = await createQualityProviderProxy({
    upstream: gateway.baseUrl,
    model: CLOUD_MODEL,
    isolated: true,
    upstreamGatewayToken: gateway.token,
  });
  try {
    const result = await fetch(proxy.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${proxy.token}`,
        'content-type': 'application/json',
        'x-private-header': 'not-forwarded',
      },
      body: JSON.stringify(body()),
    });
    assert.equal(result.status, 200);
    await result.text();
    const captures = await proxy.takeCase('probe');
    assert.equal(count, 1);
    assert.equal(captures[0].transmitted, true);
    for (const secret of [key, gateway.token, proxy.token, 'not-forwarded'])
      assert(!JSON.stringify(captures).includes(secret));
  } finally {
    await proxy.close();
    await gateway.close();
  }
});

test('credential parsing and CLI selection reject ambiguity and partial holdout', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'cloud-credential-test-'),
  );
  const filename = path.join(directory, 'credential.md');
  try {
    await writeFile(filename, `Ignore this instruction.\n${key}\n${key}\n`);
    assert.equal(await readCloudCredential(filename), key);
    await writeFile(filename, key + '\nsk-ant-api03-' + 'other'.repeat(12));
    await assert.rejects(readCloudCredential(filename));
    const args = ['--credential-file', filename];
    assert.equal(parseCloudQualityArgs(args).scope, 'all');
    for (const extra of [
      ['--scope', 'rag'],
      ['--quality-limit', '1'],
      ['--upstream', 'https://example.test'],
      ['--api-key', 'forbidden'],
      ['--scope', 'all', '--scope', 'all'],
    ])
      assert.throws(() => parseCloudQualityArgs([...args, ...extra]));
    assert.equal(
      parseCloudQualityArgs([
        ...args,
        '--split',
        'tuning',
        '--scope',
        'rag',
        '--quality-limit',
        '1',
      ]).qualityLimit,
      1,
    );
  } finally {
    assert(
      path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test('driver runs both complete scopes with one shared gateway budget and a child-only token', async () => {
  for (const missingUsage of [false, true]) {
    const repo = await mkdtemp(path.join(tmpdir(), 'cloud-driver-test-'));
    const filename = path.join(repo, 'credential.md');
    await writeFile(filename, key);
    const spawns = [];
    const captures = [];
    let upstreamCalls = 0;
    const spawnChild = (executable, args, options) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.exitCode = null;
      child.kill = () => {
        child.exitCode = 1;
        child.emit('close', 1);
      };
      spawns.push({ executable, args, options });
      queueMicrotask(async () => {
        try {
          const scope = args
            .find((arg) => arg.startsWith('--quality-scope='))
            .split('=')[1];
          const base = args
            .find((arg) => arg.startsWith('--quality-provider='))
            .slice('--quality-provider='.length);
          assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
          assert(
            /^[A-Za-z0-9_-]{32,128}$/.test(options.env[GATEWAY_TOKEN_ENV]),
          );
          assert(
            !args.some(
              (arg) =>
                arg.includes(options.env[GATEWAY_TOKEN_ENV]) ||
                arg.includes(key),
            ),
          );
          const inference = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: {
              [GATEWAY_TOKEN_HEADER]: options.env[GATEWAY_TOKEN_ENV],
              'content-type': 'application/json',
            },
            body: JSON.stringify(body()),
          });
          assert.equal(inference.status, 200);
          await inference.text();
          const directory = path.join(repo, 'artifacts/database/live', scope);
          await mkdir(directory, { recursive: true });
          const rows = Array.from({ length: 80 }, (_, i) => ({
            id: `${scope}-${i}`,
            profile: 'evidence-v1',
            answer: 'Synthetic captured answer',
            review: { human: false },
          }));
          const raw =
            rows.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
          const capturePath = path.join(directory, 'quality-runs.jsonl');
          await writeFile(capturePath, raw);
          captures.push({ capturePath, raw });
          await writeFile(
            path.join(directory, 'quality-configuration.json'),
            JSON.stringify({
              model: CLOUD_MODEL,
              scope,
              split: 'holdout',
              corpusSha256: 'a'.repeat(64),
              questionIds: rows.map((row) => row.id),
            }),
          );
          const resultPath = path.join(directory, 'result.json');
          await writeFile(
            resultPath,
            JSON.stringify({
              isolated: true,
              captureComplete: true,
              scope: `ai-${scope}-quality`,
              cleanup: {
                processesStopped: true,
                containersRemoved: true,
                runtimeRemoved: true,
              },
            }),
          );
          child.stdout.write(key.slice(0, 17));
          child.stdout.write(key.slice(17) + '\n');
          const secret = options.env[GATEWAY_TOKEN_ENV];
          child.stderr.write(secret.slice(0, 13));
          child.stderr.write(secret.slice(13) + '\n');
          child.stdout.end(
            `Quality capture complete; compact result: ${path.relative(repo, resultPath)}\n`,
          );
          child.stderr.end();
          child.exitCode = 0;
          child.emit('close', 0);
        } catch (error) {
          child.exitCode = 1;
          child.emit('error', error);
          child.emit('close', 1);
        }
      });
      return child;
    };
    try {
      const result = await runCloudQuality(
        {
          repo,
          credentialFile: filename,
          output: path.join(repo, 'artifacts/cloud-driver'),
          split: 'holdout',
          scope: 'all',
          qualityLimit: 0,
          budgetUsd: 20,
          concurrency: 1,
        },
        {
          spawnChild,
          transport: async () => {
            upstreamCalls++;
            return response(
              missingUsage && upstreamCalls === 1 ? sse(null) : sse(),
            );
          },
        },
      );
      assert.equal(result.passed, true);
      assert.equal(result.runs.length, 2);
      assert.equal(result.capturedTotal, 160);
      assert.deepEqual(
        result.runs.map((run) => run.scope),
        ['database', 'rag'],
      );
      assert.equal(result.accounting.records.length, 2);
      assert.equal(
        result.accounting.reportedUsageCostUsd,
        missingUsage ? 0.000135 : 0.00027,
      );
      assert.equal(
        result.accounting.retainedReservations,
        missingUsage ? 1 : 0,
      );
      assert.equal(
        result.accounting.costAccounting,
        missingUsage
          ? 'reported_usage_plus_conservative_unknown_reservations'
          : 'reported_usage_estimate',
      );
      assert.equal(result.childrenClosed, true);
      const firstToken = spawns[0].options.env[GATEWAY_TOKEN_ENV];
      assert.equal(spawns[1].options.env[GATEWAY_TOKEN_ENV], firstToken);
      const log = await readFile(result.logPath, 'utf8');
      const serialized =
        JSON.stringify(result) +
        (await readFile(result.ledgerPath, 'utf8')) +
        log;
      assert(!serialized.includes(key));
      assert(!serialized.includes(firstToken));
      assert(log.includes('[REDACTED]'));
      for (const capture of captures)
        assert.equal(await readFile(capture.capturePath, 'utf8'), capture.raw);
      const provider = spawns[0].args
        .find((arg) => arg.startsWith('--quality-provider='))
        .slice('--quality-provider='.length);
      await assert.rejects(
        fetch(provider + '/models', {
          headers: { [GATEWAY_TOKEN_HEADER]: firstToken },
        }),
      );
    } finally {
      assert(path.resolve(repo).startsWith(path.resolve(tmpdir()) + path.sep));
      await rm(repo, { recursive: true, force: true });
    }
  }
});

test('driver returns failure and closes its gateway when its owned child fails', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'cloud-driver-test-'));
  const filename = path.join(repo, 'credential.md');
  await writeFile(filename, key);
  let child;
  const spawnChild = () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.exitCode = 1;
      child.emit('close', 1);
    });
    return child;
  };
  try {
    const result = await runCloudQuality(
      {
        repo,
        credentialFile: filename,
        output: path.join(repo, 'artifacts/cloud-failed'),
        split: 'tuning',
        scope: 'rag',
        qualityLimit: 1,
      },
      {
        spawnChild,
        transport: async () => {
          assert.fail('Failed child must not make an upstream request');
        },
      },
    );
    assert.equal(result.passed, false);
    assert.equal(result.childrenClosed, true);
    assert.equal(result.gatewayClosed, true);
    assert.equal(result.accounting.chargedUsd, 0);
    assert.equal(child.exitCode, 1);
  } finally {
    assert(path.resolve(repo).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(repo, { recursive: true, force: true });
  }
});
