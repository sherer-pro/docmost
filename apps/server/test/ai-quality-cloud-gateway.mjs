import assert from 'node:assert/strict';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { spawn, execFile } from 'node:child_process';
import {
  readFile,
  writeFile,
  appendFile,
  mkdir,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeLogText } from '../../../scripts/sanitize-ci-log-stream.mjs';

export const CLOUD_MODEL = 'claude-sonnet-4-6';
export const GATEWAY_TOKEN_HEADER = 'x-docmost-quality-gateway-token';
export const GATEWAY_TOKEN_ENV = 'DOCMOST_QUALITY_GATEWAY_TOKEN';
const UPSTREAM = 'https://api.anthropic.com';
const BODY_LIMIT = 2 * 1024 * 1024;
const INPUT_BOUND = 1_000_000;
const MAX_OUTPUT = 4096;
const MICRO = 1_000_000;
// Text-only admission uses one token per UTF-8 body byte plus structural headroom.
// These explicit assumptions are conservative estimates, not billing guarantees.
const STRUCTURAL_BASE = 4096;
const secretField =
  /^(api_?key|authorization|proxy_authorization|headers|extra_headers|password|secret|credentials?|access_?token|refresh_?token|auth_?token)$/i;
const allowedHeaders = new Set([
  GATEWAY_TOKEN_HEADER,
  'host',
  'connection',
  'content-type',
  'content-length',
  'transfer-encoding',
  'accept',
  'accept-encoding',
  'accept-language',
  'user-agent',
  'sec-fetch-mode',
]);
const inferenceFields = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'stream',
  'stream_options',
  'n',
  'stop',
  'response_format',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'logit_bias',
  'reasoning_effort',
  'metadata',
  'user',
  'store',
  'service_tier',
]);

export async function readCloudCredential(filename) {
  assert(
    typeof filename === 'string' && path.isAbsolute(filename),
    'An explicit absolute credential file is required',
  );
  const text = await readFile(filename, 'utf8');
  const all = [...new Set(text.match(/\bsk-[A-Za-z0-9_-]{20,}\b/g) ?? [])];
  assert(
    all.length === 1 &&
      /^sk-ant-/.test(all[0]) &&
      !/^sk-ant-(?:oat|sid|admin)/.test(all[0]),
    'A single unambiguous Anthropic API credential is required',
  );
  return all[0];
}

// Tests inject a transport; the CLI has no upstream-host or transport option.
async function fixedTransport(url, options) {
  const target = new URL(url);
  assert(
    target.origin === UPSTREAM &&
      ['/v1/models', '/v1/chat/completions'].includes(target.pathname) &&
      !target.search &&
      !target.hash,
    'Invalid cloud destination',
  );
  return new Promise((resolve, reject) => {
    const request = https.request(
      target,
      {
        method: options.method,
        headers: options.headers,
        signal: options.signal,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        servername: 'api.anthropic.com',
      },
      (response) => {
        const status = response.statusCode;
        const body = [204, 205, 304].includes(status)
          ? null
          : Readable.toWeb(response);
        if (!body) response.resume();
        resolve(
          new Response(body, {
            status,
            headers: {
              'content-type':
                response.headers['content-type'] ?? 'application/json',
            },
          }),
        );
      },
    );
    request.once('error', () => reject(new Error('Cloud transport failed')));
    request.end(options.body);
  });
}

