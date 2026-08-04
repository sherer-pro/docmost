import { encryptProtectedValue } from '../../../common/security/credential-protection.util';
import {
  decryptAiMcpHeaders,
  encryptAiMcpHeaders,
  validateAiMcpHeaders,
} from './ai-mcp-headers.util';
import {
  AI_MCP_MAX_HEADER_VALUE_BYTES,
  AI_MCP_MAX_HEADERS,
} from './ai-mcp.constants';

const APP_SECRET = 'test-app-secret-that-is-long-enough-for-derivation';

// Built from char codes so no literal control character appears in the source.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);
const NON_ASCII = String.fromCharCode(233);

function expectRejected(input: unknown): string {
  const result = validateAiMcpHeaders(input);
  expect(result.status).toBe('rejected');
  return result.status === 'rejected' ? result.reason : '';
}

describe('validateAiMcpHeaders blocklist', () => {
  it.each([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
    'via',
    'cookie',
    'set-cookie',
    'host',
    'content-length',
    'content-type',
    'accept',
    'accept-encoding',
    'mcp-session-id',
    'mcp-protocol-version',
    'last-event-id',
  ])('rejects %s', (name) => {
    expect(expectRejected({ [name]: 'value' })).toMatch(/not allowed/);
  });

  it.each([
    ['MCP-Session-Id'],
    ['COOKIE'],
    ['Transfer-Encoding'],
    ['X-Forwarded-For'],
    ['HoSt'],
  ])('rejects %s regardless of casing', (name) => {
    expect(expectRejected({ [name]: 'value' })).toMatch(/not allowed/);
  });

  it('rejects a blocked header padded with surrounding whitespace', () => {
    expect(expectRejected({ '  cookie  ': 'value' })).toMatch(/not allowed/);
  });

  it('allows an Authorization header and normalizes its name to lower case', () => {
    const result = validateAiMcpHeaders({ Authorization: 'Bearer token' });
    expect(result).toEqual({
      status: 'ok',
      headers: { authorization: 'Bearer token' },
      names: ['authorization'],
    });
  });

  it('rejects two spellings of the same header name', () => {
    expect(expectRejected({ Authorization: 'a', authorization: 'b' })).toMatch(
      /duplicated/,
    );
  });

  it('returns names sorted, so a response never leaks insertion order', () => {
    const result = validateAiMcpHeaders({
      'x-zeta': '1',
      authorization: '2',
      'x-alpha': '3',
    });
    expect(result.status === 'ok' && result.names).toEqual([
      'authorization',
      'x-alpha',
      'x-zeta',
    ]);
  });
});

describe('validateAiMcpHeaders value hygiene', () => {
  it.each([
    ['carriage return', `a${CR}b`],
    ['line feed', `a${LF}b`],
    ['CRLF injection', `a${CR}${LF}X-Injected: 1`],
    ['null byte', `a${NUL}b`],
    ['DEL character', `a${DEL}b`],
    ['non-ASCII character', `a${NON_ASCII}b`],
  ])('rejects a value containing a %s', (_label, value) => {
    expect(expectRejected({ 'x-token': value })).toMatch(/value is invalid/);
  });

  it('accepts a tab inside a value', () => {
    expect(validateAiMcpHeaders({ 'x-token': `a${String.fromCharCode(9)}b` }).status).toBe('ok');
  });

  it('accepts an empty value', () => {
    expect(validateAiMcpHeaders({ 'x-token': '' }).status).toBe('ok');
  });

  it.each([['x token'], ['x:token'], [''], ['x/token'], ['x(token)']])(
    'rejects the invalid header name %p',
    (name) => {
      expect(expectRejected({ [name]: 'v' })).toMatch(/name is invalid/);
    },
  );

  it('rejects a non-ASCII header name', () => {
    expect(expectRejected({ [`x-${NON_ASCII}`]: 'v' })).toMatch(
      /name is invalid/,
    );
  });

  it('rejects a non-string value', () => {
    expect(expectRejected({ 'x-token': 42 })).toMatch(/must be a string/);
  });

  it.each([[null], [undefined], ['string'], [[]], [42]])(
    'rejects a non-object header map: %p',
    (input) => {
      expect(expectRejected(input)).toMatch(/must be an object/);
    },
  );

  it('accepts an empty header map', () => {
    expect(validateAiMcpHeaders({})).toEqual({
      status: 'ok',
      headers: {},
      names: [],
    });
  });
});

