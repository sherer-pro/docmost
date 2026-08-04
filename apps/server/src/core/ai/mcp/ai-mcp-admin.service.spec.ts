import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AiMcpAdminService } from './ai-mcp-admin.service';
import { AiMcpStoredDiscoveredTool } from './ai-mcp-discovery.util';

const USER_ID = 'user-1';
const USER = { id: USER_ID } as never;
const WORKSPACE = { id: 'workspace-1' } as never;
const APP_SECRET = 'a-secret-long-enough-for-key-derivation';

type Row = Record<string, unknown>;

/**
 * Records the writes the service issues so the spec can assert on stored
 * values, and returns whatever row the test seeded.
 */
function fakeDb(seed: { server?: Row; settings?: Row | null; count?: number }) {
  const writes: Array<{ table: string; values: Row }> = [];
  const deletes: string[] = [];
  let currentServer = seed.server ?? null;

  const chain = (table: string): any => ({
    select: () => chain(table),
    selectAll: () => chain(table),
    where: () => chain(table),
    groupBy: () => chain(table),
    orderBy: () => chain(table),
    forUpdate: () => chain(table),
    returningAll: () => chain(table),
    execute: async () => {
      if (table === 'aiMcpSpaceBindings') return [];
      if (table === 'aiMcpServers') return currentServer ? [currentServer] : [];
      return [];
    },
    executeTakeFirst: async () => {
      if (table === 'aiMcpWorkspaceSettings') return seed.settings ?? undefined;
      return currentServer ?? undefined;
    },
    executeTakeFirstOrThrow: async () => {
      if (table === 'aiMcpWorkspaceSettings') {
        return seed.settings ?? { count: String(seed.count ?? 0) };
      }
      return currentServer ?? { count: String(seed.count ?? 0) };
    },
  });

  const db: any = {
      selectFrom: (table: string) => chain(table),
      insertInto: (table: string) => ({
        values: (values: Row) => {
          writes.push({ table, values });
          currentServer = { ...(currentServer ?? {}), ...values };
          return {
            onConflict: () => ({ execute: async () => undefined }),
            returningAll: () => ({
              executeTakeFirstOrThrow: async () => ({
                id: 'server-1',
                namespace: 'remote',
                transport: 'streamable-http',
                discoveryToolCount: 0,
                configVersion: 1,
                testStatus: 'untested',
                testErrorCode: null,
                testCheckedAt: null,
                discoveredAt: null,
                createdAt: new Date(0),
                updatedAt: new Date(0),
                headerNames: [],
                discoveredTools: [],
                approvedTools: [],
                ...values,
              }),
            }),
            execute: async () => undefined,
          };
        },
      }),
      updateTable: (table: string) => ({
        set: (values: Row) => {
          writes.push({ table, values });
          const updated = { ...(currentServer ?? {}), ...values };
          const result = {
            executeTakeFirst: async () => updated,
            executeTakeFirstOrThrow: async () => updated,
          };
          const updateChain: any = {
            where: () => updateChain,
            returningAll: () => result,
            execute: async () => undefined,
          };
          return updateChain;
        },
      }),
      deleteFrom: (table: string) => ({
        where: () => ({
          where: () => ({
            execute: async () => {
              deletes.push(table);
            },
          }),
        }),
      }),
    };
  db.transaction = () => ({
    execute: (callback: (trx: any) => unknown) => callback(db),
  });
  return {
    db: db as never,
    writes,
    deletes,
  };
}

function build(options?: {
  canManage?: boolean;
  server?: Row;
  settings?: Row | null;
  deploymentOrigins?: string;
  probe?: () => Promise<unknown>;
}) {
  const { db, writes, deletes } = fakeDb({
    server: options?.server,
    settings:
      options?.settings === undefined
        ? {
            enabled: true,
            allowedOrigins: 'https://mcp.example.test',
            policyVersion: 1,
            updatedAt: new Date(0),
          }
        : options.settings,
  });

  const pool = {
    probe: jest.fn(options?.probe ?? (async () => ({ latencyMs: 5, protocolVersion: 'v', serverName: 'n', serverVersion: '1', tools: [] }))),
    publishInvalidation: jest.fn(async () => undefined),
  };

  const service = new AiMcpAdminService(
    db,
    {
      isAiExternalMcpEnabled: () => true,
      getAppSecret: () => APP_SECRET,
      getAiMcpAllowedOrigins: () =>
        options?.deploymentOrigins ?? 'https://mcp.example.test',
    } as never,
    {
      createForUser: () => ({
        cannot: () => !(options?.canManage ?? true),
      }),
    } as never,
    { assertAllowedForWorkspace: jest.fn(async () => new URL('https://mcp.example.test/mcp')) } as never,
    pool as never,
    {
      observeMcpProbe: jest.fn(),
      observeMcpCache: jest.fn(),
      observeMcpCall: jest.fn(),
      observeMcpLeases: jest.fn(),
    } as never,
  );

  return { service, writes, deletes, pool };
}