function validateFunctionTools(value) {
  const object = (entry) =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry);
  const names = new Set();
  const validName = (name) =>
    typeof name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(name);
  if (value.tools !== undefined) {
    assert(
      Array.isArray(value.tools) && value.tools.length <= 128,
      'Invalid function tools',
    );
    for (const tool of value.tools) {
      assert(
        object(tool) &&
          tool.type === 'function' &&
          Object.keys(tool).every((key) => ['type', 'function'].includes(key)),
        'Only function tools are supported',
      );
      const fn = tool.function;
      assert(
        object(fn) && validName(fn.name) && !names.has(fn.name),
        'Invalid function identity',
      );
      assert(
        Object.keys(fn).every((key) =>
          ['name', 'description', 'parameters', 'strict'].includes(key),
        ),
        'Unsupported function field',
      );
      assert(
        fn.description === undefined || typeof fn.description === 'string',
        'Invalid function description',
      );
      assert(
        fn.strict === undefined || typeof fn.strict === 'boolean',
        'Invalid function strict flag',
      );
      const schema = fn.parameters;
      assert(
        object(schema) &&
          (schema.type === undefined || schema.type === 'object'),
        'An object parameter schema is required',
      );
      if (schema.properties !== undefined)
        assert(
          object(schema.properties) &&
            Object.values(schema.properties).every(
              (entry) => object(entry) || typeof entry === 'boolean',
            ),
          'Invalid function property schema',
        );
      if (schema.required !== undefined)
        assert(
          Array.isArray(schema.required) &&
            schema.required.every((entry) => typeof entry === 'string') &&
            new Set(schema.required).size === schema.required.length,
          'Invalid required function fields',
        );
      if (schema.additionalProperties !== undefined)
        assert(
          typeof schema.additionalProperties === 'boolean' ||
            object(schema.additionalProperties),
          'Invalid additional property schema',
        );
      names.add(fn.name);
    }
  }
  const choice = value.tool_choice;
  if (choice === undefined) return;
  if (typeof choice === 'string') {
    assert(
      ['auto', 'none', 'required'].includes(choice) &&
        (choice !== 'required' || names.size > 0),
      'Invalid function tool choice',
    );
  } else {
    assert(
      object(choice) &&
        choice.type === 'function' &&
        Object.keys(choice).every((key) =>
          ['type', 'function'].includes(key),
        ) &&
        object(choice.function) &&
        Object.keys(choice.function).every((key) => key === 'name') &&
        validName(choice.function.name) &&
        names.has(choice.function.name),
      'A named choice must select a declared function',
    );
  }
}

function validateBody(value, bytes, apiKey, token) {
  const decoded = JSON.stringify(value);
  assert(
    !decoded.includes(apiKey) && !decoded.includes(token),
    'Decoded credentials are not inference data',
  );
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Invalid inference object',
  );
  assert(
    Object.keys(value).every((key) => inferenceFields.has(key)),
    'Unsupported inference field',
  );
  assert(
    !bytes.includes(Buffer.from(apiKey)) && !bytes.includes(Buffer.from(token)),
    'Credentials are not inference data',
  );
  const inspect = (node, depth = 0) => {
    assert(depth <= 64, 'Inference nesting exceeds its limit');
    if (!node || typeof node !== 'object') return;
    for (const [key, entry] of Object.entries(node)) {
      assert(
        !secretField.test(key),
        'Credentials and header overrides are forbidden',
      );
      inspect(entry, depth + 1);
    }
  };
  inspect(value);
  assert(
    value.model === CLOUD_MODEL && (value.n === undefined || value.n === 1),
    'The fixed model and one completion are required',
  );
  const limits = [value.max_tokens, value.max_completion_tokens].filter(
    (entry) => entry !== undefined,
  );
  assert(
    limits.length &&
      limits.every(
        (entry) => Number.isInteger(entry) && entry > 0 && entry <= MAX_OUTPUT,
      ),
    'Invalid output token bound',
  );
  assert(
    value.stream === undefined || typeof value.stream === 'boolean',
    'Invalid streaming flag',
  );
  if (value.stream)
    assert(
      value.stream_options?.include_usage === true,
      'Streaming usage is required',
    );
  assert(
    Array.isArray(value.messages) &&
      value.messages.length > 0 &&
      value.messages.length <= 256,
    'Text messages are required',
  );
  for (const message of value.messages) {
    assert(
      message &&
        ['system', 'developer', 'user', 'assistant', 'tool'].includes(
          message.role,
        ),
      'Invalid message role',
    );
    assert(
      Object.keys(message).every((key) =>
        ['role', 'content', 'name', 'tool_call_id', 'tool_calls'].includes(key),
      ),
      'Unsupported message field',
    );
    if (message.role === 'tool')
      assert(
        typeof message.tool_call_id === 'string',
        'A tool result ID is required',
      );
    const content = message.content;
    if (content === null || content === undefined) {
      assert(
        message.role === 'assistant' && Array.isArray(message.tool_calls),
        'Missing text content',
      );
    } else if (typeof content !== 'string') {
      assert(
        Array.isArray(content) &&
          content.every(
            (part) =>
              part &&
              part.type === 'text' &&
              typeof part.text === 'string' &&
              Object.keys(part).every((key) => ['type', 'text'].includes(key)),
          ),
        'Only text content parts are supported',
      );
    }
    if (message.tool_calls !== undefined) {
      assert(
        message.role === 'assistant' &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.every(
            (call) =>
              call?.type === 'function' &&
              typeof call.function?.name === 'string' &&
              typeof call.function?.arguments === 'string',
          ),
        'Only function tool calls are supported',
      );
    }
  }
  validateFunctionTools(value);
  const structuralReserve =
    STRUCTURAL_BASE +
    value.messages.length * 128 +
    (value.tools?.length ?? 0) * 1024;
  return {
    maxOutput: Math.max(...limits),
    inputBound: Math.min(INPUT_BOUND, bytes.length + structuralReserve),
    structuralReserve,
  };
}

