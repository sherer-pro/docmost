// The shared tool-budget constant lives in the registry module, which reaches
// the collaboration gateway and from there lib0, an ESM package Jest cannot
// parse. Same mock the registry spec uses.
jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { AiMcpToolCallService } from './ai-mcp-tool-call.service';
import { AiMcpRunSnapshot } from './ai-mcp-snapshot.types';
import { AiMcpPolicyError } from './ai-mcp.types';
import { AiMcpTransportError } from './ai-mcp-pinned-fetch';
import {
  AI_MCP_MAX_RUN_CONNECTIONS,
  AI_MCP_MAX_RUN_EXTERNAL_TOOLS,
} from './ai-mcp.constants';
import { AI_TOOL_RESULT_MAX_BYTES } from '../tools/ai-tool-registry.service';

const RUN = {
  id: 'run-1',
  workspaceId: 'workspace-1',
  spaceId: 'space-1',
  userId: 'user-1',
} as never;
const ARG_ALIAS = 'arg_a8b771920b8319e4';

function tool(name: string, remoteName = 'search') {
  return {
    name,
    remoteName,
    description: 'Searches an external index.',
    inputSchema: {
      type: 'object',
      properties: { [ARG_ALIAS]: { type: 'string' } },
      additionalProperties: false,
    },
    argumentNameMap: {
      properties: { [ARG_ALIAS]: { remoteName: 'q', value: {} } },
    },
    schemaFingerprint: 'fp-1',
  };
}

function snapshot(
  connections: Array<Partial<AiMcpRunSnapshot['connections'][number]>>,
): AiMcpRunSnapshot {
  return {
    schemaVersion: 1,
    profileKey: 'default',
    workspacePolicyVersion: 1,
    connections: connections.map((connection, index) => ({
      serverId: `server-${index}`,
      namespace: `ns${index}`,
      configVersion: 1,
      bindingId: `binding-${index}`,
      bindingPolicyVersion: 1,
      instructions: null,
      tools: [tool(`mcp__ns${index}__search_abcdef0${index}`)],
      ...connection,
    })),
  };
}

