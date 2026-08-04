import { AiMcpClientPoolService } from './ai-mcp-client-pool.service';
import { AiMcpPolicyError } from './ai-mcp.types';
import { AI_MCP_MAX_CACHED_CLIENTS } from './ai-mcp.constants';

const WORKSPACE_ID = 'workspace-1';
const SERVER_ID = 'server-1';

type ServerRow = {
  id: string;
  namespace: string;
  url: string;
  headersEncrypted: string | null;
  enabled: boolean;
  configVersion: number;
};

type SettingsRow = {
  enabled: boolean;
  allowedOrigins: string;
  policyVersion: number;
};

type FakeDbState = {
  servers: Map<string, ServerRow>;
  settings: SettingsRow | null;
};

/** Minimal chainable stand-in for the two queries the pool issues. */
function fakeDb(state: FakeDbState) {
  return {
    selectFrom(table: string) {
      let requestedId: string | null = null;
      const chain = {
        select: () => chain,
        where: (field: string, _operator: string, value: unknown) => {
          if (field === 'id') {
            requestedId = String(value);
          }
          return chain;
        },
        executeTakeFirst: async () => {
          if (table === 'aiMcpWorkspaceSettings') {
            return state.settings ?? undefined;
          }
          return requestedId ? state.servers.get(requestedId) : undefined;
        },
      };
      return chain;
    },
  } as never;
}

function addServer(state: FakeDbState, serverId: string): void {
  state.servers.set(serverId, {
    id: serverId,
    namespace: serverId.replace(/[^a-z0-9]/g, ''),
    url: 'https://mcp.example.test/mcp',
    headersEncrypted: null,
    enabled: true,
    configVersion: 1,
  });
}

type FakeConnection = {
  client: { close: jest.Mock; callTool: jest.Mock; listTools: jest.Mock };
  transport: { close: jest.Mock };
  guard: {
    wireBytes: () => number;
    abort: jest.Mock;
    close: jest.Mock;
  };
  protocolVersion: string | null;
  serverName: string | null;
  serverVersion: string | null;
};

function fakeConnection(): FakeConnection {
  return {
    client: {
      close: jest.fn(async () => undefined),
      callTool: jest.fn(async () => ({
        content: [{ type: 'text', text: 'ok' }],
      })),
      listTools: jest.fn(async () => ({ tools: [] })),
    },
    transport: { close: jest.fn(async () => undefined) },
    guard: {
      wireBytes: () => 0,
      abort: jest.fn(),
      close: jest.fn(async () => undefined),
    },
    protocolVersion: '2025-06-18',
    serverName: 'remote',
    serverVersion: '1.0.0',
  };
}

function build(options?: {
  deploymentEnabled?: boolean;
  settings?: SettingsRow | null;
  server?: Partial<ServerRow>;
}) {
  const state: FakeDbState = {
    servers: new Map([
      [
        SERVER_ID,
        {
          id: SERVER_ID,
          namespace: 'remote',
          url: 'https://mcp.example.test/mcp',
          headersEncrypted: null,
          enabled: true,
          configVersion: 1,
          ...options?.server,
        },
      ],
    ]),
    settings:
      options?.settings === undefined
        ? { enabled: true, allowedOrigins: 'https://mcp.example.test', policyVersion: 1 }
        : options.settings,
  };

  const metrics = {
    observeMcpCache: jest.fn(),
    observeMcpProbe: jest.fn(),
    observeMcpCall: jest.fn(),
    observeMcpLeases: jest.fn(),
  };

  const service = new AiMcpClientPoolService(
    fakeDb(state),
    {
      isAiExternalMcpEnabled: () => options?.deploymentEnabled ?? true,
      getAppSecret: () => 'a-secret-long-enough-for-key-derivation',
    } as never,
    { resolveAllowedForWorkspace: jest.fn() } as never,
    { getOrThrow: () => ({ publish: jest.fn(async () => 1) }) } as never,
    metrics as never,
  );

  const connections: FakeConnection[] = [];
  const connect = jest
    .spyOn(service as never as { connect: () => Promise<FakeConnection> }, 'connect')
    .mockImplementation(async () => {
      const connection = fakeConnection();
      connections.push(connection);
      return connection;
    });

  return { service, state, metrics, connect, connections };
}

const EXPECTED = {
  serverId: SERVER_ID,
  workspaceId: WORKSPACE_ID,
  expectedConfigVersion: 1,
  expectedPolicyVersion: 1,
};