function usageCost(value, maxOutput, inputBound) {
  const fields = ['prompt_tokens', 'completion_tokens'];
  if (
    !value ||
    !fields.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
  )
    return null;
  const cacheWrite =
    value.cache_creation_input_tokens ??
    value.prompt_tokens_details?.cache_creation_tokens ??
    0;
  const cacheRead = value.cache_read_input_tokens ?? 0;
  if (
    ![cacheWrite, cacheRead].every(
      (entry) => Number.isSafeInteger(entry) && entry >= 0,
    )
  )
    return null;
  const inputTokens = value.prompt_tokens + cacheWrite + cacheRead;
  if (inputTokens > INPUT_BOUND || value.completion_tokens > MAX_OUTPUT)
    return null;
  // Cached reads get no discount; cache writes use the highest documented rate.
  const micros =
    value.prompt_tokens * 3 +
    cacheWrite * 6 +
    cacheRead * 3 +
    value.completion_tokens * 15;
  return {
    micros,
    boundExceeded:
      inputTokens > inputBound || value.completion_tokens > maxOutput,
    usage: {
      prompt_tokens: value.prompt_tokens,
      completion_tokens: value.completion_tokens,
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
    },
  };
}

function observeUsage(stream) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let usage;
  let done = false;
  let invalid = false;
  const consume = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      done = true;
      return;
    }
    try {
      const event = JSON.parse(data);
      if (event.error) invalid = true;
      if (event.usage) usage = event.usage;
    } catch {
      invalid = true;
    }
  };
  return {
    add(chunk) {
      buffer += decoder.write(chunk);
      if (buffer.length > BODY_LIMIT)
        throw new Error('Cloud response exceeds its observation limit');
      if (stream) {
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          consume(buffer.slice(0, newline).replace(/\r$/, ''));
          buffer = buffer.slice(newline + 1);
        }
      }
    },
    finish() {
      buffer += decoder.end();
      if (stream) {
        if (buffer.trim()) consume(buffer.replace(/\r$/, ''));
      } else {
        try {
          usage = JSON.parse(buffer).usage;
        } catch {
          invalid = true;
        }
      }
      return { usage, complete: !invalid && (!stream || done) };
    },
  };
}

