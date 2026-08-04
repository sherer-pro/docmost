import { AiMcpPolicyService } from './ai-mcp-policy.service';
import { AiMcpRunSnapshot } from './ai-mcp-snapshot.types';
import { AI_MCP_MAX_SNAPSHOT_BYTES } from './ai-mcp.constants';

const WORKSPACE_ID = 'workspace-1';
const SPACE_ID = 'space-1';
const USER_ID = 'user-1';
const SERVER_ID = 'server-1';
const TOOL_NAME = 'mcp__remote__search_abcdef0123456789';

type Gate = {
  deploymentEnabled: boolean;
  workspaceEnabled: boolean;
  serverEnabled: boolean;
  bindingEnabled: boolean;
  deniedByGroup: boolean;
  optedIn: boolean;
};

const ALL_OPEN: Gate = {
  deploymentEnabled: true,
  workspaceEnabled: true,
  serverEnabled: true,
  bindingEnabled: true,
  deniedByGroup: false,
  optedIn: true,
};

function approvedTool(overrides?: Record<string, unknown>) {
  return {
    toolName: TOOL_NAME,
    remoteName: 'search',
    description: 'Searches an external index.',
    inputSchema: { type: 'object', properties: {} },
    argumentNameMap: {},
    schemaFingerprint: 'fp-1',
    approvedAt: '2026-01-01T00:00:00.000Z',
    approvedByUserId: 'admin-1',
    ...overrides,
  };
}

