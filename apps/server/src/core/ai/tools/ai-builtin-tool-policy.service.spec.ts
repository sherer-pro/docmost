jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import {
  AI_LEGACY_AGENT_CAPABILITIES,
  AI_LEGACY_MCP_CAPABILITIES,
} from '@docmost/api-contract';
import { AiToolRegistryService } from './ai-tool-registry.service';
import { AiBuiltinToolPolicyService } from './ai-builtin-tool-policy.service';

function registry() {
  return new AiToolRegistryService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
}

function database(rows: {
  workspace?: {
    enabled: boolean;
    allowedCapabilities: string[];
    policyVersion: number;
  };
  space?: {
    allowedCapabilities: string[] | null;
    policyVersion: number;
  };
}) {
  return {
    selectFrom: jest.fn((table: string) => {
      const query: any = {
        select: jest.fn(() => query),
        where: jest.fn(() => query),
        executeTakeFirst: jest.fn(async () =>
          table === 'aiBuiltinToolWorkspacePolicies'
            ? rows.workspace
            : table === 'aiBuiltinToolSpacePolicies'
              ? rows.space
              : undefined,
        ),
      };
      return query;
    }),
  } as any;
}

function service(
  rows: Parameters<typeof database>[0],
  extensionsEnabled: boolean,
) {
  return new AiBuiltinToolPolicyService(
    database(rows),
    registry(),
    {
      isAiBuiltinToolExtensionsEnabled: () => extensionsEnabled,
    } as any,
    {} as any,
  );
}