function discoveredTool(
  overrides?: Partial<AiMcpStoredDiscoveredTool>,
): AiMcpStoredDiscoveredTool {
  return {
    remoteName: 'search',
    toolName: 'mcp__remote__search_abcdef0123456789',
    slug: 'search',
    schemaFingerprint: 'fp-1',
    inputSchema: { type: 'object', properties: {} },
    argumentNameMap: {},
    remoteTitlePresent: false,
    remoteDescriptionPresent: true,
    remoteAnnotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    ...overrides,
  };
}

describe('AiMcpAdminService authorization', () => {
  it.each([
    ['getSettings', (s: AiMcpAdminService) => s.getSettings(USER, WORKSPACE)],
    ['updateSettings', (s: AiMcpAdminService) => s.updateSettings({}, USER, WORKSPACE)],
    ['listServers', (s: AiMcpAdminService) => s.listServers(USER, WORKSPACE)],
    [
      'createServer',
      (s: AiMcpAdminService) =>
        s.createServer(
          { name: 'n', namespace: 'ns', url: 'https://mcp.example.test/mcp' },
          USER,
          WORKSPACE,
        ),
    ],
    ['getServer', (s: AiMcpAdminService) => s.getServer('server-1', USER, WORKSPACE)],
    [
      'updateServer',
      (s: AiMcpAdminService) => s.updateServer('server-1', {}, USER, WORKSPACE),
    ],
    [
      'deleteServer',
      (s: AiMcpAdminService) => s.deleteServer('server-1', USER, WORKSPACE),
    ],
    ['testServer', (s: AiMcpAdminService) => s.testServer('server-1', USER, WORKSPACE)],
    [
      'discoverServer',
      (s: AiMcpAdminService) => s.discoverServer('server-1', USER, WORKSPACE),
    ],
  ])('rejects a non-administrator calling %s', async (_label, call) => {
    const { service } = build({ canManage: false });

    await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AiMcpAdminService settings', () => {
  it('reports the deployment switch and allowlist as read-only context', async () => {
    const { service } = build({
      deploymentOrigins: 'https://mcp.example.test,https://other.example.test',
    });

    const settings = await service.getSettings(USER, WORKSPACE);

    expect(settings.deploymentEnabled).toBe(true);
    expect(settings.deploymentAllowedOrigins).toEqual([
      'https://mcp.example.test',
      'https://other.example.test',
    ]);
    expect(settings.allowedOrigins).toEqual(['https://mcp.example.test']);
  });

  it('treats a missing settings row as disabled with no origins', async () => {
    const { service } = build({ settings: null });

    const settings = await service.getSettings(USER, WORKSPACE);

    expect(settings.enabled).toBe(false);
    expect(settings.allowedOrigins).toEqual([]);
    expect(settings.policyVersion).toBe(0);
  });

  it('refuses a workspace origin the deployment does not allow', async () => {
    const { service } = build({ deploymentOrigins: 'https://mcp.example.test' });

    await expect(
      service.updateSettings(
        { allowedOrigins: ['https://not-allowed.example.test'] },
        USER,
        WORKSPACE,
      ),
    ).rejects.toThrow(/not allowed by this deployment/);
  });

  it('refuses an unparseable origin', async () => {
    const { service } = build();

    await expect(
      service.updateSettings({ allowedOrigins: ['not-a-url'] }, USER, WORKSPACE),
    ).rejects.toThrow(/Invalid origin/);
  });

  it('bumps the policy version and retires clients when the policy changes', async () => {
    const { service, writes, pool } = build({
      server: { id: 'server-1' },
    });

    await service.updateSettings({ enabled: false }, USER, WORKSPACE);

    const settingsWrites = writes.filter(
      (write) => write.table === 'aiMcpWorkspaceSettings',
    );
    expect(settingsWrites).toHaveLength(2);
    expect(settingsWrites[1].values.policyVersion).toBeDefined();
    expect(pool.publishInvalidation).toHaveBeenCalled();
  });

  it('leaves the policy version alone when nothing effective changed', async () => {
    const { service, writes, pool } = build();

    await service.updateSettings({ enabled: true }, USER, WORKSPACE);

    const settingsWrites = writes.filter(
      (write) => write.table === 'aiMcpWorkspaceSettings',
    );
    expect(settingsWrites).toHaveLength(1);
    expect(pool.publishInvalidation).not.toHaveBeenCalled();
  });
});

describe('AiMcpAdminService server creation', () => {
  it('always stores a new server disabled', async () => {
    const { service, writes } = build();

    await service.createServer(
      { name: 'Remote', namespace: 'remote', url: 'https://mcp.example.test/mcp' },
      USER,
      WORKSPACE,
    );

    const write = writes.find((w) => w.table === 'aiMcpServers');
    expect(write?.values.enabled).toBe(false);
  });

  it('encrypts headers and records only their names', async () => {
    const { service, writes } = build();

    const detail = await service.createServer(
      {
        name: 'Remote',
        namespace: 'remote',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer super-secret-token' },
      },
      USER,
      WORKSPACE,
    );

    const write = writes.find((w) => w.table === 'aiMcpServers');
    expect(String(write?.values.headersEncrypted)).toContain('enc:v1:');
    expect(String(write?.values.headersEncrypted)).not.toContain(
      'super-secret-token',
    );
    expect(JSON.stringify(detail)).not.toContain('super-secret-token');
    expect(detail.headersConfigured).toBe(true);
  });

  it('rejects a blocked header at creation', async () => {
    const { service } = build();

    await expect(
      service.createServer(
        {
          name: 'Remote',
          namespace: 'remote',
          url: 'https://mcp.example.test/mcp',
          headers: { 'mcp-session-id': 'hijack' },
        },
        USER,
        WORKSPACE,
      ),
    ).rejects.toThrow(/not allowed/);
  });
});

describe('AiMcpAdminService header update semantics', () => {
  const server = {
    id: 'server-1',
    namespace: 'remote',
    url: 'https://mcp.example.test/mcp',
    transport: 'streamable-http',
    enabled: false,
    headersEncrypted: 'enc:v1:aa:bb:cc',
    headerNames: ['authorization'],
    discoveredTools: [],
    approvedTools: [],
    discoveryToolCount: 0,
    configVersion: 3,
    testStatus: 'untested',
    testErrorCode: null,
    testCheckedAt: null,
    discoveredAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  it('keeps the stored ciphertext when headers are omitted', async () => {
    const { service, writes } = build({ server });

    await service.updateServer('server-1', { name: 'Renamed' }, USER, WORKSPACE);

    const write = writes.find((w) => w.table === 'aiMcpServers');
    expect('headersEncrypted' in (write?.values ?? {})).toBe(false);
  });

  it('deletes the ciphertext on clearHeaders', async () => {
    const { service, writes } = build({ server });

    await service.updateServer(
      'server-1',
      { clearHeaders: true },
      USER,
      WORKSPACE,
    );

    const write = writes.find((w) => w.table === 'aiMcpServers');
    expect(write?.values.headersEncrypted).toBeNull();
  });

  it('rejects headers and clearHeaders together', async () => {
    const { service } = build({ server });

    await expect(
      service.updateServer(
        'server-1',
        { headers: { authorization: 'Bearer x' }, clearHeaders: true },
        USER,
        WORKSPACE,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('bumps the config version and retires clients when the connection changes', async () => {
    const { service, writes, pool } = build({ server });

    await service.updateServer(
      'server-1',
      { clearHeaders: true },
      USER,
      WORKSPACE,
    );

    const write = writes.find((w) => w.table === 'aiMcpServers');
    expect(write?.values.configVersion).toBeDefined();
    expect(pool.publishInvalidation).toHaveBeenCalledWith('server-1', 'config');
  });

  it('does not bump the config version for a rename alone', async () => {
    const { service, writes, pool } = build({ server });

    await service.updateServer('server-1', { name: 'Renamed' }, USER, WORKSPACE);

    const write = writes.find((w) => w.table === 'aiMcpServers');
    expect('configVersion' in (write?.values ?? {})).toBe(false);
    expect(pool.publishInvalidation).not.toHaveBeenCalled();
  });

  it('refuses to enable a server with no approved tool', async () => {
    const { service } = build({ server });

    await expect(
      service.updateServer('server-1', { enabled: true }, USER, WORKSPACE),
    ).rejects.toThrow(/Approve at least one tool/);
  });
});

describe('AiMcpAdminService tool approval', () => {
  function approve(
    inputs: Array<{ remoteName: string; approved: boolean; description?: string }>,
    discovered: AiMcpStoredDiscoveredTool[],
    current: unknown[] = [],
  ) {
    const { service } = build();
    return (
      service as never as {
        applyApprovals: (
          i: unknown,
          d: unknown,
          c: unknown,
          u: string,
        ) => unknown[];
      }
    ).applyApprovals(inputs, discovered, current, USER_ID);
  }

  it('requires an administrator-authored description', () => {
    expect(() =>
      approve([{ remoteName: 'search', approved: true }], [discoveredTool()]),
    ).toThrow(/description is required/);

    expect(() =>
      approve(
        [{ remoteName: 'search', approved: true, description: '   ' }],
        [discoveredTool()],
      ),
    ).toThrow(/description is required/);
  });

  it('rejects a tool that was never discovered', () => {
    expect(() =>
      approve(
        [{ remoteName: 'ghost', approved: true, description: 'Search the web' }],
        [discoveredTool()],
      ),
    ).toThrow(/Unknown external MCP tool/);
  });

  it('rejects a tool whose schema could not be sanitized', () => {
    expect(() =>
      approve(
        [{ remoteName: 'search', approved: true, description: 'Search' }],
        [discoveredTool({ inputSchema: null })],
      ),
    ).toThrow(/schema is unsupported/);
  });

  it('never approves a tool implicitly from a remote readOnlyHint', () => {
    // The remote server claims read-only, but nothing was submitted for
    // approval, so nothing is approved.
    const result = approve([], [discoveredTool()]);

    expect(result).toEqual([]);
  });

  it('stores the administrator description, not the remote one', () => {
    const result = approve(
      [
        {
          remoteName: 'search',
          approved: true,
          description: 'Searches an external index.',
        },
      ],
      [discoveredTool()],
    ) as Array<{ description: string; writeClass?: string }>;

    expect(result[0].description).toBe('Searches an external index.');
  });

  it('drops a tool submitted with approved false', () => {
    const result = approve(
      [{ remoteName: 'search', approved: false }],
      [discoveredTool()],
      [{ remoteName: 'search', schemaFingerprint: 'fp-1' }],
    );

    expect(result).toEqual([]);
  });

  it('preserves the original approval timestamp when the schema is unchanged', () => {
    const result = approve(
      [{ remoteName: 'search', approved: true, description: 'Search' }],
      [discoveredTool()],
      [
        {
          remoteName: 'search',
          schemaFingerprint: 'fp-1',
          approvedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    ) as Array<{ approvedAt: string }>;

    expect(result[0].approvedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('re-stamps the approval when the schema fingerprint moved', () => {
    const result = approve(
      [{ remoteName: 'search', approved: true, description: 'Search' }],
      [discoveredTool({ schemaFingerprint: 'fp-2' })],
      [
        {
          remoteName: 'search',
          schemaFingerprint: 'fp-1',
          approvedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    ) as Array<{ approvedAt: string }>;

    expect(result[0].approvedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('AiMcpAdminService deletion', () => {
  it('hard deletes the row so the ciphertext stops existing', async () => {
    const { service, deletes, pool } = build({
      server: { id: 'server-1', headersEncrypted: 'enc:v1:a:b:c' },
    });

    await service.deleteServer('server-1', USER, WORKSPACE);

    expect(deletes).toContain('aiMcpServers');
    expect(pool.publishInvalidation).toHaveBeenCalledWith(
      'server-1',
      'deleted',
    );
  });
});