export async function createCloudQualityGateway({
  apiKey,
  gatewayToken = randomBytes(32).toString('base64url'),
  budgetUsd = 20,
  concurrency = 1,
  transport = fixedTransport,
  onLedger = async () => {},
  timeoutMs = 660000,
}) {
  assert(
    typeof apiKey === 'string' &&
      /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey) &&
      !/^sk-ant-(?:oat|sid|admin)/.test(apiKey),
    'Invalid API credential type',
  );
  assert(
    typeof gatewayToken === 'string' &&
      /^[A-Za-z0-9_-]{32,128}$/.test(gatewayToken) &&
      gatewayToken !== apiKey,
    'Invalid gateway token',
  );
  assert(
    Number.isFinite(budgetUsd) && budgetUsd > 0 && budgetUsd <= 20,
    'Invalid cumulative budget',
  );
  assert(
    Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 4,
    'Invalid cloud concurrency',
  );
  const cap = Math.floor(budgetUsd * MICRO);
  let charged = 0,
    reserved = 0,
    inflight = 0,
    sequence = 0,
    budgetStopped = false,
    transportStopped = false,
    ledgerFailed = false,
    closing = false;
  const records = [];
  const controllers = new Set();
  const operations = new Set();
  const reply = (response, status, code) => {
    if (!response.headersSent && !response.destroyed)
      response
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { code } }));
  };
  const server = createServer((request, response) => {
    const operation = (async () => {
      const provided = Buffer.from(
        String(request.headers[GATEWAY_TOKEN_HEADER] ?? ''),
      );
      const expected = Buffer.from(gatewayToken);
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      )
        return reply(response, 401, 'gateway_authorization_required');
      if (Object.keys(request.headers).some((key) => !allowedHeaders.has(key)))
        return reply(response, 400, 'client_headers_forbidden');
      const chat =
        request.method === 'POST' && request.url === '/v1/chat/completions';
      const models = request.method === 'GET' && request.url === '/v1/models';
      if (!chat && !models)
        return reply(response, 404, 'gateway_route_forbidden');
      if (closing || ledgerFailed)
        return reply(response, 503, 'gateway_unavailable');
      if (budgetStopped) return reply(response, 402, 'gateway_budget_stopped');
      if (transportStopped)
        return reply(response, 503, 'gateway_transport_stopped');
      if (Number(request.headers['content-length'] ?? 0) > BODY_LIMIT) {
        request.resume();
        return reply(response, 413, 'gateway_body_limit');
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > BODY_LIMIT) {
          request.resume();
          return reply(response, 413, 'gateway_body_limit');
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      let parsed,
        maxOutput = 0,
        inputBound = 0,
        structuralReserve = 0;
      try {
        if (chat) {
          parsed = JSON.parse(body.toString('utf8'));
          ({ maxOutput, inputBound, structuralReserve } = validateBody(
            parsed,
            body,
            apiKey,
            gatewayToken,
          ));
        } else assert(body.length === 0, 'Model listing has no body');
      } catch {
        return reply(response, 400, 'gateway_body_rejected');
      }
      if (inflight >= concurrency)
        return reply(response, 429, 'gateway_concurrency_limit');
      const reservation = chat ? inputBound * 6 + maxOutput * 15 : 0;
      if (charged + reserved + reservation > cap) {
        budgetStopped = true;
        return reply(response, 402, 'gateway_budget_stopped');
      }
      // Admission and reservation are synchronous, before the first upstream await.
      reserved += reservation;
      inflight++;
      const controller = new AbortController();
      controllers.add(controller);
      request.once('aborted', () => controller.abort());
      response.once('close', () => {
        if (!response.writableFinished) controller.abort();
      });
      const record = {
        sequence: ++sequence,
        model: CLOUD_MODEL,
        method: request.method,
        path: request.url,
        bodySha256: createHash('sha256').update(body).digest('hex'),
        bodyBytes: body.length,
        inputTokenBound: inputBound,
        structuralReserveTokens: structuralReserve,
        maxOutputTokens: maxOutput,
        inputReserveUsdPerMillion: 6,
        outputUsdPerMillion: 15,
        status: null,
        usage: null,
        reservedUsd: reservation / MICRO,
        costUsd: null,
        chargedUsd: reservation / MICRO,
        accounting: chat ? 'reservation_retained' : 'not_billed',
        startedAt: new Date().toISOString(),
      };
      let result;
      let source;
      const requestSignal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(timeoutMs),
      ]);
      const cancelSource = () =>
        source?.destroy(new Error('Cloud response cancelled'));
      requestSignal.addEventListener('abort', cancelSource, { once: true });
      let complete = false;
      let observation;
      try {
        result = await transport(UPSTREAM + request.url, {
          method: request.method,
          redirect: 'manual',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'anthropic-version': '2023-06-01',
            accept: 'application/json, text/event-stream',
            ...(chat ? { 'content-type': 'application/json' } : {}),
          },
          ...(chat ? { body } : {}),
          signal: requestSignal,
        });
        record.status = result.status;
        if (result.status === 401 || result.status === 403)
          transportStopped = true;
        if (requestSignal.aborted) throw new Error('Cloud request cancelled');
        if (result.status >= 300 && result.status < 400)
          throw new Error('Cloud redirect rejected');
        const observer = chat ? observeUsage(parsed.stream === true) : null;
        response.writeHead(result.status, {
          'content-type':
            result.headers.get('content-type') ?? 'application/json',
        });
        if (result.body) source = Readable.fromWeb(result.body);
        if (source)
          for await (const chunk of source) {
            observer?.add(chunk);
            if (!response.write(chunk))
              await once(response, 'drain', { signal: requestSignal });
          }
        response.end();
        await finished(response, { cleanup: true });
        observation = observer?.finish();
        complete = !requestSignal.aborted;
      } catch {
        record.transportError = true;
        record.cancelled = requestSignal.aborted;
        controller.abort();
        await result?.body?.cancel().catch(() => {});
        reply(response, 502, 'cloud_request_incomplete');
        if (response.headersSent && !response.writableFinished)
          response.destroy();
      } finally {
        requestSignal.removeEventListener('abort', cancelSource);
        source?.destroy();
        const cost =
          chat && complete && result?.ok && observation?.complete
            ? usageCost(observation.usage, maxOutput, inputBound)
            : null;
        reserved -= reservation;
        if (cost) {
          charged += cost.micros;
          record.usage = cost.usage;
          record.costUsd = cost.micros / MICRO;
          record.chargedUsd = cost.micros / MICRO;
          record.accounting = 'reported_usage_conservative_price';
          if (cost.boundExceeded || cost.micros > reservation) {
            record.usageBoundExceeded = true;
            budgetStopped = true;
          }
        } else if (chat) charged += reservation;
        record.completedAt = new Date().toISOString();
        records.push(record);
        try {
          await onLedger({ ...record });
        } catch {
          ledgerFailed = true;
        }
        controllers.delete(controller);
        inflight--;
      }
    })();
    operations.add(operation);
    operation
      .catch(() => reply(response, 400, 'gateway_request_failed'))
      .finally(() => operations.delete(operation));
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let closingPromise;
  const api = {
    origin,
    baseUrl: `${origin}/v1`,
    model: CLOUD_MODEL,
    snapshot() {
      return {
        model: CLOUD_MODEL,
        capUsd: cap / MICRO,
        chargedUsd: charged / MICRO,
        reservedUsd: reserved / MICRO,
        inflight,
        budgetStopped,
        transportStopped,
        capExceeded: charged + reserved > cap,
        reportedUsageCostUsd: records.reduce(
          (sum, r) => sum + (r.costUsd ?? 0),
          0,
        ),
        retainedReservationUsd: records
          .filter((r) => r.accounting === 'reservation_retained')
          .reduce((sum, r) => sum + r.chargedUsd, 0),
        cancelledRequests: records.filter((r) => r.cancelled).length,
        costAccounting: records.some(
          (r) => r.accounting === 'reservation_retained',
        )
          ? 'reported_usage_plus_conservative_unknown_reservations'
          : 'reported_usage_estimate',
        ledgerFailed,
        retainedReservations: records.filter(
          (r) => r.accounting === 'reservation_retained',
        ).length,
        failedRequests: records.filter(
          (r) => r.transportError || r.status >= 400,
        ).length,
        inputBoundAssumptions: {
          method:
            'min(model input limit, UTF-8 body bytes + structural reserve)',
          modelInputLimit: INPUT_BOUND,
          structuralBase: STRUCTURAL_BASE,
          perMessage: 128,
          perTool: 1024,
          textOnly: true,
          maxMessages: 256,
          maxTools: 128,
          absoluteBillingGuarantee: false,
        },
        inputReserveUsdPerMillion: 6,
        outputUsdPerMillion: 15,
        records: records.map((r) => ({ ...r })),
      };
    },
    close() {
      if (closingPromise) return closingPromise;
      closing = true;
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      closingPromise = (async () => {
        await new Promise((resolve) => server.close(resolve));
        await Promise.allSettled([...operations]);
      })();
      return closingPromise;
    },
  };
  Object.defineProperty(api, 'token', {
    value: gatewayToken,
    enumerable: false,
  });
  return api;
}