describe('AiBuiltinToolPolicyService', () => {
  it('keeps a migrated MCP key on the exact seven legacy reads', async () => {
    const policy = service({}, true);
    const tools = await policy.listForMcp({
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      allowedCapabilities: AI_LEGACY_MCP_CAPABILITIES,
    } as any);

    expect(tools.map((tool) => tool.name)).toEqual([
      'search',
      'getTree',
      'getPageContext',
      'getPage',
      'getOutline',
      'getNode',
      'searchInPage',
    ]);
  });

  it('intersects a new MCP key with workspace and space exact allowlists', async () => {
    const policy = service(
      {
        workspace: {
          enabled: true,
          allowedCapabilities: [
            ...AI_LEGACY_AGENT_CAPABILITIES,
            'workspace.context.read',
            'page.comments.read',
          ],
          policyVersion: 3,
        },
        space: {
          allowedCapabilities: ['page.content.read', 'page.comments.read'],
          policyVersion: 2,
        },
      },
      true,
    );
    const tools = await policy.listForMcp({
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      allowedCapabilities: [
        'page.content.read',
        'workspace.context.read',
        'page.comments.read',
      ],
    } as any);

    expect(tools.map((tool) => tool.capability)).toEqual([
      'page.content.read',
      'page.comments.read',
    ]);
  });

  it('distinguishes inherited null from an explicit empty space allowlist', async () => {
    const workspace = {
      enabled: true,
      allowedCapabilities: [...AI_LEGACY_AGENT_CAPABILITIES],
      policyVersion: 3,
    };
    const inherited = service(
      {
        workspace,
        space: { allowedCapabilities: null, policyVersion: 1 },
      },
      true,
    );
    const denied = service(
      {
        workspace,
        space: { allowedCapabilities: [], policyVersion: 2 },
      },
      true,
    );

    await expect(
      inherited.getEffectiveCapabilities(
        'workspace-1',
        'space-1',
        'agent',
      ),
    ).resolves.toEqual(AI_LEGACY_AGENT_CAPABILITIES);
    await expect(
      denied.getEffectiveCapabilities('workspace-1', 'space-1', 'agent'),
    ).resolves.toEqual([]);
  });

  it('uses the deployment switch as an absolute maximum', async () => {
    const policy = service(
      {
        workspace: {
          enabled: true,
          allowedCapabilities: [
            ...AI_LEGACY_AGENT_CAPABILITIES,
            'workspace.context.read',
          ],
          policyVersion: 1,
        },
      },
      false,
    );

    await expect(
      policy.getEffectiveCapabilities('workspace-1', 'space-1', 'agent'),
    ).resolves.toEqual(AI_LEGACY_AGENT_CAPABILITIES);
  });

  it('freezes a run catalog and rejects it after a live policy version change', async () => {
    const rows = {
      workspace: {
        enabled: true,
        allowedCapabilities: [...AI_LEGACY_AGENT_CAPABILITIES],
        policyVersion: 1,
      },
    };
    const policy = service(rows, true);
    const snapshot = await policy.buildRunSnapshot(database(rows), {
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      executionMode: 'agent',
    });
    const run = {
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      builtinToolPolicySnapshot: snapshot,
      builtinToolPolicyFingerprint: policy.fingerprintSnapshot(snapshot!),
    } as any;

    expect(policy.listForRun(run)).toHaveLength(11);
    rows.workspace.policyVersion = 2;
    await expect(policy.assertRunPolicyCurrent(run)).rejects.toMatchObject({
      response: { code: 'agent_tool_policy_changed' },
    });
  });

  it('keeps the run snapshot fingerprint stable after jsonb key reordering', async () => {
    const rows = {
      workspace: {
        enabled: true,
        allowedCapabilities: [...AI_LEGACY_AGENT_CAPABILITIES],
        policyVersion: 1,
      },
    };
    const policy = service(rows, true);
    const snapshot = (await policy.buildRunSnapshot(database(rows), {
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      executionMode: 'agent',
    }))!;
    const jsonbOrdered = {
      toolNames: snapshot.toolNames,
      capabilities: snapshot.capabilities,
      schemaVersion: snapshot.schemaVersion,
      spacePolicyVersion: snapshot.spacePolicyVersion,
      workspacePolicyVersion: snapshot.workspacePolicyVersion,
      registryManifestFingerprint: snapshot.registryManifestFingerprint,
    };

    expect(policy.fingerprintSnapshot(jsonbOrdered)).toBe(
      policy.fingerprintSnapshot(snapshot),
    );
    expect(
      policy.listForRun({
        builtinToolPolicySnapshot: jsonbOrdered,
        builtinToolPolicyFingerprint: policy.fingerprintSnapshot(snapshot),
      } as any),
    ).toHaveLength(11);
  });

  it('applies live revocation to legacy runs without a stored snapshot', async () => {
    const policy = service(
      {
        workspace: {
          enabled: false,
          allowedCapabilities: [...AI_LEGACY_AGENT_CAPABILITIES],
          policyVersion: 2,
        },
      },
      true,
    );
    const run = {
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      builtinToolPolicySnapshot: null,
      builtinToolPolicyFingerprint: null,
    } as any;

    await expect(policy.assertRunPolicyCurrent(run)).rejects.toMatchObject({
      response: { code: 'agent_tool_policy_changed' },
    });
  });

  it('reports stored, deployment maximum, and effective workspace capabilities separately', async () => {
    const policy = service(
      {
        workspace: {
          enabled: true,
          allowedCapabilities: [
            ...AI_LEGACY_AGENT_CAPABILITIES,
            'workspace.context.read',
          ],
          policyVersion: 4,
        },
      },
      false,
    );

    await expect(
      policy.getWorkspaceView(
        { role: 'admin' } as any,
        { id: 'workspace-1' } as any,
      ),
    ).resolves.toMatchObject({
      allowedCapabilities: [
        ...AI_LEGACY_AGENT_CAPABILITIES,
        'workspace.context.read',
      ],
      maximumCapabilities: AI_LEGACY_AGENT_CAPABILITIES,
      effectiveCapabilities: AI_LEGACY_AGENT_CAPABILITIES,
      policyVersion: 4,
    });
  });
});
