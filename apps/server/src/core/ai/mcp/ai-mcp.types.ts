import { AiErrorCode } from '@docmost/api-contract';

/**
 * A policy decision that must stop the caller.
 *
 * Separate from AiMcpTransportError so the agent loop can turn a policy failure
 * into a terminal run error while a transport failure degrades to a failed step.
 */
export class AiMcpPolicyError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AiMcpPolicyError';
  }
}

export type AiMcpCallOptions = {
  /** Silence timeout, reset while the server reports progress. */
  idleTimeoutMs?: number;
  /** Absolute ceiling for the call. */
  totalTimeoutMs?: number;
  /** Cancellation from the surrounding run. */
  signal?: AbortSignal;
};

export type AiMcpRawCallResult = unknown;

export type AiMcpLease = {
  readonly serverId: string;
  readonly namespace: string;
  callTool(
    remoteName: string,
    args: Record<string, unknown>,
    options?: AiMcpCallOptions,
  ): Promise<AiMcpRawCallResult>;
  /** Response bytes observed on this connection so far. */
  wireBytes(): number;
  /** Returns the lease. The client stays cached for reuse. */
  release(): void;
  /**
   * Returns the lease and destroys the client.
   *
   * Required on any transport or protocol failure: the SDK settles the pending
   * request on abort but only `transport.close()` tears down the underlying
   * HTTP request and SSE stream.
   */
  discard(reason: string): void;
};

export type AiMcpDiscoveredRemoteTool = {
  remoteName: string;
  title: string | null;
  description: string | null;
  inputSchema: unknown;
  annotations: Record<string, unknown> | null;
};

export type AiMcpProbeResult = {
  latencyMs: number;
  protocolVersion: string | null;
  serverName: string | null;
  serverVersion: string | null;
  tools: AiMcpDiscoveredRemoteTool[];
};
