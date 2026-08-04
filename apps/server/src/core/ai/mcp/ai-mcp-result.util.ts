/**
 * Normalization of a remote MCP `tools/call` result.
 *
 * Only text blocks and JSON `structuredContent` are accepted. Image, audio,
 * embedded resource, resource link, and task outputs are rejected rather than
 * summarized, because Docmost has no safe rendering path for them inside an
 * agent turn.
 *
 * Byte budgets are deliberately not applied here. The caller owns them so that
 * external results pass through exactly the same per-result and cumulative
 * limits as built-in tool results.
 */

export type AiMcpNormalizedResult = {
  /** Text blocks in the order the remote server returned them. */
  text: string[];
  structured?: Record<string, unknown>;
  /** The remote server reported the call itself as failed. */
  isError: boolean;
};

/**
 * The failure reason is the discriminant. A string discriminant is required
 * because the repository compiles with `strictNullChecks: false`, under which
 * TypeScript does not narrow unions on boolean literal discriminants.
 */
export type AiMcpNormalizeOutcome =
  | { status: 'ok'; result: AiMcpNormalizedResult }
  | { status: 'unsupported_content' }
  | { status: 'invalid_response' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeAiMcpCallResult(raw: unknown): AiMcpNormalizeOutcome {
  if (!isPlainObject(raw)) {
    return { status: 'invalid_response' };
  }

  const text: string[] = [];
  const content = raw.content;

  if (content !== undefined) {
    if (!Array.isArray(content)) {
      return { status: 'invalid_response' };
    }
    for (const block of content) {
      if (!isPlainObject(block) || typeof block.type !== 'string') {
        return { status: 'invalid_response' };
      }
      if (block.type !== 'text') {
        return { status: 'unsupported_content' };
      }
      if (typeof block.text !== 'string') {
        return { status: 'invalid_response' };
      }
      text.push(block.text);
    }
  }

  let structured: Record<string, unknown> | undefined;
  if (raw.structuredContent !== undefined) {
    if (!isPlainObject(raw.structuredContent)) {
      return { status: 'invalid_response' };
    }
    structured = raw.structuredContent;
  }

  if (text.length === 0 && structured === undefined) {
    return { status: 'invalid_response' };
  }

  return {
    status: 'ok',
    result: {
      text,
      ...(structured ? { structured } : {}),
      isError: raw.isError === true,
    },
  };
}

export type AiMcpResultEnvelope = {
  source: 'external_mcp';
  untrusted: true;
  server: string;
  tool: string;
  isError: boolean;
  text: string[];
  structured?: Record<string, unknown>;
  truncated: boolean;
};

/**
 * Wraps a normalized result in a server-generated envelope.
 *
 * Every field is produced by Docmost. `server` carries only the administrator
 * chosen namespace, never the URL or the server id, so an envelope that reaches
 * the model cannot disclose the outbound destination.
 */
export function buildAiMcpResultEnvelope(params: {
  namespace: string;
  remoteToolName: string;
  result: AiMcpNormalizedResult;
  truncated: boolean;
}): AiMcpResultEnvelope {
  return {
    source: 'external_mcp',
    untrusted: true,
    server: params.namespace,
    tool: params.remoteToolName,
    isError: params.result.isError,
    text: params.result.text,
    ...(params.result.structured ? { structured: params.result.structured } : {}),
    truncated: params.truncated,
  };
}
