import {
  buildAiMcpResultEnvelope,
  normalizeAiMcpCallResult,
} from './ai-mcp-result.util';

function normalized(raw: unknown) {
  const outcome = normalizeAiMcpCallResult(raw);
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}`);
  }
  return outcome.result;
}

function rejected(raw: unknown): string {
  return normalizeAiMcpCallResult(raw).status;
}

describe('normalizeAiMcpCallResult accepted shapes', () => {
  it('accepts text blocks in order', () => {
    expect(
      normalized({
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      }),
    ).toEqual({ text: ['first', 'second'], isError: false });
  });

  it('accepts structuredContent on its own', () => {
    expect(normalized({ structuredContent: { total: 3 } })).toEqual({
      text: [],
      structured: { total: 3 },
      isError: false,
    });
  });

  it('accepts text and structuredContent together', () => {
    expect(
      normalized({
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { total: 1 },
      }),
    ).toEqual({ text: ['ok'], structured: { total: 1 }, isError: false });
  });

  it('accepts an empty text string as a text block', () => {
    expect(normalized({ content: [{ type: 'text', text: '' }] })).toEqual({
      text: [''],
      isError: false,
    });
  });

  it('propagates a remote-reported error flag without failing normalization', () => {
    expect(
      normalized({ content: [{ type: 'text', text: 'nope' }], isError: true }),
    ).toEqual({ text: ['nope'], isError: true });
  });

  it('treats a non-boolean isError as false', () => {
    expect(
      normalized({ content: [{ type: 'text', text: 'a' }], isError: 'yes' }),
    ).toEqual({ text: ['a'], isError: false });
  });
});

describe('normalizeAiMcpCallResult rejected content types', () => {
  it.each([
    ['image', { type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    ['audio', { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }],
    [
      'embedded resource',
      { type: 'resource', resource: { uri: 'file:///etc/passwd', text: 'root' } },
    ],
    ['resource link', { type: 'resource_link', uri: 'https://example.test' }],
    ['unknown future type', { type: 'video', data: 'AAAA' }],
  ])('rejects a %s block', (_label, block) => {
    expect(rejected({ content: [block] })).toBe('unsupported_content');
  });

  it('rejects a mixed result even when a text block is present', () => {
    expect(
      rejected({
        content: [
          { type: 'text', text: 'safe' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ],
      }),
    ).toBe('unsupported_content');
  });
});

describe('normalizeAiMcpCallResult rejected shapes', () => {
  it.each([[null], [undefined], ['text'], [42], [[]]])(
    'rejects a non-object result: %p',
    (raw) => {
      expect(rejected(raw)).toBe('invalid_response');
    },
  );

  it('rejects a non-array content field', () => {
    expect(rejected({ content: { type: 'text', text: 'a' } })).toBe(
      'invalid_response',
    );
  });

  it('rejects a content entry that is not an object', () => {
    expect(rejected({ content: ['plain string'] })).toBe('invalid_response');
  });

  it('rejects a content entry with no type', () => {
    expect(rejected({ content: [{ text: 'a' }] })).toBe('invalid_response');
  });

  it('rejects a text block whose text is not a string', () => {
    expect(rejected({ content: [{ type: 'text', text: 42 }] })).toBe(
      'invalid_response',
    );
  });

  it('rejects a non-object structuredContent', () => {
    expect(rejected({ structuredContent: ['a'] })).toBe('invalid_response');
    expect(rejected({ structuredContent: 'a' })).toBe('invalid_response');
  });

  it('rejects a result carrying neither text nor structuredContent', () => {
    expect(rejected({})).toBe('invalid_response');
    expect(rejected({ content: [] })).toBe('invalid_response');
    expect(rejected({ isError: true })).toBe('invalid_response');
  });
});

describe('buildAiMcpResultEnvelope', () => {
  it('marks every result as untrusted external data', () => {
    const envelope = buildAiMcpResultEnvelope({
      namespace: 'tavily',
      remoteToolName: 'search',
      result: { text: ['hit'], isError: false },
      truncated: false,
    });

    expect(envelope).toEqual({
      source: 'external_mcp',
      untrusted: true,
      server: 'tavily',
      tool: 'search',
      isError: false,
      text: ['hit'],
      truncated: false,
    });
  });

  it('carries the namespace only, never a URL or a server id', () => {
    const serialized = JSON.stringify(
      buildAiMcpResultEnvelope({
        namespace: 'tavily',
        remoteToolName: 'search',
        result: { text: ['hit'], structured: { a: 1 }, isError: true },
        truncated: true,
      }),
    );

    expect(serialized).toContain('"server":"tavily"');
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('reports truncation so the model knows the result was cut', () => {
    expect(
      buildAiMcpResultEnvelope({
        namespace: 'ns',
        remoteToolName: 'search',
        result: { text: ['partial'], isError: false },
        truncated: true,
      }).truncated,
    ).toBe(true);
  });

  it('omits structured when the result has none', () => {
    expect(
      'structured' in
        buildAiMcpResultEnvelope({
          namespace: 'ns',
          remoteToolName: 'search',
          result: { text: ['a'], isError: false },
          truncated: false,
        }),
    ).toBe(false);
  });
});
