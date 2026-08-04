import {
  AiMcpFetchLike,
  AiMcpTransportError,
  createAiMcpPinnedFetch,
} from './ai-mcp-pinned-fetch';

const APPROVED = 'https://mcp.example.test/mcp';
const ADDRESSES = [{ address: '203.0.113.10', family: 4 as const }];

type RecordedCall = { url: string; init: RequestInit };

/**
 * Typed capture instead of `jest.fn`, whose inferred signature for an
 * argument-less implementation makes `mock.calls` an empty tuple.
 */
function recordingFetch(impl: () => Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchImpl: AiMcpFetchLike = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return impl();
  };
  return { fetchImpl, calls };
}

function build(
  impl: () => Promise<Response>,
  overrides?: { maxWireBytes?: number },
) {
  const { fetchImpl, calls } = recordingFetch(impl);
  const guard = createAiMcpPinnedFetch({
    approvedHref: APPROVED,
    addresses: ADDRESSES,
    // Skip the real undici dispatcher: this spec covers the guard, and
    // ai-pinned-http.util.spec.ts already covers address pinning.
    dispatcher: null,
    fetchImpl,
    ...overrides,
  });
  return { guard, calls };
}

function jsonResponse(body: string, init?: ResponseInit) {
  return new Response(body, init);
}

describe('createAiMcpPinnedFetch redirect handling', () => {
  it.each([301, 302, 303, 307, 308])(
    'rejects a %s response even though the SDK omits requestInit on the SSE stream',
    async (status) => {
      const { guard } = build(async () =>
        jsonResponse('', { status, headers: { location: 'https://evil.test' } }),
      );

      await expect(guard.fetch(APPROVED, { method: 'GET' })).rejects.toThrow(
        /redirects are not permitted/,
      );
    },
  );

  it('forces redirect manual on every request, including one with no init', async () => {
    const { guard, calls } = build(async () => jsonResponse('{}'));

    await guard.fetch(APPROVED);
    await guard.fetch(APPROVED, { method: 'POST', body: '{}' });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.init.redirect).toBe('manual');
    }
  });

  it('does not let a caller override redirect back to follow', async () => {
    const { guard, calls } = build(async () => jsonResponse('{}'));

    await guard.fetch(APPROVED, { redirect: 'follow' });

    expect(calls[0].init.redirect).toBe('manual');
  });

  it('rejects an opaque redirect response type', async () => {
    const opaque = { type: 'opaqueredirect', status: 200, body: null } as never;
    const { guard } = build(async () => opaque);

    await expect(guard.fetch(APPROVED)).rejects.toThrow(
      /redirects are not permitted/,
    );
  });

  it('passes a 200 response through', async () => {
    const { guard } = build(async () => jsonResponse('{}'));

    await expect(guard.fetch(APPROVED)).resolves.toMatchObject({ status: 200 });
  });
});

describe('createAiMcpPinnedFetch URL drift guard', () => {
  it.each([
    ['a different host', 'https://evil.test/mcp'],
    ['a different path', 'https://mcp.example.test/other'],
    ['an added query string', 'https://mcp.example.test/mcp?x=1'],
    ['a downgraded scheme', 'http://mcp.example.test/mcp'],
    ['a different port', 'https://mcp.example.test:8443/mcp'],
  ])('rejects %s', async (_label, href) => {
    const { guard, calls } = build(async () => jsonResponse('{}'));

    await expect(guard.fetch(href)).rejects.toBeInstanceOf(AiMcpTransportError);
    expect(calls).toHaveLength(0);
  });

  it('accepts the approved URL passed as a URL object', async () => {
    const { guard } = build(async () => jsonResponse('{}'));

    await expect(guard.fetch(new URL(APPROVED))).resolves.toBeDefined();
  });
});

describe('createAiMcpPinnedFetch abort wiring', () => {
  it('injects the lease signal when the transport supplied none', async () => {
    const { guard, calls } = build(async () => jsonResponse('{}'));

    await guard.fetch(APPROVED);
    const signal = calls[0].init.signal as AbortSignal;

    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
    guard.abort();
    expect(signal.aborted).toBe(true);
  });

  it('aborts when either the transport signal or the lease signal fires', async () => {
    const { guard, calls } = build(async () => jsonResponse('{}'));
    const transportController = new AbortController();

    await guard.fetch(APPROVED, { signal: transportController.signal });
    const combined = calls[0].init.signal as AbortSignal;

    expect(combined.aborted).toBe(false);
    transportController.abort();
    expect(combined.aborted).toBe(true);
  });

  it('aborts a request issued after close', async () => {
    const { guard, calls } = build(async () => jsonResponse('{}'));

    await guard.close();
    await guard.fetch(APPROVED);

    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
  });
});

describe('createAiMcpPinnedFetch byte cap', () => {
  it('rejects up front when content-length declares an oversized body', async () => {
    const { guard } = build(
      async () => jsonResponse('x', { headers: { 'content-length': '999999' } }),
      { maxWireBytes: 64 },
    );

    await expect(guard.fetch(APPROVED)).rejects.toThrow(/size limit/);
  });

  it('errors a streaming body once it passes the cap', async () => {
    const { guard } = build(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              // Never closes, like an SSE stream that keeps sending.
              for (let index = 0; index < 10; index += 1) {
                controller.enqueue(new Uint8Array(32));
              }
            },
          }),
        ),
      { maxWireBytes: 64 },
    );

    const response = await guard.fetch(APPROVED);

    await expect(response.text()).rejects.toThrow(/size limit/);
  });

  it('passes a body through unchanged when it stays under the cap', async () => {
    const { guard } = build(async () => jsonResponse('{"ok":true}'), {
      maxWireBytes: 1024,
    });

    const response = await guard.fetch(APPROVED);

    expect(await response.text()).toBe('{"ok":true}');
    expect(guard.wireBytes()).toBe(11);
  });

  it('accumulates wire bytes across requests on one connection', async () => {
    const { guard } = build(async () => jsonResponse('12345'), {
      maxWireBytes: 1024,
    });

    await (await guard.fetch(APPROVED)).text();
    await (await guard.fetch(APPROVED)).text();

    expect(guard.wireBytes()).toBe(10);
  });

  it('tolerates a response with no body', async () => {
    const { guard } = build(async () => new Response(null, { status: 202 }));

    const response = await guard.fetch(APPROVED);

    expect(response.status).toBe(202);
    expect(guard.wireBytes()).toBe(0);
  });

  it('preserves status and headers while wrapping the body', async () => {
    const { guard } = build(async () =>
      jsonResponse('data', {
        status: 200,
        headers: { 'mcp-session-id': 'abc', 'content-type': 'text/plain' },
      }),
    );

    const response = await guard.fetch(APPROVED);

    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBe('abc');
    expect(response.headers.get('content-type')).toBe('text/plain');
  });
});