/** Drains the microtask queue so fire-and-forget close chains complete. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AiMcpClientPoolService gating', () => {
  it('refuses when the deployment kill switch is off', async () => {
    const { service, connect } = build({ deploymentEnabled: false });

    await expect(service.acquire(EXPECTED)).rejects.toMatchObject({
      code: 'external_mcp_disabled',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('treats a missing workspace settings row as disabled', async () => {
    const { service, connect } = build({ settings: null });

    await expect(service.acquire(EXPECTED)).rejects.toMatchObject({
      code: 'external_mcp_disabled',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses when the workspace master switch is off', async () => {
    const { service } = build({
      settings: { enabled: false, allowedOrigins: 'https://mcp.example.test', policyVersion: 1 },
    });

    await expect(service.acquire(EXPECTED)).rejects.toMatchObject({
      code: 'external_mcp_disabled',
    });
  });

  it('refuses a disabled server', async () => {
    const { service } = build({ server: { enabled: false } });

    await expect(service.acquire(EXPECTED)).rejects.toMatchObject({
      code: 'agent_mcp_access_revoked',
    });
  });

  it('refuses a server that no longer exists', async () => {
    const { service, state } = build();
    state.servers.clear();

    await expect(service.acquire(EXPECTED)).rejects.toMatchObject({
      code: 'agent_mcp_access_revoked',
    });
  });

  it.each([
    ['config', { expectedConfigVersion: 2 }],
    ['policy', { expectedPolicyVersion: 2 }],
  ])(
    'fails closed when the caller expected a different %s version',
    async (_label, override) => {
      const { service, connect } = build();

      await expect(
        service.acquire({ ...EXPECTED, ...override }),
      ).rejects.toMatchObject({ code: 'agent_mcp_config_changed' });
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it('re-reads the database on every acquire, so a missed event cannot serve a stale client', async () => {
    const { service, state, connect } = build();

    const first = await service.acquire(EXPECTED);
    first.release();

    // A change nobody published: the version check still catches it.
    state.servers.get(SERVER_ID)!.configVersion = 2;

    await expect(service.acquire(EXPECTED)).rejects.toMatchObject({
      code: 'agent_mcp_config_changed',
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('AiMcpClientPoolService caching', () => {
  it('reuses one client across sequential leases', async () => {
    const { service, connect, metrics } = build();

    const first = await service.acquire(EXPECTED);
    first.release();
    const second = await service.acquire(EXPECTED);
    second.release();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(metrics.observeMcpCache).toHaveBeenCalledWith('hit');
  });

  it('builds once for concurrent acquisitions of a cold key', async () => {
    const { service, connect, connections } = build();

    const leases = await Promise.all([
      service.acquire(EXPECTED),
      service.acquire(EXPECTED),
      service.acquire(EXPECTED),
    ]);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(1);
    leases.forEach((lease) => lease.release());
  });

  it('builds a new client after a version bump instead of reusing the old key', async () => {
    const { service, state, connect } = build();

    (await service.acquire(EXPECTED)).release();
    state.servers.get(SERVER_ID)!.configVersion = 2;
    (
      await service.acquire({ ...EXPECTED, expectedConfigVersion: 2 })
    ).release();

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('drops a failed build so the next attempt can retry', async () => {
    const { service } = build();
    const connect = jest.spyOn(
      service as never as { connect: () => Promise<unknown> },
      'connect',
    );
    connect
      .mockRejectedValueOnce(new Error('connect failed'))
      .mockResolvedValueOnce(fakeConnection());

    await expect(service.acquire(EXPECTED)).rejects.toThrow('connect failed');
    await expect(service.acquire(EXPECTED)).resolves.toBeDefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe('AiMcpClientPoolService lease lifecycle', () => {
  it('keeps the client open on release', async () => {
    const { service, connections } = build();

    (await service.acquire(EXPECTED)).release();

    expect(connections[0].transport.close).not.toHaveBeenCalled();
  });

  it('closes the client on discard', async () => {
    const { service, connections } = build();

    (await service.acquire(EXPECTED)).discard('protocol_error');
    await flush();

    expect(connections[0].transport.close).toHaveBeenCalled();
    expect(connections[0].guard.close).toHaveBeenCalled();
  });

  it('rebuilds after a discard rather than handing back the dead client', async () => {
    const { service, connect } = build();

    (await service.acquire(EXPECTED)).discard('protocol_error');
    await flush();
    (await service.acquire(EXPECTED)).release();

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('is idempotent when release is called twice', async () => {
    const { service, connections } = build();
    const lease = await service.acquire(EXPECTED);

    lease.release();
    lease.release();
    await service.onModuleDestroy();

    expect(connections[0].transport.close).toHaveBeenCalledTimes(1);
  });

  it('aborts a live lease immediately on invalidation and closes once it returns', async () => {
    const { service, connections } = build();
    const lease = await service.acquire(EXPECTED);

    await service.invalidateServer(SERVER_ID, 'config');

    // The holder is aborted so it fails fast instead of waiting out a timeout.
    expect(connections[0].guard.abort).toHaveBeenCalled();
    expect(connections[0].transport.close).not.toHaveBeenCalled();

    lease.release();
    await flush();
    expect(connections[0].transport.close).toHaveBeenCalled();
  });

  it('closes an unleased client immediately on invalidation', async () => {
    const { service, connections } = build();
    (await service.acquire(EXPECTED)).release();

    await service.invalidateServer(SERVER_ID, 'config');

    expect(connections[0].transport.close).toHaveBeenCalled();
  });

  it('leaves other servers untouched when one is invalidated', async () => {
    const { service, connections } = build();
    (await service.acquire(EXPECTED)).release();

    await service.invalidateServer('some-other-server', 'config');

    expect(connections[0].transport.close).not.toHaveBeenCalled();
  });

  it('scopes reported wire bytes to the lease, not the whole connection', async () => {
    const { service, connections } = build();
    let counter = 0;

    const first = await service.acquire(EXPECTED);
    connections[0].guard.wireBytes = () => counter;
    counter = 500;
    first.release();

    const second = await service.acquire(EXPECTED);
    counter = 700;

    // The second lease must not inherit the first lease's 500 bytes.
    expect(second.wireBytes()).toBe(200);
    second.release();
  });
});

describe('AiMcpClientPoolService capacity and shutdown', () => {
  async function fill(
    service: AiMcpClientPoolService,
    state: FakeDbState,
    count: number,
    hold: boolean,
  ) {
    const leases = [];
    for (let index = 0; index < count; index += 1) {
      const serverId = `filler-${index}`;
      addServer(state, serverId);
      const lease = await service.acquire({
        ...EXPECTED,
        serverId,
      });
      if (hold) {
        leases.push(lease);
      } else {
        lease.release();
      }
    }
    return leases;
  }

  it('refuses a new connection when every cached client is leased', async () => {
    const { service, state } = build();
    const held = await fill(service, state, AI_MCP_MAX_CACHED_CLIENTS, true);

    addServer(state, 'one-too-many');
    await expect(
      service.acquire({ ...EXPECTED, serverId: 'one-too-many' }),
    ).rejects.toMatchObject({ code: 'agent_mcp_capacity' });

    held.forEach((lease) => lease.release());
  });

  it('evicts an unleased client instead of refusing', async () => {
    const { service, state, connections } = build();
    await fill(service, state, AI_MCP_MAX_CACHED_CLIENTS, false);

    addServer(state, 'newcomer');
    const lease = await service.acquire({
      ...EXPECTED,
      serverId: 'newcomer',
    });

    expect(lease).toBeDefined();
    // The very first, idlest connection is the one that made room.
    expect(connections[0].transport.close).toHaveBeenCalled();
    lease.release();
  });

  it('does not deadlock when a build enforces capacity against in-flight builds', async () => {
    const { service, state } = build();
    await fill(service, state, AI_MCP_MAX_CACHED_CLIENTS - 1, false);

    addServer(state, 'concurrent-a');
    addServer(state, 'concurrent-b');
    const results = await Promise.allSettled([
      service.acquire({ ...EXPECTED, serverId: 'concurrent-a' }),
      service.acquire({ ...EXPECTED, serverId: 'concurrent-b' }),
    ]);

    // Both settle: neither may hang waiting on the other's build promise.
    expect(results.map((result) => result.status)).not.toContain(undefined);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        result.value.release();
      }
    }
  });

  it('closes every client on shutdown', async () => {
    const { service, state, connections } = build();

    (await service.acquire(EXPECTED)).release();
    addServer(state, 'second');
    (await service.acquire({ ...EXPECTED, serverId: 'second' })).release();

    await service.onModuleDestroy();

    expect(connections).toHaveLength(2);
    for (const connection of connections) {
      expect(connection.transport.close).toHaveBeenCalled();
      expect(connection.guard.close).toHaveBeenCalled();
    }
  });

  it('does not leave a client open when shutdown races a held lease', async () => {
    const { service, connections } = build();
    const lease = await service.acquire(EXPECTED);

    await service.onModuleDestroy();
    lease.release();
    await flush();

    expect(connections[0].transport.close).toHaveBeenCalled();
  });

  it('rejects acquisitions after shutdown without opening a client', async () => {
    const { service, connect } = build();

    await service.onModuleDestroy();

    await expect(service.acquire(EXPECTED)).rejects.toMatchObject({
      code: 'external_mcp_unavailable',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not publish a client whose pending build was invalidated', async () => {
    const { service, connect } = build();
    const connection = fakeConnection();
    let finishBuild!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishBuild = resolve;
    });
    connect.mockImplementation(async () => {
      await gate;
      return connection;
    });

    const acquisition = service.acquire(EXPECTED);
    await flush();
    await service.invalidateServer(SERVER_ID, 'config');
    finishBuild();

    await expect(acquisition).rejects.toMatchObject({
      code: 'agent_mcp_config_changed',
    });
    expect(connection.transport.close).toHaveBeenCalled();
  });

  it('reports active and retiring lease gauges', async () => {
    const { service, metrics } = build();
    const lease = await service.acquire(EXPECTED);

    expect(metrics.observeMcpLeases).toHaveBeenCalledWith(1, 0);
    await service.invalidateServer(SERVER_ID, 'config');
    expect(metrics.observeMcpLeases).toHaveBeenCalledWith(1, 1);
    lease.release();
    await flush();
    expect(metrics.observeMcpLeases).toHaveBeenCalledWith(0, 0);
  });
});

describe('AiMcpClientPoolService probe deadline', () => {
  it('uses one deadline across every tools/list page', async () => {
    const { service } = build();
    const listTools = jest.fn(async () => ({ tools: [], nextCursor: 'next' }));
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10_001);

    await expect(
      (service as any).listAllTools({ listTools }, 10_000),
    ).rejects.toMatchObject({ code: 'external_mcp_timeout' });
    expect(listTools).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });
});