function build(
  gate: Gate,
  options?: {
    approvedTools?: unknown[];
    spaceAllowed?: string[];
    profileAllowed?: string[];
    groupAllowed?: string[][];
    policyVersion?: number;
    configVersion?: number;
    bindingPolicyVersion?: number;
  },
) {
  const effectiveRow = {
    bindingId: 'binding-1',
    bindingPolicyVersion: options?.bindingPolicyVersion ?? 1,
    bindingEnabled: gate.bindingEnabled,
    allowedTools: options?.spaceAllowed ?? [],
    profileAllowedTools: { default: options?.profileAllowed ?? [] },
    instructions: 'Prefer the external index for public facts.',
    spaceId: SPACE_ID,
    serverId: SERVER_ID,
    serverName: 'Remote',
    namespace: 'remote',
    url: 'https://mcp.example.test/mcp',
    serverEnabled: gate.serverEnabled,
    configVersion: options?.configVersion ?? 1,
    approvedTools: options?.approvedTools ?? [approvedTool()],
    optedIn: gate.optedIn,
    deniedByGroup: gate.deniedByGroup,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  const service = new AiMcpPolicyService(
    {} as never,
    {
      isAiExternalMcpEnabled: () => gate.deploymentEnabled,
    } as never,
    {
      assertHasFullSpaceAccess: jest.fn(async () => undefined),
      createForUser: jest.fn(async () => ({ cannot: () => false })),
    } as never,
  );

  jest
    .spyOn(service as never as { readSettings: () => Promise<unknown> }, 'readSettings')
    .mockResolvedValue({
      enabled: gate.workspaceEnabled,
      allowedOrigins: 'https://mcp.example.test',
      policyVersion: options?.policyVersion ?? 1,
    });
  jest
    .spyOn(service as never as { loadEffective: () => Promise<unknown> }, 'loadEffective')
    .mockResolvedValue([
      { ...effectiveRow, groupAllowedTools: options?.groupAllowed ?? null },
    ]);

  return { service, effectiveRow };
}

async function snapshotFor(gate: Gate, options?: Parameters<typeof build>[1]) {
  const { service } = build(gate, options);
  return service.buildRunSnapshot({} as never, {
    workspaceId: WORKSPACE_ID,
    spaceId: SPACE_ID,
    userId: USER_ID,
    executionMode: 'agent',
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AiMcpPolicyService preference authorization and replacement', () => {
  const user = { id: USER_ID } as never;
  const workspace = { id: WORKSPACE_ID } as never;

  it.each(['get', 'put'] as const)(
    'rejects %s preferences for a non-member before reading bindings',
    async (operation) => {
      const db = { selectFrom: jest.fn() };
      const service = new AiMcpPolicyService(
        db as never,
        { isAiExternalMcpEnabled: () => true } as never,
        {
          createForUser: jest.fn(async () => {
            throw new Error('not a member');
          }),
        } as never,
      );

      const request =
        operation === 'get'
          ? service.getPreferences(SPACE_ID, user, workspace)
          : service.putPreferences(
              SPACE_ID,
              { items: [] },
              user,
              workspace,
            );
      await expect(request).rejects.toThrow('not a member');
      expect(db.selectFrom).not.toHaveBeenCalled();
    },
  );

  it('revokes omitted preferences before upserting the replacement set', async () => {
    const updates: unknown[] = [];
    const inserts: unknown[] = [];
    const bindings = [
      { id: 'binding-1', serverId: 'server-1' },
      { id: 'binding-2', serverId: 'server-2' },
    ];
    const updateChain: any = {
      set: (value: unknown) => {
        updates.push(value);
        return updateChain;
      },
      where: () => updateChain,
      execute: async () => undefined,
    };
    const trx: any = {
      updateTable: () => updateChain,
      insertInto: () => ({
        values: (value: unknown) => {
          inserts.push(value);
          return {
            onConflict: () => ({ execute: async () => undefined }),
          };
        },
      }),
    };
    const db: any = {
      selectFrom: () => {
        const query: any = {
          select: () => query,
          where: () => query,
          execute: async () => bindings,
        };
        return query;
      },
      transaction: () => ({
        execute: (callback: (transaction: unknown) => unknown) => callback(trx),
      }),
    };
    const service = new AiMcpPolicyService(
      db,
      { isAiExternalMcpEnabled: () => true } as never,
      { createForUser: jest.fn(async () => ({ cannot: () => false })) } as never,
    );
    jest.spyOn(service, 'getPreferences').mockResolvedValue({
      spaceId: SPACE_ID,
      available: true,
      items: [],
    });

    await service.putPreferences(
      SPACE_ID,
      { items: [{ serverId: 'server-1', optedIn: true }] },
      user,
      workspace,
    );

    expect(updates).toContainEqual(expect.objectContaining({ enabled: false }));
    expect(inserts).toEqual([
      expect.objectContaining({ bindingId: 'binding-1', enabled: true }),
    ]);
  });
});

describe('AiMcpPolicyService gate truth table', () => {
  it('offers the tool only when every gate is open', async () => {
    const snapshot = await snapshotFor(ALL_OPEN);

    expect(snapshot?.connections).toHaveLength(1);
    expect(snapshot?.connections[0].tools.map((tool) => tool.name)).toEqual([
      TOOL_NAME,
    ]);
  });

  it.each([
    ['deployment switch', 'deploymentEnabled'],
    ['workspace master switch', 'workspaceEnabled'],
    ['server enabled flag', 'serverEnabled'],
    ['space binding', 'bindingEnabled'],
    ['user opt-in', 'optedIn'],
  ] as Array<[string, keyof Gate]>)(
    'offers nothing when the %s is closed',
    async (_label, key) => {
      const snapshot = await snapshotFor({ ...ALL_OPEN, [key]: false });

      expect(snapshot).toBeNull();
    },
  );

  it('offers nothing when a group denies the connection', async () => {
    expect(await snapshotFor({ ...ALL_OPEN, deniedByGroup: true })).toBeNull();
  });

  it('treats a missing preference as opted out', async () => {
    // loadEffective coalesces a missing row to false; an undefined value must
    // never be read as consent.
    const { service } = build(ALL_OPEN);
    jest
      .spyOn(service as never as { loadEffective: () => Promise<unknown> }, 'loadEffective')
      .mockResolvedValue([
        {
          bindingId: 'binding-1',
          bindingPolicyVersion: 1,
          bindingEnabled: true,
          allowedTools: [],
          profileAllowedTools: { default: [] },
          instructions: null,
          serverId: SERVER_ID,
          serverName: 'Remote',
          namespace: 'remote',
          url: 'https://mcp.example.test/mcp',
          serverEnabled: true,
          configVersion: 1,
          approvedTools: [approvedTool()],
          optedIn: undefined,
          deniedByGroup: false,
          groupAllowedTools: null,
        },
      ]);

    await expect(
      service.buildRunSnapshot({} as never, {
        workspaceId: WORKSPACE_ID,
        spaceId: SPACE_ID,
        userId: USER_ID,
        executionMode: 'agent',
      }),
    ).resolves.toBeNull();
  });

  it('offers nothing outside agent mode', async () => {
    const { service } = build(ALL_OPEN);

    await expect(
      service.buildRunSnapshot({} as never, {
        workspaceId: WORKSPACE_ID,
        spaceId: SPACE_ID,
        userId: USER_ID,
        executionMode: 'chat',
      }),
    ).resolves.toBeNull();
  });
});

describe('AiMcpPolicyService tool intersection', () => {
  const second = approvedTool({
    toolName: 'mcp__remote__fetch_11111111',
    remoteName: 'fetch',
    schemaFingerprint: 'fp-2',
  });

  it('narrows to the space allowlist', async () => {
    const snapshot = await snapshotFor(ALL_OPEN, {
      approvedTools: [approvedTool(), second],
      spaceAllowed: [TOOL_NAME],
    });

    expect(snapshot?.connections[0].tools.map((t) => t.name)).toEqual([
      TOOL_NAME,
    ]);
  });

  it('narrows to the profile allowlist', async () => {
    const snapshot = await snapshotFor(ALL_OPEN, {
      approvedTools: [approvedTool(), second],
      profileAllowed: [second.toolName],
    });

    expect(snapshot?.connections[0].tools.map((t) => t.name)).toEqual([
      second.toolName,
    ]);
  });

  it('intersects every applicable group allowlist', async () => {
    const snapshot = await snapshotFor(ALL_OPEN, {
      approvedTools: [approvedTool(), second],
      // Two group memberships: only the tool present in both survives.
      groupAllowed: [[TOOL_NAME, second.toolName], [TOOL_NAME]],
    });

    expect(snapshot?.connections[0].tools.map((t) => t.name)).toEqual([
      TOOL_NAME,
    ]);
  });

  it('offers nothing when the intersection is empty', async () => {
    expect(
      await snapshotFor(ALL_OPEN, {
        approvedTools: [approvedTool()],
        groupAllowed: [[second.toolName]],
      }),
    ).toBeNull();
  });

  it('offers nothing when the workspace approved no tool', async () => {
    expect(await snapshotFor(ALL_OPEN, { approvedTools: [] })).toBeNull();
  });
});

describe('AiMcpPolicyService snapshot content', () => {
  it('carries no URL, header, or secret', async () => {
    const snapshot = await snapshotFor(ALL_OPEN);
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toContain('headers');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('enc:v1');
  });

  it('carries the space-administrator instructions and the admin description', async () => {
    const snapshot = await snapshotFor(ALL_OPEN);

    expect(snapshot?.connections[0].instructions).toBe(
      'Prefer the external index for public facts.',
    );
    expect(snapshot?.connections[0].tools[0].description).toBe(
      'Searches an external index.',
    );
  });

  it('pins the versions the capability list was resolved from', async () => {
    const snapshot = await snapshotFor(ALL_OPEN, {
      policyVersion: 7,
      configVersion: 4,
      bindingPolicyVersion: 9,
    });

    expect(snapshot?.workspacePolicyVersion).toBe(7);
    expect(snapshot?.connections[0].configVersion).toBe(4);
    expect(snapshot?.connections[0].bindingPolicyVersion).toBe(9);
  });

  it('fails closed rather than truncating an oversized capability list', async () => {
    const many = Array.from({ length: 32 }, (_value, index) =>
      approvedTool({
        toolName: `mcp__remote__t${index}_abcdef0${index % 10}`,
        remoteName: `tool-${index}`,
        description: 'x'.repeat(400),
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(
            Array.from({ length: 40 }, (_v, i) => [
              `property_${i}_${'y'.repeat(60)}`,
              { type: 'string' },
            ]),
          ),
        },
      }),
    );

    await expect(
      snapshotFor(ALL_OPEN, { approvedTools: many }),
    ).rejects.toMatchObject({ code: 'agent_mcp_snapshot_too_large' });
  });

  it('produces a stable fingerprint', async () => {
    const { service } = build(ALL_OPEN);
    const snapshot = (await snapshotFor(ALL_OPEN)) as AiMcpRunSnapshot;

    expect(service.fingerprintSnapshot(snapshot)).toBe(
      service.fingerprintSnapshot(snapshot),
    );
    expect(service.fingerprintSnapshot(snapshot)).toHaveLength(64);
  });

  it('stays well under the byte cap for a realistic list', async () => {
    const snapshot = await snapshotFor(ALL_OPEN);

    expect(
      Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
    ).toBeLessThan(AI_MCP_MAX_SNAPSHOT_BYTES);
  });
});

describe('AiMcpPolicyService assertCallAllowed', () => {
  function snapshot(overrides?: Partial<AiMcpRunSnapshot>): AiMcpRunSnapshot {
    return {
      schemaVersion: 1,
      profileKey: 'default',
      workspacePolicyVersion: 1,
      connections: [
        {
          serverId: SERVER_ID,
          namespace: 'remote',
          configVersion: 1,
          bindingId: 'binding-1',
          bindingPolicyVersion: 1,
          instructions: null,
          tools: [
            {
              name: TOOL_NAME,
              remoteName: 'search',
              description: 'Searches an external index.',
              inputSchema: { type: 'object', properties: {} },
              argumentNameMap: {},
              schemaFingerprint: 'fp-1',
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  const args = {
    toolName: TOOL_NAME,
    workspaceId: WORKSPACE_ID,
    spaceId: SPACE_ID,
    userId: USER_ID,
  };

  it('allows a call while every gate is still open', async () => {
    const { service } = build(ALL_OPEN);

    await expect(
      service.assertCallAllowed({ snapshot: snapshot(), ...args }),
    ).resolves.toMatchObject({ tool: { name: TOOL_NAME } });
  });

  it('rejects a tool absent from the snapshot', async () => {
    const { service } = build(ALL_OPEN);

    await expect(
      service.assertCallAllowed({
        snapshot: snapshot(),
        ...args,
        toolName: 'mcp__remote__other_00000000',
      }),
    ).rejects.toMatchObject({ code: 'external_mcp_tool_not_approved' });
  });

  it.each([
    ['deployment switch', 'deploymentEnabled', 'external_mcp_disabled'],
    ['workspace switch', 'workspaceEnabled', 'agent_mcp_access_revoked'],
    ['server flag', 'serverEnabled', 'agent_mcp_access_revoked'],
    ['space binding', 'bindingEnabled', 'agent_mcp_access_revoked'],
  ] as Array<[string, keyof Gate, string]>)(
    'stops an in-flight run when the %s closes',
    async (_label, key, code) => {
      const { service } = build({ ...ALL_OPEN, [key]: false });

      await expect(
        service.assertCallAllowed({ snapshot: snapshot(), ...args }),
      ).rejects.toMatchObject({ code });
    },
  );

  it('stops an in-flight run when the user opts out', async () => {
    const { service } = build({ ...ALL_OPEN, optedIn: false });

    await expect(
      service.assertCallAllowed({ snapshot: snapshot(), ...args }),
    ).rejects.toMatchObject({ code: 'agent_mcp_access_revoked' });
  });

  it('stops an in-flight run when a group starts denying it', async () => {
    const { service } = build({ ...ALL_OPEN, deniedByGroup: true });

    await expect(
      service.assertCallAllowed({ snapshot: snapshot(), ...args }),
    ).rejects.toMatchObject({ code: 'agent_mcp_access_revoked' });
  });

  it.each([
    ['workspace policy', { policyVersion: 2 }],
    ['server config', { configVersion: 2 }],
    ['space binding policy', { bindingPolicyVersion: 2 }],
  ])('stops an in-flight run when the %s version moves', async (_label, options) => {
    const { service } = build(ALL_OPEN, options);

    await expect(
      service.assertCallAllowed({ snapshot: snapshot(), ...args }),
    ).rejects.toMatchObject({ code: 'agent_mcp_config_changed' });
  });

  it('stops an in-flight run when the tool schema changes underneath it', async () => {
    const { service } = build(ALL_OPEN, {
      approvedTools: [approvedTool({ schemaFingerprint: 'fp-changed' })],
    });

    await expect(
      service.assertCallAllowed({ snapshot: snapshot(), ...args }),
    ).rejects.toMatchObject({ code: 'agent_mcp_config_changed' });
  });

  it('stops an in-flight run when the tool is narrowed out of the space', async () => {
    const { service } = build(ALL_OPEN, {
      spaceAllowed: ['mcp__remote__other_00000000'],
    });

    await expect(
      service.assertCallAllowed({ snapshot: snapshot(), ...args }),
    ).rejects.toMatchObject({ code: 'external_mcp_tool_not_approved' });
  });

  it('does not widen a run when policy is loosened after it started', async () => {
    // The workspace now approves a second tool, but the snapshot governs what
    // the model was offered, so the new tool is not callable.
    const { service } = build(ALL_OPEN, {
      approvedTools: [
        approvedTool(),
        approvedTool({
          toolName: 'mcp__remote__added_22222222',
          remoteName: 'added',
        }),
      ],
    });

    await expect(
      service.assertCallAllowed({
        snapshot: snapshot(),
        ...args,
        toolName: 'mcp__remote__added_22222222',
      }),
    ).rejects.toMatchObject({ code: 'external_mcp_tool_not_approved' });
  });
});

describe('AiMcpPolicyService readRunSnapshot', () => {
  it.each([
    [null],
    [undefined],
    ['string'],
    [42],
    [{ schemaVersion: 2, connections: [] }],
    [{ schemaVersion: 1 }],
  ])('rejects an unusable stored value: %p', (value) => {
    const { service } = build(ALL_OPEN);

    expect(
      service.readRunSnapshot({ mcpPolicySnapshot: value } as never),
    ).toBeNull();
  });

  it('accepts a version 1 snapshot', () => {
    const { service } = build(ALL_OPEN);

    expect(
      service.readRunSnapshot({
        mcpPolicySnapshot: { schemaVersion: 1, connections: [] },
      } as never),
    ).toMatchObject({ schemaVersion: 1 });
  });
});