function build(options?: {
  assertCallAllowed?: () => Promise<unknown>;
  callTool?: () => Promise<unknown>;
  wireBytes?: number;
}) {
  const lease = {
    serverId: 'server-0',
    namespace: 'ns0',
    callTool: jest.fn(
      options?.callTool ??
        (async () => ({ content: [{ type: 'text', text: 'hit' }] })),
    ),
    wireBytes: () => options?.wireBytes ?? 0,
    release: jest.fn(),
    discard: jest.fn(),
  };

  const policy = {
    assertCallAllowed: jest.fn(
      options?.assertCallAllowed ??
        (async () => ({
          connection: snapshot([{}]).connections[0],
          tool: tool('mcp__ns0__search_abcdef00'),
        })),
    ),
  };
  const pool = { acquire: jest.fn(async () => lease) };
  const metrics = { observeMcpCall: jest.fn() };

  const service = new AiMcpToolCallService(
    policy as never,
    pool as never,
    metrics as never,
  );

  return { service, lease, policy, pool, metrics };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('AiMcpToolCallService.listSnapshotDefinitions', () => {
  it('returns nothing for a run with no snapshot', () => {
    const { service } = build();

    expect(service.listSnapshotDefinitions(null)).toEqual([]);
  });

  it('marks every external definition read-only and agent-only', () => {
    const { service } = build();

    const definitions = service.listSnapshotDefinitions(snapshot([{}]));

    expect(definitions).toHaveLength(1);
    expect(definitions[0].writeClass).toBe('read_only');
    expect(definitions[0].exposures).toEqual(['agent']);
    expect(definitions[0].toolSource).toBe('external_mcp');
  });

  it('carries the administrator description as the model-facing text', () => {
    const { service } = build();

    expect(service.listSnapshotDefinitions(snapshot([{}]))[0].description).toBe(
      'Searches an external index.',
    );
  });

  it('records the routing metadata a step needs', () => {
    const { service } = build();

    expect(service.listSnapshotDefinitions(snapshot([{}]))[0]).toMatchObject({
      mcpServerId: 'server-0',
      mcpNamespace: 'ns0',
      mcpRemoteToolName: 'search',
      mcpConfigVersion: 1,
    });
  });

  it('caps the number of connections', () => {
    const { service } = build();
    const many = snapshot(
      Array.from({ length: AI_MCP_MAX_RUN_CONNECTIONS + 4 }, () => ({})),
    );

    const definitions = service.listSnapshotDefinitions(many);

    expect(
      new Set(definitions.map((definition) => definition.mcpServerId)).size,
    ).toBe(AI_MCP_MAX_RUN_CONNECTIONS);
  });

  it('caps the total number of external tools', () => {
    const { service } = build();
    const wide = snapshot([
      {
        tools: Array.from(
          { length: AI_MCP_MAX_RUN_EXTERNAL_TOOLS + 10 },
          (_value, index) =>
            tool(`mcp__ns0__t${index}_abcdef0123456789`, `t${index}`),
        ),
      },
    ]);

    expect(service.listSnapshotDefinitions(wide)).toHaveLength(
      AI_MCP_MAX_RUN_EXTERNAL_TOOLS,
    );
  });
});

describe('AiMcpToolCallService.listInstructions', () => {
  it('returns nothing when no space added instructions', () => {
    const { service } = build();

    expect(service.listInstructions(snapshot([{}]))).toEqual([]);
  });

  it('returns the space instructions keyed by namespace', () => {
    const { service } = build();

    expect(
      service.listInstructions(
        snapshot([{ instructions: '  Prefer this for public facts.  ' }]),
      ),
    ).toEqual([
      { namespace: 'ns0', instructions: 'Prefer this for public facts.' },
    ]);
  });

  it('skips whitespace-only instructions', () => {
    const { service } = build();

    expect(service.listInstructions(snapshot([{ instructions: '   ' }]))).toEqual(
      [],
    );
  });
});

describe('AiMcpToolCallService.execute', () => {
  const context = {
    run: RUN,
    user: {} as never,
    snapshot: snapshot([{}]),
    isCancelled: async () => false,
  };

  it('re-checks policy before acquiring a connection', async () => {
    const { service, policy, pool } = build();

    await service.execute('mcp__ns0__search_abcdef00', {}, context);

    expect(policy.assertCallAllowed).toHaveBeenCalled();
    expect(pool.acquire.mock.invocationCallOrder[0]).toBeGreaterThan(
      policy.assertCallAllowed.mock.invocationCallOrder[0],
    );
  });

  it('never opens a connection when policy refuses', async () => {
    const { service, pool } = build({
      assertCallAllowed: async () => {
        throw new AiMcpPolicyError('agent_mcp_access_revoked', 'gone');
      },
    });

    await expect(
      service.execute('mcp__ns0__search_abcdef00', {}, context),
    ).rejects.toBeInstanceOf(AiMcpPolicyError);
    expect(pool.acquire).not.toHaveBeenCalled();
  });

  it('wraps the result in an untrusted envelope', async () => {
    const { service } = build();

    const result = await service.execute(
      'mcp__ns0__search_abcdef00',
      {},
      context,
    );

    expect(result.content).toMatchObject({
      source: 'external_mcp',
      untrusted: true,
      server: 'ns0',
      tool: 'search',
      text: ['hit'],
    });
    expect(result.writeProposal).toBeUndefined();
  });

  it('releases the lease on success', async () => {
    const { service, lease } = build();

    await service.execute('mcp__ns0__search_abcdef00', {}, context);

    expect(lease.release).toHaveBeenCalled();
    expect(lease.discard).not.toHaveBeenCalled();
  });

  it('discards the connection when the server returns an unsupported content type', async () => {
    const { service, lease } = build({
      callTool: async () => ({
        content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      }),
    });

    await expect(
      service.execute('mcp__ns0__search_abcdef00', {}, context),
    ).rejects.toBeInstanceOf(AiMcpTransportError);
    // Only closing the transport ends the underlying request and SSE stream.
    expect(lease.discard).toHaveBeenCalled();
  });

  it('discards the connection when the call throws', async () => {
    const { service, lease } = build({
      callTool: async () => {
        throw new Error('socket hang up');
      },
    });

    await expect(
      service.execute('mcp__ns0__search_abcdef00', {}, context),
    ).rejects.toBeInstanceOf(AiMcpTransportError);
    expect(lease.discard).toHaveBeenCalled();
  });

  it('maps a timeout to the timeout error code', async () => {
    const { service } = build({
      callTool: async () => {
        throw new Error('Request timed out');
      },
    });

    await expect(
      service.execute('mcp__ns0__search_abcdef00', {}, context),
    ).rejects.toMatchObject({ code: 'external_mcp_timeout' });
  });

  it('rejects a result larger than the shared per-result limit', async () => {
    const { service, lease } = build({
      callTool: async () => ({
        content: [{ type: 'text', text: 'x'.repeat(AI_TOOL_RESULT_MAX_BYTES) }],
      }),
    });

    await expect(
      service.execute('mcp__ns0__search_abcdef00', {}, context),
    ).rejects.toMatchObject({ code: 'external_mcp_result_limit' });
    expect(lease.discard).toHaveBeenCalledWith('oversize');
  });

  it('turns a remote application error into a failed tool call', async () => {
    const { service, lease, metrics } = build({
      callTool: async () => ({
        content: [{ type: 'text', text: 'not found' }],
        isError: true,
      }),
    });

    await expect(
      service.execute('mcp__ns0__search_abcdef00', {}, context),
    ).rejects.toMatchObject({ code: 'external_mcp_remote_error' });
    expect(lease.release).toHaveBeenCalled();
    expect(metrics.observeMcpCall).toHaveBeenCalledWith(
      'remote_error',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('passes the resolved remote name, not the namespaced one, to the server', async () => {
    const { service, lease } = build();

    await service.execute(
      'mcp__ns0__search_abcdef00',
      { [ARG_ALIAS]: 'x' },
      context,
    );

    expect(lease.callTool).toHaveBeenCalledWith(
      'search',
      { q: 'x' },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('records only closed-vocabulary outcomes', async () => {
    const { service, metrics } = build();

    await service.execute('mcp__ns0__search_abcdef00', {}, context);

    expect(metrics.observeMcpCall.mock.calls[0][0]).toBe('ok');
  });

  it('rejects a fast result when the final live-policy check fails', async () => {
    let checks = 0;
    const resolved = {
      connection: snapshot([{}]).connections[0],
      tool: tool('mcp__ns0__search_abcdef00'),
    };
    const { service, lease } = build({
      assertCallAllowed: async () => {
        checks += 1;
        if (checks > 1) {
          throw new AiMcpPolicyError('agent_mcp_access_revoked', 'revoked');
        }
        return resolved;
      },
    });

    await expect(
      service.execute('mcp__ns0__search_abcdef00', {}, context),
    ).rejects.toMatchObject({ code: 'agent_mcp_access_revoked' });
    expect(lease.discard).toHaveBeenCalledWith('policy_revoked');
  });

  it('aborts a slow call when policy is revoked while it is running', async () => {
    jest.useFakeTimers();
    let checks = 0;
    const resolved = {
      connection: snapshot([{}]).connections[0],
      tool: tool('mcp__ns0__search_abcdef00'),
    };
    const { service, lease } = build({
      assertCallAllowed: async () => {
        checks += 1;
        if (checks > 1) {
          throw new AiMcpPolicyError('agent_mcp_access_revoked', 'revoked');
        }
        return resolved;
      },
      callTool: async (...callArgs: any[]) =>
        new Promise((_resolve, reject) => {
          callArgs[2].signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    const execution = service.execute(
      'mcp__ns0__search_abcdef00',
      {},
      context,
    );
    const rejection = expect(execution).rejects.toMatchObject({
      code: 'agent_mcp_access_revoked',
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(500);

    await rejection;
    expect(lease.discard).toHaveBeenCalledWith('policy_revoked');
    jest.useRealTimers();
  });
});
