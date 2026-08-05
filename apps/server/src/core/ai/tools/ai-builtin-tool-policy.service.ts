import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import {
  AI_BUILTIN_TOOL_CAPABILITIES,
  AI_LEGACY_AGENT_CAPABILITIES,
  AI_LEGACY_MCP_CAPABILITIES,
  AiBuiltinToolCapability,
  AiBuiltinToolCatalogEntry,
  AiBuiltinToolSpacePolicyView,
  AiBuiltinToolWorkspacePolicyView,
} from '@docmost/api-contract';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { AiRun, ApiKey, User, Workspace } from '@docmost/db/types/entity.types';
import { UserRole } from '../../../common/helpers/types/permission';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import {
  AiToolDefinition,
  AiToolExposure,
  AiToolRegistryService,
} from './ai-tool-registry.service';
import { AiBuiltinToolRunSnapshot } from './ai-builtin-tool-policy.types';
import {
  UpdateAiBuiltinToolSpacePolicyDto,
  UpdateAiBuiltinToolWorkspacePolicyDto,
} from '../dto/ai-builtin-tool-policy.dto';

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

@Injectable()
export class AiBuiltinToolPolicyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly registry: AiToolRegistryService,
    private readonly environment: EnvironmentService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  catalog(): AiBuiltinToolCatalogEntry[] {
    const byName = new Map<string, AiToolDefinition>();
    for (const exposure of ['agent', 'mcp'] as const) {
      for (const tool of this.registry.list(exposure)) {
        byName.set(tool.name, tool);
      }
    }
    return [...byName.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tool) => ({
        name: tool.name,
        capability: tool.capability,
        category: tool.category,
        targetScope: tool.targetScope,
        approvalMode: tool.approvalMode,
        maxResultBytes: tool.maxResultBytes,
        writeClass: tool.writeClass,
        exposures: [...tool.exposures],
        annotations: { ...tool.annotations },
      }));
  }

  manifestFingerprint(): string {
    return createHash('sha256')
      .update(
        JSON.stringify(
          this.catalog().map((tool) => ({
            ...tool,
            inputSchema: this.registry.get(tool.name, tool.exposures[0])
              ?.inputSchema,
          })),
        ),
        'utf8',
      )
      .digest('hex');
  }

  toolSchemaFingerprint(
    capabilities: readonly AiBuiltinToolCapability[],
  ): string {
    const allowed = new Set(capabilities);
    return createHash('sha256')
      .update(
        JSON.stringify(
          this.registry
            .list('agent')
            .filter((tool) => allowed.has(tool.capability))
            .map((tool) => ({
              name: tool.name,
              capability: tool.capability,
              description: tool.description,
              inputSchema: tool.inputSchema,
              writeClass: tool.writeClass,
              targetScope: tool.targetScope,
              approvalMode: tool.approvalMode,
            })),
        ),
        'utf8',
      )
      .digest('hex');
  }

  async getWorkspaceView(
    user: User,
    workspace: Workspace,
  ): Promise<AiBuiltinToolWorkspacePolicyView> {
    this.assertWorkspaceAdmin(user);
    const policy = await this.readWorkspacePolicy(workspace.id);
    const maximumCapabilities = this.systemCapabilities('agent');
    const maximum = new Set(maximumCapabilities);
    const effectiveCapabilities = policy.enabled
      ? policy.allowedCapabilities.filter((capability) =>
          maximum.has(capability),
        )
      : [];
    return {
      ...policy,
      maximumCapabilities,
      effectiveCapabilities,
      catalog: this.catalog(),
    };
  }

  async updateWorkspace(
    dto: UpdateAiBuiltinToolWorkspacePolicyDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiBuiltinToolWorkspacePolicyView> {
    this.assertWorkspaceAdmin(user);
    const allowedCapabilities = this.validateCapabilities(
      dto.allowedCapabilities,
      'agent',
    );
    await this.db
      .insertInto('aiBuiltinToolWorkspacePolicies')
      .values({
        workspaceId: workspace.id,
        enabled: dto.enabled,
        allowedCapabilities: jsonb(allowedCapabilities) as never,
        updatedById: user.id,
      })
      .onConflict((oc) =>
        oc.column('workspaceId').doUpdateSet({
          enabled: dto.enabled,
          allowedCapabilities: jsonb(allowedCapabilities) as never,
          policyVersion: sql<number>`ai_builtin_tool_workspace_policies.policy_version + 1`,
          updatedById: user.id,
          updatedAt: new Date(),
        }),
      )
      .execute();
    return this.getWorkspaceView(user, workspace);
  }

  async getSpaceView(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiBuiltinToolSpacePolicyView> {
    await this.assertCanManageSpace(user, spaceId);
    const resolved = await this.resolve(workspace.id, spaceId, 'agent');
    return {
      spaceId,
      inherited: resolved.spaceAllowedCapabilities === null,
      allowedCapabilities: resolved.spaceAllowedCapabilities,
      workspaceAllowedCapabilities: resolved.workspaceAllowedCapabilities,
      effectiveCapabilities: resolved.capabilities,
      workspacePolicyVersion: resolved.workspacePolicyVersion,
      spacePolicyVersion: resolved.spacePolicyVersion,
      catalog: this.catalog(),
    };
  }

  async updateSpace(
    spaceId: string,
    dto: UpdateAiBuiltinToolSpacePolicyDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiBuiltinToolSpacePolicyView> {
    await this.assertCanManageSpace(user, spaceId);
    const workspacePolicy = await this.readWorkspacePolicy(workspace.id);
    const requested =
      dto.allowedCapabilities === null
        ? null
        : this.validateCapabilities(dto.allowedCapabilities, 'agent');
    if (requested) {
      const workspaceAllowed = new Set(workspacePolicy.allowedCapabilities);
      if (requested.some((capability) => !workspaceAllowed.has(capability))) {
        throw new BadRequestException(
          'A space can only narrow the workspace tool policy',
        );
      }
    }
    await this.db
      .insertInto('aiBuiltinToolSpacePolicies')
      .values({
        workspaceId: workspace.id,
        spaceId,
        allowedCapabilities:
          requested === null ? null : (jsonb(requested) as never),
        updatedById: user.id,
      })
      .onConflict((oc) =>
        oc.column('spaceId').doUpdateSet({
          allowedCapabilities:
            requested === null ? null : (jsonb(requested) as never),
          policyVersion: sql<number>`ai_builtin_tool_space_policies.policy_version + 1`,
          updatedById: user.id,
          updatedAt: new Date(),
        }),
      )
      .execute();
    return this.getSpaceView(spaceId, user, workspace);
  }

  async listForMcp(apiKey: ApiKey): Promise<AiToolDefinition[]> {
    const resolved = await this.resolve(
      apiKey.workspaceId,
      apiKey.spaceId,
      'mcp',
      this.readCapabilities(apiKey.allowedCapabilities),
    );
    return this.filterDefinitions('mcp', resolved.capabilities);
  }

  async getEffectiveCapabilities(
    workspaceId: string,
    spaceId: string,
    exposure: AiToolExposure,
  ): Promise<AiBuiltinToolCapability[]> {
    const resolved = await this.resolve(workspaceId, spaceId, exposure);
    return resolved.capabilities;
  }

  async assertMcpToolAllowed(apiKey: ApiKey, toolName: string): Promise<void> {
    const tools = await this.listForMcp(apiKey);
    if (!tools.some((tool) => tool.name === toolName)) {
      throw new ForbiddenException('MCP tool is not allowed by API key policy');
    }
  }

  async buildRunSnapshot(
    trx: KyselyTransaction | KyselyDB,
    params: {
      workspaceId: string;
      spaceId: string;
      executionMode: string;
      maximumCapabilities?: readonly AiBuiltinToolCapability[];
    },
  ): Promise<AiBuiltinToolRunSnapshot | null> {
    if (params.executionMode !== 'agent') return null;
    const resolved = await this.resolve(
      params.workspaceId,
      params.spaceId,
      'agent',
      undefined,
      trx,
    );
    const maximum =
      params.maximumCapabilities === undefined
        ? null
        : new Set(params.maximumCapabilities);
    const definitions = this.filterDefinitions(
      'agent',
      maximum
        ? resolved.capabilities.filter((capability) => maximum.has(capability))
        : resolved.capabilities,
    );
    return {
      schemaVersion: 1,
      registryManifestFingerprint: this.manifestFingerprint(),
      workspacePolicyVersion: resolved.workspacePolicyVersion,
      spacePolicyVersion: resolved.spacePolicyVersion,
      capabilities: definitions.map((tool) => tool.capability),
      toolNames: definitions.map((tool) => tool.name),
    };
  }

  fingerprintSnapshot(snapshot: AiBuiltinToolRunSnapshot): string {
    return createHash('sha256')
      .update(JSON.stringify(snapshot), 'utf8')
      .digest('hex');
  }

  readRunSnapshot(run: AiRun): AiBuiltinToolRunSnapshot | null {
    const value = run.builtinToolPolicySnapshot;
    if (!value || typeof value !== 'object') return null;
    const snapshot = value as unknown as AiBuiltinToolRunSnapshot;
    return snapshot.schemaVersion === 1 &&
      Array.isArray(snapshot.capabilities) &&
      Array.isArray(snapshot.toolNames)
      ? snapshot
      : null;
  }

  listForRun(run: AiRun): AiToolDefinition[] {
    const snapshot = this.readRunSnapshot(run);
    if (!snapshot) {
      return this.filterDefinitions('agent', AI_LEGACY_AGENT_CAPABILITIES);
    }
    if (snapshot.registryManifestFingerprint !== this.manifestFingerprint()) {
      throw new BadRequestException({
        code: 'agent_tool_policy_changed',
        message: 'The built-in tool registry changed during this run',
      });
    }
    if (
      !run.builtinToolPolicyFingerprint ||
      run.builtinToolPolicyFingerprint !== this.fingerprintSnapshot(snapshot)
    ) {
      throw new BadRequestException({
        code: 'agent_tool_policy_changed',
        message: 'The built-in tool policy snapshot failed its integrity check',
      });
    }
    const names = new Set(snapshot.toolNames);
    const capabilities = new Set(snapshot.capabilities);
    const definitions = this.registry
      .list('agent')
      .filter(
        (tool) => names.has(tool.name) && capabilities.has(tool.capability),
      );
    if (
      definitions.length !== names.size ||
      definitions.length !== capabilities.size
    ) {
      throw new BadRequestException({
        code: 'agent_tool_policy_changed',
        message: 'The built-in tool policy snapshot is inconsistent',
      });
    }
    return definitions;
  }

  async assertRunToolAllowed(
    run: AiRun,
    toolName: string,
  ): Promise<AiToolDefinition> {
    const definitions = await this.assertRunPolicyCurrent(run);
    const definition = definitions.find(
      (tool) => tool.name === toolName,
    );
    if (!definition) {
      throw new ForbiddenException({
        code: 'agent_tool_policy_changed',
        message: 'The tool is not part of this run',
      });
    }
    return definition;
  }

  async assertRunPolicyCurrent(run: AiRun): Promise<AiToolDefinition[]> {
    const definitions = this.listForRun(run);
    const snapshot = this.readRunSnapshot(run);
    const resolved = await this.resolve(run.workspaceId, run.spaceId, 'agent');
    const liveCapabilities = new Set(resolved.capabilities);
    const capabilityRevoked = definitions.some(
      (definition) => !liveCapabilities.has(definition.capability),
    );
    const versionChanged =
      snapshot !== null &&
      (resolved.workspacePolicyVersion !== snapshot.workspacePolicyVersion ||
        resolved.spacePolicyVersion !== snapshot.spacePolicyVersion);
    if (capabilityRevoked || versionChanged) {
      throw new ForbiddenException({
        code: 'agent_tool_policy_changed',
        message: 'The built-in tool policy changed during this run',
      });
    }
    return definitions;
  }

  private async resolve(
    workspaceId: string,
    spaceId: string,
    exposure: AiToolExposure,
    keyCapabilities?: AiBuiltinToolCapability[],
    db: KyselyDB | KyselyTransaction = this.db,
  ) {
    const workspace = await this.readWorkspacePolicy(workspaceId, db);
    const space = await db
      .selectFrom('aiBuiltinToolSpacePolicies')
      .select(['allowedCapabilities', 'policyVersion'])
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .executeTakeFirst();
    const spaceAllowedCapabilities = space
      ? this.readCapabilities(space.allowedCapabilities)
      : null;
    const system = new Set(this.systemCapabilities(exposure));
    let capabilities = workspace.enabled
      ? workspace.allowedCapabilities.filter((capability) =>
          system.has(capability),
        )
      : [];
    if (spaceAllowedCapabilities !== null) {
      const allowed = new Set(spaceAllowedCapabilities);
      capabilities = capabilities.filter((capability) =>
        allowed.has(capability),
      );
    }
    if (keyCapabilities !== undefined) {
      const allowed = new Set(keyCapabilities);
      capabilities = capabilities.filter((capability) =>
        allowed.has(capability),
      );
    }
    return {
      capabilities,
      workspaceAllowedCapabilities: workspace.enabled
        ? workspace.allowedCapabilities.filter((capability) =>
            system.has(capability),
          )
        : [],
      workspacePolicyVersion: workspace.policyVersion,
      spacePolicyVersion: space ? Number(space.policyVersion) : 0,
      spaceAllowedCapabilities,
    };
  }

  private async readWorkspacePolicy(
    workspaceId: string,
    db: KyselyDB | KyselyTransaction = this.db,
  ) {
    const row = await db
      .selectFrom('aiBuiltinToolWorkspacePolicies')
      .select(['enabled', 'allowedCapabilities', 'policyVersion'])
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    return {
      enabled: row?.enabled ?? true,
      allowedCapabilities: row
        ? this.readCapabilities(row.allowedCapabilities)
        : [...AI_LEGACY_AGENT_CAPABILITIES],
      policyVersion: row ? Number(row.policyVersion) : 0,
    };
  }

  private systemCapabilities(
    exposure: AiToolExposure,
  ): AiBuiltinToolCapability[] {
    const definitions = this.registry.list(exposure);
    if (this.environment.isAiBuiltinToolExtensionsEnabled()) {
      return definitions.map((tool) => tool.capability);
    }
    const legacy = new Set(
      exposure === 'mcp'
        ? AI_LEGACY_MCP_CAPABILITIES
        : AI_LEGACY_AGENT_CAPABILITIES,
    );
    return definitions
      .map((tool) => tool.capability)
      .filter((capability) => legacy.has(capability));
  }

  private filterDefinitions(
    exposure: AiToolExposure,
    capabilities: readonly AiBuiltinToolCapability[],
  ): AiToolDefinition[] {
    const allowed = new Set(capabilities);
    return this.registry
      .list(exposure)
      .filter((tool) => allowed.has(tool.capability));
  }

  private validateCapabilities(
    values: readonly string[],
    exposure: AiToolExposure,
  ): AiBuiltinToolCapability[] {
    const known = new Set(
      this.registry.list(exposure).map((tool) => tool.capability),
    );
    const invalid = values.find(
      (value) => !known.has(value as AiBuiltinToolCapability),
    );
    if (invalid) {
      throw new BadRequestException(
        `Unknown built-in tool capability: ${invalid}`,
      );
    }
    return [...new Set(values)] as AiBuiltinToolCapability[];
  }

  private readCapabilities(value: unknown): AiBuiltinToolCapability[] {
    if (!Array.isArray(value)) return [];
    const known = new Set<string>(AI_BUILTIN_TOOL_CAPABILITIES);
    return [
      ...new Set(
        value.filter(
          (item): item is AiBuiltinToolCapability =>
            typeof item === 'string' && known.has(item),
        ),
      ),
    ];
  }

  private assertWorkspaceAdmin(user: User): void {
    if (![UserRole.OWNER, UserRole.ADMIN].includes(user.role as UserRole)) {
      throw new ForbiddenException('Only workspace admins can manage AI tools');
    }
  }

  private async assertCanManageSpace(
    user: User,
    spaceId: string,
  ): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
  }
}
