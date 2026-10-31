import assert from 'node:assert/strict';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Test-only observer for synthetic, isolated benchmark traffic.
export async function createQualityProviderProxy({
  upstream,
  model,
  isolated,
  onCapture = async () => {},
  timeoutMs = 660000,
}) {
  assert.equal(
    isolated,
    true,
    'Provider capture requires an isolated synthetic runtime',
  );
  const target = new URL(upstream);
  assert(
    target.protocol === 'http:' &&
      target.hostname === '127.0.0.1' &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash &&
      /^\/v1\/?$/.test(target.pathname),
    'Capture upstream must be an unauthenticated loopback OpenAI endpoint',
  );
  assert(
    typeof model === 'string' && model.length > 0 && model.length <= 256,
    'A fixed model is required',
  );
  const token = randomBytes(32).toString('hex');
  let caseId = 'probe';
  let sequence = 0;
  let captureFailure;
  const captures = new Map();
  const active = new Set();
  const controllers = new Set();
  const reply = (response, code, message) => {
    if (!response.headersSent && !response.destroyed)
      response
        .writeHead(code, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message } }));
  };
  const server = createServer((request, response) => {
    const operation = (async () => {
      const provided = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      )
        return reply(response, 401, 'Synthetic capture authorization required');
      const pathname = request.url;
      const chat =
        pathname === '/v1/chat/completions' && request.method === 'POST';
      const models = pathname === '/v1/models' && request.method === 'GET';
      if (!chat && !models)
        return reply(
          response,
          404,
          'Only model listing and chat inference are allowed',
        );
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024)
          return reply(response, 413, 'Capture request exceeds its limit');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      let parsed;
      if (chat) {
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          return reply(response, 400, 'Invalid JSON');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          return reply(response, 400, 'An inference object is required');
        if (
          Object.keys(parsed).some((key) =>
            /^(api_?key|authorization|headers|extra_headers|password|secret)$/i.test(
              key,
            ),
          )
        )
          return reply(
            response,
            400,
            'Credentials are not accepted in the body',
          );
        if (parsed.model !== model || !Array.isArray(parsed.messages))
          return reply(
            response,
            400,
            'The fixed model and messages are required',
          );
      }
      const label = caseId;
      const controller = new AbortController();
      controllers.add(controller);
      request.once('aborted', () => controller.abort());
      response.once('close', () => {
        if (!response.writableFinished) controller.abort();
      });
      const record = chat
        ? {
            caseId: label,
            sequence: ++sequence,
            startedAt: new Date().toISOString(),
            requestHash: createHash('sha256').update(body).digest('hex'),
            model: parsed.model,
            messages: parsed.messages,
            tools: parsed.tools ?? null,
            parameters: Object.fromEntries(
              [
                'temperature',
                'top_p',
                'max_tokens',
                'max_completion_tokens',
                'stream',
                'tool_choice',
              ]
                .filter((key) => parsed[key] !== undefined)
                .map((key) => [key, parsed[key]]),
            ),
            status: null,
            transmitted: false,
          }
        : null;
      try {
        // Credentials and arbitrary client headers never reach the upstream.
        const result = await fetch(`${target.origin}${pathname}`, {
          method: request.method,
          redirect: 'error',
          headers: {
            accept: 'application/json, text/event-stream',
            ...(chat ? { 'content-type': 'application/json' } : {}),
          },
          ...(chat ? { body } : {}),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(timeoutMs),
          ]),
        });
        if (record) {
          record.status = result.status;
          record.transmitted = result.ok;
        }
        response.writeHead(result.status, {
          'content-type':
            result.headers.get('content-type') ?? 'application/json',
        });
        if (result.body)
          await pipeline(Readable.fromWeb(result.body), response);
        else response.end();
      } catch {
        if (record) record.transportError = true;
        reply(response, 502, 'The selected loopback provider did not complete');
        if (response.headersSent && !response.writableFinished)
          response.destroy();
      } finally {
        controllers.delete(controller);
        if (record) {
          record.completedAt = new Date().toISOString();
          const entries = captures.get(label) ?? [];
          entries.push(record);
          captures.set(label, entries);
          try {
            await onCapture(record);
          } catch (error) {
            captureFailure ??= error;
          }
        }
      }
    })();
    active.add(operation);
    operation
      .catch(() => reply(response, 500, 'Capture failed'))
      .finally(() => active.delete(operation));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = {
    origin,
    baseUrl: `${origin}/v1`,
    model,
    setCase(value) {
      assert(
        typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value),
        'Invalid synthetic case ID',
      );
      caseId = value;
    },
    async takeCase(value) {
      await Promise.allSettled([...active]);
      if (captureFailure) throw captureFailure;
      const result = captures.get(value) ?? [];
      captures.delete(value);
      return result;
    },
    async close() {
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled([...active]);
      if (captureFailure) throw captureFailure;
    },
  };
  // Prevent an accidental metadata spread or JSON serialization from saving it.
  Object.defineProperty(api, 'token', { value: token, enumerable: false });
  return api;
}