export function parseCloudQualityArgs(args) {
  const allowed = new Set([
    'credential-file',
    'output',
    'scope',
    'split',
    'quality-limit',
    'subnet',
    'budget-usd',
    'concurrency',
  ]);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    assert(
      match && allowed.has(match[1]) && !Object.hasOwn(values, match[1]),
      'Invalid cloud quality option',
    );
    const value = match[2] ?? args[++i];
    assert(
      typeof value === 'string' && value.length && !value.startsWith('--'),
      'Missing cloud quality option value',
    );
    values[match[1]] = value;
  }
  const split = values.split ?? 'holdout',
    scope = values.scope ?? 'all';
  const limit = Number(values['quality-limit'] ?? 0);
  assert(
    ['tuning', 'holdout'].includes(split) &&
      ['all', 'database', 'rag'].includes(scope),
    'Invalid cloud quality selection',
  );
  assert(
    Number.isInteger(limit) && limit >= 0 && limit <= 120,
    'Invalid tuning limit',
  );
  assert(
    split !== 'holdout' || (scope === 'all' && limit === 0),
    'Holdout requires both complete scopes',
  );
  assert(
    typeof values['credential-file'] === 'string' &&
      path.isAbsolute(values['credential-file']),
    'An explicit credential file is required',
  );
  if (values.subnet)
    assert(
      /^10\.(?:\d{1,3})\.(?:\d{1,3})\.0\/28$/.test(values.subnet) &&
        values.subnet
          .split(/[./]/)
          .slice(0, 4)
          .every((part) => Number(part) <= 255),
      'Invalid isolated subnet',
    );
  return {
    credentialFile: values['credential-file'],
    output: values.output,
    split,
    scope,
    qualityLimit: limit,
    subnet: values.subnet,
    budgetUsd: Number(values['budget-usd'] ?? 20),
    concurrency: Number(values.concurrency ?? 1),
  };
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    await new Promise((resolve) =>
      execFile(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true },
        () => resolve(),
      ),
    );
  } else child.kill('SIGTERM');
  await Promise.race([
    once(child, 'close'),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

async function waitOwnedChild(child, signal) {
  let timer;
  const closed = once(child, 'close');
  const aborted = new Promise((resolve) => {
    const cancel = () => {
      timer = setTimeout(() => resolve([null]), 30000);
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    closed
      .finally(() => signal?.removeEventListener('abort', cancel))
      .catch(() => {});
  });
  try {
    return await Promise.race([closed, aborted]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runCloudQuality(
  options,
  { transport, spawnChild = spawn, signal } = {},
) {
  const repo = path.resolve(options.repo ?? process.cwd());
  const artifactRoot = path.join(repo, 'artifacts');
  const output = path.resolve(
    options.output ??
      path.join(
        artifactRoot,
        'cloud-quality',
        new Date().toISOString().replace(/[:.]/g, '-'),
      ),
  );
  assert(
    output.startsWith(artifactRoot + path.sep),
    'Cloud receipts must remain under repository artifacts',
  );
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(path.dirname(output), { recursive: true });
  const realArtifacts = await realpath(artifactRoot),
    realParent = await realpath(path.dirname(output));
  assert(
    realParent === realArtifacts ||
      realParent.startsWith(realArtifacts + path.sep),
    'Cloud receipt parent escapes artifacts',
  );
  await mkdir(output);
  const apiKey = await readCloudCredential(options.credentialFile);
  const ledgerPath = path.join(output, 'ledger.jsonl');
  const logPath = path.join(output, 'children.log');
  await writeFile(ledgerPath, '', { flag: 'wx' });
  await writeFile(logPath, '', { flag: 'wx' });
  const gateway = await createCloudQualityGateway({
    apiKey,
    budgetUsd: options.budgetUsd,
    concurrency: options.concurrency,
    ...(transport ? { transport } : {}),
    onLedger: (entry) => appendFile(ledgerPath, JSON.stringify(entry) + '\n'),
  });
  const children = [];
  const runs = [];
  const capturedIds = new Set();
  let corpusSha256;
  let child;
  let errorCode = null;
  let logWrites = Promise.resolve();
  let logFailed = false;
  const logLine = (line) => {
    logWrites = logWrites
      .then(() => appendFile(logPath, line))
      .catch(() => {
        logFailed = true;
      });
  };
  const redact = (text) =>
    sanitizeLogText(
      text
        .split(apiKey)
        .join('[REDACTED]')
        .split(gateway.token)
        .join('[REDACTED]'),
    );
  const abort = () => {
    void gateway.close();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    assert(!signal?.aborted, 'Cloud run cancelled');
    const scopes =
      options.scope === 'all' ? ['database', 'rag'] : [options.scope];
    assert(
      ['tuning', 'holdout'].includes(options.split) &&
        scopes.every((scope) => ['database', 'rag'].includes(scope)),
      'Invalid cloud selection',
    );
    assert(
      options.split !== 'holdout' ||
        (options.scope === 'all' && !options.qualityLimit),
      'Holdout requires both complete scopes',
    );
    for (const scope of scopes) {
      const args = [
        path.join(repo, 'apps/client/e2e/database/run-live.mjs'),
        '--ai-quality',
        `--quality-provider=${gateway.baseUrl}`,
        `--quality-model=${CLOUD_MODEL}`,
        `--quality-scope=${scope}`,
        `--quality-split=${options.split}`,
        ...(options.qualityLimit
          ? [`--quality-limit=${options.qualityLimit}`]
          : []),
        ...(options.subnet ? [`--subnet=${options.subnet}`] : []),
      ];
      const env = { ...process.env, [GATEWAY_TOKEN_ENV]: gateway.token };
      for (const key of [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'OPENAI_API_KEY',
      ])
        delete env[key];
      child = spawnChild(process.execPath, args, {
        cwd: repo,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(child);
      let compactResult;
      const pending = new Map();
      const discarding = new Set();
      const capture = (stream, chunk) => {
        let buffer = (pending.get(stream) ?? '') + chunk.toString('utf8');
        if (discarding.has(stream)) {
          const boundary = buffer.indexOf('\n');
          if (boundary < 0) {
            pending.set(stream, '');
            return;
          }
          buffer = buffer.slice(boundary + 1);
          discarding.delete(stream);
        }
        if (buffer.length > BODY_LIMIT) {
          const boundary = buffer.indexOf('\n', BODY_LIMIT);
          logLine('[Oversized child output withheld]\n');
          if (boundary < 0) {
            pending.set(stream, '');
            discarding.add(stream);
            return;
          }
          buffer = buffer.slice(boundary + 1);
        }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = redact(buffer.slice(0, newline + 1));
          const match = /compact result: ([^\r\n]+result\.json)/.exec(line);
          if (match) compactResult = match[1].trim();
          logLine(line);
          buffer = buffer.slice(newline + 1);
        }
        pending.set(stream, buffer);
      };
      child.stdout.on('data', (chunk) => capture('stdout', chunk));
      child.stderr.on('data', (chunk) => capture('stderr', chunk));
      const [code] = await waitOwnedChild(child, signal);
      for (const value of pending.values()) if (value) logLine(redact(value));
      await logWrites;
      if (child.exitCode !== null) child = null;
      assert(!logFailed, 'Child log is incomplete');
      assert(code === 0 && !signal?.aborted, 'Quality child failed');
      assert(compactResult, 'Quality result receipt is missing');
      const resultPath = path.resolve(repo, compactResult);
      assert(
        resultPath.startsWith(
          path.join(artifactRoot, 'database/live') + path.sep,
        ),
        'Quality result path is outside its owned artifact root',
      );
      const result = JSON.parse(await readFile(resultPath, 'utf8'));
      const capturePath = path.join(
        path.dirname(resultPath),
        'quality-runs.jsonl',
      );
      const captureBytes = await readFile(capturePath);
      const captures = captureBytes
        .toString('utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(JSON.parse);
      const configuration = JSON.parse(
        await readFile(
          path.join(path.dirname(resultPath), 'quality-configuration.json'),
          'utf8',
        ),
      );
      const expected =
        options.qualityLimit || (options.split === 'holdout' ? 80 : 120);
      assert(
        result.isolated === true &&
          result.captureComplete === true &&
          result.scope === `ai-${scope}-quality` &&
          captures.length === expected &&
          new Set(captures.map((entry) => entry.id)).size === expected,
        'Quality scope is incomplete',
      );
      assert(
        configuration.model === CLOUD_MODEL &&
          configuration.scope === scope &&
          configuration.split === options.split &&
          Array.isArray(configuration.questionIds) &&
          configuration.questionIds.length === expected &&
          captures.every(
            (entry) =>
              entry.profile === 'evidence-v1' &&
              entry.review?.human !== true &&
              configuration.questionIds.includes(entry.id),
          ),
        'Quality capture configuration differs',
      );
      assert(
        typeof configuration.corpusSha256 === 'string' &&
          /^[a-f0-9]{64}$/.test(configuration.corpusSha256) &&
          (corpusSha256 === undefined ||
            corpusSha256 === configuration.corpusSha256) &&
          captures.every((entry) => !capturedIds.has(entry.id)),
        'Quality scopes have different corpora or overlapping captures',
      );
      corpusSha256 = configuration.corpusSha256;
      for (const entry of captures) capturedIds.add(entry.id);
      assert(
        ['processesStopped', 'containersRemoved', 'runtimeRemoved'].every(
          (key) => result.cleanup?.[key] === true,
        ),
        'Quality runtime cleanup is incomplete',
      );
      runs.push({
        scope,
        split: options.split,
        expected,
        captured: captures.length,
        resultPath,
        capturePath,
        captureSha256: createHash('sha256').update(captureBytes).digest('hex'),
        cleanup: result.cleanup,
      });
      const state = gateway.snapshot();
      assert(
        !state.budgetStopped &&
          !state.transportStopped &&
          !state.ledgerFailed &&
          !state.capExceeded,
        'Cloud accounting or transport is incomplete',
      );
    }
  } catch {
    errorCode = signal?.aborted
      ? 'cloud_quality_cancelled'
      : 'cloud_quality_incomplete';
  } finally {
    signal?.removeEventListener('abort', abort);
    await gateway.close();
    await stopOwnedChild(child);
    await logWrites.catch(() => {
      errorCode ??= 'cloud_log_incomplete';
    });
    if (logFailed) errorCode ??= 'cloud_log_incomplete';
  }
  const accounting = gateway.snapshot();
  if (
    accounting.budgetStopped ||
    accounting.transportStopped ||
    accounting.capExceeded ||
    accounting.ledgerFailed ||
    accounting.inflight ||
    accounting.reservedUsd
  )
    errorCode ??= 'cloud_accounting_incomplete';
  if (!children.every((entry) => entry.exitCode !== null))
    errorCode ??= 'cloud_child_cleanup_incomplete';
  const receipt = {
    schema: 'cloud-quality-driver/v1',
    createdAt: new Date().toISOString(),
    model: CLOUD_MODEL,
    node: process.version,
    split: options.split,
    scope: options.scope,
    qualityLimit: options.qualityLimit ?? 0,
    runs,
    capturedTotal: capturedIds.size,
    corpusSha256,
    accounting,
    errorCode,
    passed: errorCode === null,
    humanReview: 'pending',
    providerBenchmarkAccepted: false,
    credentialsRecorded: false,
    childTokenEnvironmentName: GATEWAY_TOKEN_ENV,
    childrenClosed: children.every((entry) => entry.exitCode !== null),
    gatewayClosed: true,
    ledgerPath,
    logPath,
  };
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx' },
  );
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  (async () => {
    if (process.argv.slice(2).includes('--help')) {
      console.log(
        'node ai-quality-cloud-gateway.mjs --credential-file ABSOLUTE_PATH [--output artifacts/PATH] [--split holdout|tuning] [--scope all|database|rag] [--quality-limit N] [--subnet 10.x.x.0/28] [--budget-usd 20] [--concurrency 1]',
      );
      return;
    }
    assert(
      process.versions.node.split('.')[0] === '22',
      'Cloud quality requires Node 22',
    );
    const receipt = await runCloudQuality(
      parseCloudQualityArgs(process.argv.slice(2)),
      { signal: controller.signal },
    );
    console.log(
      JSON.stringify({
        passed: receipt.passed,
        model: receipt.model,
        runs: receipt.runs.length,
        accounting: {
          chargedUsd: receipt.accounting.chargedUsd,
          reservedUsd: receipt.accounting.reservedUsd,
          capUsd: receipt.accounting.capUsd,
        },
        ledgerPath: receipt.ledgerPath,
        humanReview: 'pending',
      }),
    );
    if (!receipt.passed) process.exitCode = 1;
  })()
    .catch(() => {
      console.error(
        'Cloud quality driver failed; credentials and upstream details are withheld.',
      );
      process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    });
}