describe('validateAiMcpHeaders size limits', () => {
  it('rejects more than the allowed number of headers', () => {
    const headers: Record<string, string> = {};
    for (let index = 0; index < AI_MCP_MAX_HEADERS + 1; index += 1) {
      headers[`x-h${index}`] = 'v';
    }
    expect(expectRejected(headers)).toMatch(/At most/);
  });

  it('accepts exactly the allowed number of headers', () => {
    const headers: Record<string, string> = {};
    for (let index = 0; index < AI_MCP_MAX_HEADERS; index += 1) {
      headers[`x-h${index}`] = 'v';
    }
    expect(validateAiMcpHeaders(headers).status).toBe('ok');
  });

  it('rejects an oversized single value', () => {
    expect(
      expectRejected({
        'x-token': 'a'.repeat(AI_MCP_MAX_HEADER_VALUE_BYTES + 1),
      }),
    ).toMatch(/value is too large/);
  });

  it('accepts a value at exactly the per-value limit', () => {
    expect(
      validateAiMcpHeaders({
        'x-token': 'a'.repeat(AI_MCP_MAX_HEADER_VALUE_BYTES),
      }).status,
    ).toBe('ok');
  });

  it('rejects a set of values that exceeds the total limit', () => {
    const headers: Record<string, string> = {};
    for (let index = 0; index < 8; index += 1) {
      headers[`x-h${index}`] = 'a'.repeat(AI_MCP_MAX_HEADER_VALUE_BYTES);
    }
    expect(expectRejected(headers)).toMatch(/total size limit/);
  });
});

describe('external MCP header encryption', () => {
  it('round-trips a header map through one envelope', () => {
    const headers = { authorization: 'Bearer secret', 'x-api-key': 'abc' };
    const ciphertext = encryptAiMcpHeaders(headers, APP_SECRET);
    expect(ciphertext).not.toBeNull();
    expect(decryptAiMcpHeaders(ciphertext, APP_SECRET)).toEqual(headers);
  });

  it('stores the whole map as a single envelope, not one per header', () => {
    const ciphertext = encryptAiMcpHeaders(
      { a: '1', b: '2', c: '3' },
      APP_SECRET,
    );
    expect(ciphertext?.startsWith('enc:v1:')).toBe(true);
    expect(ciphertext?.split('enc:v1:')).toHaveLength(2);
  });

  it('never exposes a plaintext value in the ciphertext', () => {
    const ciphertext = encryptAiMcpHeaders(
      { authorization: 'Bearer super-secret-token' },
      APP_SECRET,
    );
    expect(ciphertext).not.toContain('super-secret-token');
    expect(ciphertext).not.toContain('Bearer');
  });

  it('produces a different ciphertext each time for the same input', () => {
    const first = encryptAiMcpHeaders({ a: 'same' }, APP_SECRET);
    const second = encryptAiMcpHeaders({ a: 'same' }, APP_SECRET);
    expect(first).not.toBe(second);
  });

  it('returns null for an empty map so storage can hold SQL NULL', () => {
    expect(encryptAiMcpHeaders({}, APP_SECRET)).toBeNull();
  });

  it('returns an empty map for a null ciphertext', () => {
    expect(decryptAiMcpHeaders(null, APP_SECRET)).toEqual({});
  });

  it('throws rather than silently connecting without credentials on a wrong secret', () => {
    const ciphertext = encryptAiMcpHeaders(
      { authorization: 'Bearer secret' },
      APP_SECRET,
    );
    expect(() =>
      decryptAiMcpHeaders(ciphertext, 'a-different-application-secret'),
    ).toThrow();
  });

  it('throws on a tampered envelope', () => {
    const ciphertext = encryptAiMcpHeaders(
      { authorization: 'Bearer secret' },
      APP_SECRET,
    ) as string;
    const tampered = `${ciphertext.slice(0, -4)}AAAA`;
    expect(() => decryptAiMcpHeaders(tampered, APP_SECRET)).toThrow();
  });

  it.each([
    ['an array', '["authorization"]'],
    ['a scalar', '"just-a-string"'],
    ['null', 'null'],
    ['a map with a non-string value', '{"authorization":{"nested":true}}'],
    ['a map with a numeric value', '{"authorization":42}'],
  ])('throws when the decrypted payload is %s', (_label, payload) => {
    const envelope = encryptProtectedValue(payload, APP_SECRET);
    expect(() => decryptAiMcpHeaders(envelope, APP_SECRET)).toThrow();
  });
});
