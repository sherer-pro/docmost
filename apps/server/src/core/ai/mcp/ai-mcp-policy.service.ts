import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import {
  AiExternalMcpBinding,
  AiExternalMcpBindingsView,
  AiExternalMcpCatalogEntry,
  AiExternalMcpGroupPolicy,
  AiExternalMcpPreferencesView,
  AiExternalMcpUnavailableReason,
  AiExternalMcpUserPreference,
} from '@docmost/api-contract';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { AiRun, User, Workspace } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AiMcpStoredApprovedTool, toApprovedToolView } from './ai-mcp-discovery.util';
import { AiMcpPolicyError } from './ai-mcp.types';
import {
  AiMcpResolvedTool,
  AiMcpRunSnapshot,
  AiMcpSnapshotConnection,
} from './ai-mcp-snapshot.types';
import {
  AI_MCP_DEFAULT_PROFILE_KEY,
  AI_MCP_MAX_RUN_CONNECTIONS,
  AI_MCP_MAX_RUN_EXTERNAL_TOOLS,
  AI_MCP_MAX_SNAPSHOT_BYTES,
} from './ai-mcp.constants';
import { PutAiMcpBindingDto, PutAiMcpPreferencesDto } from '../dto/ai-mcp.dto';
import { hashCanonicalJson } from '../../../common/helpers/canonical-json.util';
import { postgresJsonb } from '../utils/postgres-jsonb.util';

type EffectiveRow = {
  bindingId: string;
  bindingPolicyVersion: number;
  bindingEnabled: boolean;
  allowedTools: unknown;
  profileAllowedTools: unknown;
  instructions: string | null;
  serverId: string;
  serverName: string;
  namespace: string;
  url: string;
  serverEnabled: boolean;
  configVersion: number;
  approvedTools: unknown;
  optedIn: boolean;
  deniedByGroup: boolean;
  groupAllowedTools: string[][] | null;
};

@Injectable()
export class AiMcpPolicyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  isDeploymentEnabled(): boolean {
    return this.environmentService.isAiExternalMcpEnabled();
  }

  // ---------------------------------------------------------------- bindings

  async getBindingsView(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpBindingsView> {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    const settings = await this.readSettings(workspace.id);

    const bindings = await this.db
      .selectFrom('aiMcpSpaceBindings as b')
      .innerJoin('aiMcpServers as s', 's.id', 'b.serverId')
      .select([
        'b.id as bindingId',
        'b.enabled as bindingEnabled',
        'b.allowedTools',
        'b.profileAllowedTools',
        'b.instructions',
        'b.policyVersion as bindingPolicyVersion',
        'b.spaceId',
        'b.createdAt',
        'b.updatedAt',
        's.id as serverId',
        's.name as serverName',
        's.namespace',
        's.url',
        's.enabled as serverEnabled',
        's.approvedTools',
      ])
      .where('b.spaceId', '=', spaceId)
      .where('b.workspaceId', '=', workspace.id)
      .orderBy('b.createdAt', 'asc')
      .execute();

    const denied = await this.deniedBindingIds(
      bindings.map((row) => row.bindingId),
    );
    const groupPolicies = await this.bindingGroupPolicies(
      bindings.map((row) => row.bindingId),
    );

    const boundServerIds = new Set(bindings.map((row) => row.serverId));
    const catalogRows = await this.db
      .selectFrom('aiMcpServers')
      .select(['id', 'name', 'namespace', 'url', 'approvedTools'])
      .where('workspaceId', '=', workspace.id)
      .where('enabled', '=', true)
      .orderBy('name', 'asc')
      .execute();

    return {
      spaceId,
      deploymentEnabled: this.isDeploymentEnabled(),
      workspaceEnabled: settings.enabled,
      bindings: bindings.map((row) =>
        this.toBindingView(
          row,
          denied,
          groupPolicies.get(row.bindingId) ?? [],
        ),
      ),
      catalog: catalogRows
        .filter((row) => !boundServerIds.has(row.id))
        .map((row) => this.toCatalogEntry(row)),
    };
  }

  async putBinding(
    spaceId: string,
    serverId: string,
    dto: PutAiMcpBindingDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpBindingsView> {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);

    const server = await this.db
      .selectFrom('aiMcpServers')
      .select(['id', 'approvedTools', 'enabled'])
      .where('id', '=', serverId)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();
    if (!server) {
      throw new NotFoundException('External MCP server not found');
    }

    const approvedNames = new Set(
      this.readApproved(server.approvedTools).map((tool) => tool.toolName),
    );
    const selection = dto.toolSelection ?? 'all';
    const toolNames = dto.toolNames ?? [];

    if (selection === 'selected') {
      if (toolNames.length === 0) {
        throw new BadRequestException(
          'Select at least one tool or choose all approved tools',
        );
      }
      for (const name of toolNames) {
        // A space may only narrow the workspace-approved set, never add to it.
        if (!approvedNames.has(name)) {
          throw new BadRequestException({
            code: 'external_mcp_tool_not_approved',
            message: `Tool is not approved for this workspace: ${name}`,
          });
        }
      }
    }

    const stored = selection === 'selected' ? toolNames : [];
    const groupPolicies =
      dto.groupPolicies === undefined
        ? undefined
        : await this.validateGroupPolicies(
            dto.groupPolicies,
            workspace.id,
            new Set(selection === 'selected' ? stored : approvedNames),
          );
    const now = new Date();
    const instructions = dto.instructions?.trim() || null;
    await this.db.transaction().execute(async (trx) => {
      const binding = await trx
        .insertInto('aiMcpSpaceBindings')
        .values({
          workspaceId: workspace.id,
          spaceId,
          serverId,
          enabled: dto.enabled,
          allowedTools: postgresJsonb(stored) as never,
          profileAllowedTools: postgresJsonb({
            [AI_MCP_DEFAULT_PROFILE_KEY]: stored,
          }) as never,
          instructions,
          createdById: user.id,
          updatedById: user.id,
        })
        .onConflict((oc) =>
          oc.columns(['spaceId', 'serverId']).doUpdateSet({
            enabled: dto.enabled,
            allowedTools: postgresJsonb(stored) as never,
            profileAllowedTools: postgresJsonb({
              [AI_MCP_DEFAULT_PROFILE_KEY]: stored,
            }) as never,
            instructions,
            // Atomic increment prevents two concurrent writes from publishing
            // the same version for different policies.
            policyVersion: sql<number>`ai_mcp_space_bindings.policy_version + 1`,
            updatedById: user.id,
            updatedAt: now,
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      if (groupPolicies === undefined) {
        return;
      }

      await trx
        .deleteFrom('aiMcpGroupPolicies')
        .where('bindingId', '=', binding.id)
        .execute();
      if (groupPolicies.length > 0) {
        await trx
          .insertInto('aiMcpGroupPolicies')
          .values(
            groupPolicies.map((policy) => ({
              bindingId: binding.id,
              groupId: policy.groupId,
              denyConnection: policy.denyConnection,
              allowedTools:
                policy.toolSelection === 'selected'
                  ? (postgresJsonb(policy.toolNames) as never)
                  : null,
              createdById: user.id,
            })),
          )
          .execute();
      }
    });

    return this.getBindingsView(spaceId, user, workspace);
  }

  async deleteBinding(
    spaceId: string,
    serverId: string,
    user: User,
    workspace: Workspace,
  ): Promise<void> {
    await this.spaceAbility.assertHasFullSpaceAccess(user, spaceId);
    await this.db
      .deleteFrom('aiMcpSpaceBindings')
      .where('spaceId', '=', spaceId)
      .where('serverId', '=', serverId)
      .where('workspaceId', '=', workspace.id)
      .execute();
  }

  // ------------------------------------------------------------- preferences

  async getPreferences(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpPreferencesView> {
    await this.assertCanUseSpace(user, spaceId);
    const rows = await this.loadEffective(spaceId, workspace.id, user.id);
    const settings = await this.readSettings(workspace.id);

    const items: AiExternalMcpUserPreference[] = rows.map((row) => {
      const reason = this.unavailableReason(row, settings.enabled);
      return {
        serverId: row.serverId,
        serverName: row.serverName,
        namespace: row.namespace,
        url: row.url,
        toolNames: this.effectiveToolNames(row).map((tool) => tool.toolName),
        // Normalized here so the client can never read a missing row as true.
        optedIn: row.optedIn === true,
        available: reason === null,
        unavailableReason: reason,
      };
    });

    return {
      spaceId,
      available: items.some((item) => item.available),
      items,
    };
  }

  async getAvailability(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<
    | { available: true; optedInCount: number; totalCount: number }
    | null
  > {
    const view = await this.getPreferences(spaceId, user, workspace);
    const available = view.items.filter((item) => item.available);
    if (available.length === 0) {
      return null;
    }
    return {
      available: true,
      optedInCount: available.filter((item) => item.optedIn).length,
      totalCount: available.length,
    };
  }

  async putPreferences(
    spaceId: string,
    dto: PutAiMcpPreferencesDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpPreferencesView> {
    await this.assertCanUseSpace(user, spaceId);
    const bindings = await this.db
      .selectFrom('aiMcpSpaceBindings')
      .select(['id', 'serverId'])
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspace.id)
      .execute();
    const byServerId = new Map(
      bindings.map((row) => [row.serverId, row.id] as const),
    );

    for (const item of dto.items) {
      const bindingId = byServerId.get(item.serverId);
      if (!bindingId) {
        throw new NotFoundException(
          'External MCP server is not offered in this space',
        );
      }
    }

    await this.db.transaction().execute(async (trx) => {
      const bindingIds = bindings.map((binding) => binding.id);
      const now = new Date();
      if (bindingIds.length > 0) {
        // PUT is replacement semantics. Omitting a binding revokes an earlier
        // opt-in instead of leaving an invisible stale consent row behind.
        await trx
          .updateTable('aiMcpUserPreferences')
          .set({ enabled: false, updatedAt: now })
          .where('userId', '=', user.id)
          .where('bindingId', 'in', bindingIds)
          .execute();
      }

      for (const item of dto.items) {
        const bindingId = byServerId.get(item.serverId)!;
        await trx
          .insertInto('aiMcpUserPreferences')
          .values({
            bindingId,
            userId: user.id,
            enabled: item.optedIn,
            updatedAt: now,
          })
          .onConflict((oc) =>
            oc.columns(['bindingId', 'userId']).doUpdateSet({
              enabled: item.optedIn,
              updatedAt: now,
            }),
          )
          .execute();
      }
    });

    return this.getPreferences(spaceId, user, workspace);
  }

  // ---------------------------------------------------------------- snapshot

  /**
   * Resolves the capability list for a new run.
   *
   * Returns null when nothing is available, so the common case stores SQL NULL
   * rather than an empty structure.
   */
  async buildRunSnapshot(
    trx: KyselyTransaction | KyselyDB,
    params: {
      workspaceId: string;
      spaceId: string;
      userId: string;
      executionMode: string;
      profileKey?: string;
      profileAllowedTools?: ReadonlyArray<{
        bindingId: string;
        toolName: string;
      }>;
    },
  ): Promise<AiMcpRunSnapshot | null> {
    // External tools exist only for the internal agent. Chat, retrieval, and
    // the inbound MCP surface never see them.
    if (params.executionMode !== 'agent' || !this.isDeploymentEnabled()) {
      return null;
    }

    const settings = await this.readSettings(params.workspaceId, trx);
    if (!settings.enabled) {
      return null;
    }

    const rows = await this.loadEffective(
      params.spaceId,
      params.workspaceId,
      params.userId,
      trx,
    );

    const connections: AiMcpSnapshotConnection[] = [];
    let toolCount = 0;
    const exactProfileTools =
      params.profileAllowedTools === undefined
        ? null
        : new Map<string, Set<string>>();
    for (const selected of params.profileAllowedTools ?? []) {
      const names = exactProfileTools!.get(selected.bindingId) ?? new Set();
      names.add(selected.toolName);
      exactProfileTools!.set(selected.bindingId, names);
    }

    for (const row of rows) {
      if (this.unavailableReason(row, settings.enabled) !== null) {
        continue;
      }
      if (row.optedIn !== true) {
        continue;
      }
      let tools = this.effectiveToolNames(row, exactProfileTools === null);
      if (exactProfileTools) {
        const allowed = exactProfileTools.get(row.bindingId);
        tools = allowed
          ? tools.filter((tool) => allowed.has(tool.toolName))
          : [];
      }
      if (tools.length === 0) {
        continue;
      }
      if (connections.length >= AI_MCP_MAX_RUN_CONNECTIONS) {
        break;
      }

      const limited = tools.slice(
        0,
        Math.max(0, AI_MCP_MAX_RUN_EXTERNAL_TOOLS - toolCount),
      );
      if (limited.length === 0) {
        break;
      }
      toolCount += limited.length;

      connections.push({
        serverId: row.serverId,
        namespace: row.namespace,
        configVersion: Number(row.configVersion),
        bindingId: row.bindingId,
        bindingPolicyVersion: Number(row.bindingPolicyVersion),
        instructions: row.instructions,
        tools: limited.map((tool) => ({
          name: tool.toolName,
          remoteName: tool.remoteName,
          description: tool.description,
          inputSchema: tool.inputSchema,
          argumentNameMap: tool.argumentNameMap ?? {},
          schemaFingerprint: tool.schemaFingerprint,
        })),
      });
    }

    if (connections.length === 0) {
      return null;
    }

    const snapshot: AiMcpRunSnapshot = {
      schemaVersion: 1,
      profileKey: params.profileKey ?? AI_MCP_DEFAULT_PROFILE_KEY,
      workspacePolicyVersion: settings.policyVersion,
      connections,
    };

    // Fail closed rather than truncate. A silently narrowed snapshot would make
    // "the space administrator allowed these tools" false and be very hard to
    // diagnose from the outside.
    if (
      Buffer.byteLength(JSON.stringify(snapshot), 'utf8') >
      AI_MCP_MAX_SNAPSHOT_BYTES
    ) {
      throw new AiMcpPolicyError(
        'agent_mcp_snapshot_too_large',
        'The external MCP capability list is too large for one run',
      );
    }

    return snapshot;
  }

  fingerprintSnapshot(snapshot: AiMcpRunSnapshot): string {
    return hashCanonicalJson(snapshot);
  }

  async maximumProfilePolicyFingerprint(
    trx: KyselyTransaction | KyselyDB,
    params: {
      workspaceId: string;
      spaceId: string;
      tools: ReadonlyArray<{ bindingId: string; toolName: string }>;
    },
  ): Promise<string> {
    const tools = [...params.tools].sort((left, right) =>
      `${left.bindingId}:${left.toolName}`.localeCompare(
        `${right.bindingId}:${right.toolName}`,
      ),
    );
    if (tools.length === 0) {
      return createHash('sha256')
        .update(JSON.stringify({ source: 'profile_external_mcp', tools: [] }))
        .digest('hex');
    }
    const bindingIds = [...new Set(tools.map((tool) => tool.bindingId))];
    const [settings, rows] = await Promise.all([
      this.readSettings(params.workspaceId, trx),
      trx
        .selectFrom('aiMcpSpaceBindings as b')
        .innerJoin('aiMcpServers as s', 's.id', 'b.serverId')
        .select([
          'b.id as bindingId',
          'b.enabled as bindingEnabled',
          'b.allowedTools',
          'b.policyVersion as bindingPolicyVersion',
          's.enabled as serverEnabled',
          's.configVersion',
          's.approvedTools',
        ])
        .where('b.workspaceId', '=', params.workspaceId)
        .where('b.spaceId', '=', params.spaceId)
        .where('b.id', 'in', bindingIds)
        .execute(),
    ]);
    const byBinding = new Map(rows.map((row) => [row.bindingId, row]));
    const manifest = tools.map((tool) => {
      const row = byBinding.get(tool.bindingId);
      const approved = row
        ? this.readApproved(row.approvedTools).find(
            (candidate) => candidate.toolName === tool.toolName,
          )
        : undefined;
      const spaceAllowed = row
        ? this.readStringArray(row.allowedTools)
        : [];
      return {
        bindingId: tool.bindingId,
        toolName: tool.toolName,
        bindingFound: Boolean(row),
        bindingEnabled: row?.bindingEnabled ?? false,
        bindingPolicyVersion: Number(row?.bindingPolicyVersion ?? 0),
        serverEnabled: row?.serverEnabled ?? false,
        serverConfigVersion: Number(row?.configVersion ?? 0),
        approved: Boolean(approved),
        spaceAllowed:
          Boolean(row) &&
          (spaceAllowed.length === 0 || spaceAllowed.includes(tool.toolName)),
      };
    });
    return createHash('sha256')
      .update(
        JSON.stringify({
          source: 'profile_external_mcp',
          deploymentEnabled: this.isDeploymentEnabled(),
          workspaceEnabled: settings.enabled,
          workspacePolicyVersion: settings.policyVersion,
          tools: manifest,
        }),
      )
      .digest('hex');
  }

  readRunSnapshot(run: AiRun): AiMcpRunSnapshot | null {
    const value = (run as { mcpPolicySnapshot?: unknown }).mcpPolicySnapshot;
    if (!value || typeof value !== 'object') {
      return null;
    }
    const snapshot = value as AiMcpRunSnapshot;
    return snapshot.schemaVersion === 1 && Array.isArray(snapshot.connections)
      ? snapshot
      : null;
  }

  /**
   * Re-verifies a call against live policy immediately before it is made.
   *
   * The snapshot alone is not authorization: every gate is checked again here,
   * so revoking access or changing configuration stops an in-flight run.
   */
  async assertCallAllowed(params: {
    snapshot: AiMcpRunSnapshot;
    toolName: string;
    workspaceId: string;
    spaceId: string;
    userId: string;
  }): Promise<AiMcpResolvedTool> {
    const connection = params.snapshot.connections.find((candidate) =>
      candidate.tools.some((tool) => tool.name === params.toolName),
    );
    const tool = connection?.tools.find(
      (candidate) => candidate.name === params.toolName,
    );
    if (!connection || !tool) {
      throw new AiMcpPolicyError(
        'external_mcp_tool_not_approved',
        'Tool is not part of this run',
      );
    }

    if (!this.isDeploymentEnabled()) {
      throw new AiMcpPolicyError(
        'external_mcp_disabled',
        'External MCP is disabled for this deployment',
      );
    }

    const settings = await this.readSettings(params.workspaceId);
    if (!settings.enabled) {
      throw new AiMcpPolicyError(
        'agent_mcp_access_revoked',
        'External MCP is disabled for this workspace',
      );
    }
    if (settings.policyVersion !== params.snapshot.workspacePolicyVersion) {
      throw new AiMcpPolicyError(
        'agent_mcp_config_changed',
        'Workspace external MCP policy changed',
      );
    }
    const rows = await this.loadEffective(
      params.spaceId,
      params.workspaceId,
      params.userId,
    );
    const row = rows.find((candidate) => candidate.serverId === connection.serverId);
    if (!row) {
      throw new AiMcpPolicyError(
        'agent_mcp_access_revoked',
        'External MCP server is no longer bound to this space',
      );
    }

    const reason = this.unavailableReason(row, settings.enabled);
    if (reason !== null) {
      throw new AiMcpPolicyError(
        reason === 'group'
          ? 'agent_mcp_access_revoked'
          : 'agent_mcp_access_revoked',
        'External MCP access was withdrawn',
      );
    }
    if (row.optedIn !== true) {
      throw new AiMcpPolicyError(
        'agent_mcp_access_revoked',
        'The user withdrew access to this external server',
      );
    }
    if (Number(row.configVersion) !== connection.configVersion) {
      throw new AiMcpPolicyError(
        'agent_mcp_config_changed',
        'External MCP server configuration changed',
      );
    }
    if (Number(row.bindingPolicyVersion) !== connection.bindingPolicyVersion) {
      throw new AiMcpPolicyError(
        'agent_mcp_config_changed',
        'External MCP space configuration changed',
      );
    }
    // The tool must still be effective right now, with the same schema the
    // model was shown.
    const effective = this.effectiveToolNames(
      row,
      params.snapshot.profileKey === AI_MCP_DEFAULT_PROFILE_KEY,
    ).find(
      (candidate) => candidate.toolName === params.toolName,
    );
    if (!effective) {
      throw new AiMcpPolicyError(
        'external_mcp_tool_not_approved',
        'Tool is no longer permitted',
      );
    }
    if (effective.schemaFingerprint !== tool.schemaFingerprint) {
      throw new AiMcpPolicyError(
        'agent_mcp_config_changed',
        'External MCP tool definition changed',
      );
    }

    return { connection, tool };
  }

  // ----------------------------------------------------------------- helpers

  private async assertCanUseSpace(user: User, spaceId: string): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  /**
   * One query per space that joins every gate except the deployment switch and
   * the workspace master switch, which are read separately.
   */
  private async loadEffective(
    spaceId: string,
    workspaceId: string,
    userId: string,
    trx: KyselyTransaction | KyselyDB = this.db,
  ): Promise<EffectiveRow[]> {
    const rows = await trx
      .selectFrom('aiMcpSpaceBindings as b')
      .innerJoin('aiMcpServers as s', 's.id', 'b.serverId')
      .leftJoin('aiMcpUserPreferences as p', (join) =>
        join.onRef('p.bindingId', '=', 'b.id').on('p.userId', '=', userId),
      )
      .select((eb) => [
        'b.id as bindingId',
        'b.policyVersion as bindingPolicyVersion',
        'b.enabled as bindingEnabled',
        'b.allowedTools',
        'b.profileAllowedTools',
        'b.instructions',
        's.id as serverId',
        's.name as serverName',
        's.namespace',
        's.url',
        's.enabled as serverEnabled',
        's.configVersion',
        's.approvedTools',
        // Missing preference row means opted out.
        eb.fn
          .coalesce('p.enabled', sql<boolean>`false`)
          .as('optedIn'),
        // Any group the user belongs to that denies this binding blocks it.
        eb
          .exists(
            eb
              .selectFrom('aiMcpGroupPolicies as gp')
              .innerJoin('groupUsers as gu', 'gu.groupId', 'gp.groupId')
              .select('gp.id')
              .whereRef('gp.bindingId', '=', 'b.id')
              .where('gu.userId', '=', userId)
              .where('gp.denyConnection', '=', true),
          )
          .as('deniedByGroup'),
      ])
      .where('b.spaceId', '=', spaceId)
      .where('b.workspaceId', '=', workspaceId)
      .orderBy('b.createdAt', 'asc')
      .execute();

    const groupAllowlists = await this.groupAllowlists(
      rows.map((row) => row.bindingId),
      userId,
      trx,
    );

    return rows.map((row) => ({
      ...(row as unknown as EffectiveRow),
      groupAllowedTools: groupAllowlists.get(row.bindingId) ?? null,
    }));
  }

  /**
   * Per-binding extra narrowing from the user's groups.
   *
   * A null `allowed_tools` means the group adds no narrowing, which is a
   * different state from an empty array.
   */
  private async groupAllowlists(
    bindingIds: string[],
    userId: string,
    trx: KyselyTransaction | KyselyDB,
  ): Promise<Map<string, string[][]>> {
    if (bindingIds.length === 0) {
      return new Map();
    }
    const rows = await trx
      .selectFrom('aiMcpGroupPolicies as gp')
      .innerJoin('groupUsers as gu', 'gu.groupId', 'gp.groupId')
      .select(['gp.bindingId', 'gp.allowedTools'])
      .where('gp.bindingId', 'in', bindingIds)
      .where('gu.userId', '=', userId)
      .execute();

    const result = new Map<string, string[][]>();
    for (const row of rows) {
      if (!Array.isArray(row.allowedTools)) {
        continue;
      }
      const current = result.get(row.bindingId) ?? [];
      current.push(row.allowedTools as string[]);
      result.set(row.bindingId, current);
    }
    return result;
  }

  private async deniedBindingIds(bindingIds: string[]): Promise<Set<string>> {
    if (bindingIds.length === 0) {
      return new Set();
    }
    const rows = await this.db
      .selectFrom('aiMcpGroupPolicies')
      .select('bindingId')
      .where('bindingId', 'in', bindingIds)
      .where('denyConnection', '=', true)
      .execute();
    return new Set(rows.map((row) => row.bindingId));
  }

  private async bindingGroupPolicies(
    bindingIds: string[],
  ): Promise<Map<string, AiExternalMcpGroupPolicy[]>> {
    if (bindingIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .selectFrom('aiMcpGroupPolicies')
      .select(['bindingId', 'groupId', 'denyConnection', 'allowedTools'])
      .where('bindingId', 'in', bindingIds)
      .orderBy('groupId', 'asc')
      .execute();
    const result = new Map<string, AiExternalMcpGroupPolicy[]>();
    for (const row of rows) {
      const selected = Array.isArray(row.allowedTools);
      const current = result.get(row.bindingId) ?? [];
      current.push({
        groupId: row.groupId,
        denyConnection: row.denyConnection,
        toolSelection: selected ? 'selected' : 'all',
        toolNames: selected ? this.readStringArray(row.allowedTools) : [],
      });
      result.set(row.bindingId, current);
    }
    return result;
  }

  private async validateGroupPolicies(
    policies: NonNullable<PutAiMcpBindingDto['groupPolicies']>,
    workspaceId: string,
    availableToolNames: Set<string>,
  ): Promise<AiExternalMcpGroupPolicy[]> {
    if (policies.length === 0) {
      return [];
    }
    const groupIds = policies.map((policy) => policy.groupId);
    const groups = await this.db
      .selectFrom('groups')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('id', 'in', groupIds)
      .execute();
    if (groups.length !== groupIds.length) {
      throw new BadRequestException(
        'Every external MCP group policy must reference this workspace',
      );
    }

    return policies.map((policy) => {
      const toolSelection = policy.toolSelection ?? 'all';
      const toolNames = policy.toolNames ?? [];
      if (toolSelection === 'selected' && toolNames.length === 0) {
        throw new BadRequestException(
          'Select at least one group tool or choose all allowed tools',
        );
      }
      if (toolSelection === 'selected') {
        for (const toolName of toolNames) {
          if (!availableToolNames.has(toolName)) {
            throw new BadRequestException({
              code: 'external_mcp_tool_not_approved',
              message: `Group tool is not available in this space: ${toolName}`,
            });
          }
        }
      }
      return {
        groupId: policy.groupId,
        denyConnection: policy.denyConnection,
        toolSelection,
        toolNames: toolSelection === 'selected' ? toolNames : [],
      };
    });
  }

  /**
   * Intersection of every applicable allowlist.
   *
   * workspace-approved ∧ space allowlist ∧ profile allowlist ∧ every group
   * allowlist that applies to this user.
   */
  private effectiveToolNames(
    row: EffectiveRow,
    includeLegacyProfile = true,
  ): AiMcpStoredApprovedTool[] {
    const approved = this.readApproved(row.approvedTools);
    const spaceAllowed = this.readStringArray(row.allowedTools);
    const profileMap =
      row.profileAllowedTools && typeof row.profileAllowedTools === 'object'
        ? (row.profileAllowedTools as Record<string, unknown>)
        : {};
    const profileAllowed = this.readStringArray(
      profileMap[AI_MCP_DEFAULT_PROFILE_KEY],
    );

    let result = approved;
    if (spaceAllowed.length > 0) {
      const allowed = new Set(spaceAllowed);
      result = result.filter((tool) => allowed.has(tool.toolName));
    }
    if (includeLegacyProfile && profileAllowed.length > 0) {
      const allowed = new Set(profileAllowed);
      result = result.filter((tool) => allowed.has(tool.toolName));
    }
    for (const groupAllowed of row.groupAllowedTools ?? []) {
      const allowed = new Set(groupAllowed);
      result = result.filter((tool) => allowed.has(tool.toolName));
    }
    return result;
  }

  private unavailableReason(
    row: EffectiveRow,
    workspaceEnabled: boolean,
  ): AiExternalMcpUnavailableReason | null {
    if (!this.isDeploymentEnabled()) {
      return 'deployment';
    }
    if (!workspaceEnabled) {
      return 'workspace';
    }
    if (!row.serverEnabled) {
      return 'server';
    }
    if (!row.bindingEnabled) {
      return 'binding';
    }
    if (row.deniedByGroup) {
      return 'group';
    }
    return null;
  }

  private toBindingView(
    row: any,
    denied: Set<string>,
    groupPolicies: AiExternalMcpGroupPolicy[],
  ): AiExternalMcpBinding {
    const approved = this.readApproved(row.approvedTools);
    const spaceAllowed = this.readStringArray(row.allowedTools);
    return {
      bindingId: row.bindingId,
      serverId: row.serverId,
      serverName: row.serverName,
      namespace: row.namespace,
      url: row.url,
      spaceId: row.spaceId,
      enabled: row.bindingEnabled,
      serverEnabled: row.serverEnabled,
      toolSelection: spaceAllowed.length > 0 ? 'selected' : 'all',
      toolNames: spaceAllowed,
      availableTools: approved.map((tool) =>
        toApprovedToolView(tool, {
          remoteName: tool.remoteName,
          schemaFingerprint: tool.schemaFingerprint,
        } as never),
      ),
      instructions: row.instructions,
      groupPolicies,
      deniedByGroup: denied.has(row.bindingId),
      policyVersion: Number(row.bindingPolicyVersion),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toCatalogEntry(row: any): AiExternalMcpCatalogEntry {
    const approved = this.readApproved(row.approvedTools);
    return {
      serverId: row.id,
      name: row.name,
      namespace: row.namespace,
      url: row.url,
      approvedTools: approved.map((tool) =>
        toApprovedToolView(tool, {
          remoteName: tool.remoteName,
          schemaFingerprint: tool.schemaFingerprint,
        } as never),
      ),
    };
  }

  private async readSettings(
    workspaceId: string,
    trx: KyselyTransaction | KyselyDB = this.db,
  ) {
    const row = await trx
      .selectFrom('aiMcpWorkspaceSettings')
      .select(['enabled', 'allowedOrigins', 'policyVersion'])
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    return {
      enabled: row?.enabled ?? false,
      allowedOrigins: row?.allowedOrigins ?? '',
      policyVersion: row ? Number(row.policyVersion) : 0,
    };
  }

  private readApproved(value: unknown): AiMcpStoredApprovedTool[] {
    return Array.isArray(value)
      ? (value as AiMcpStoredApprovedTool[]).filter(
          (tool) =>
            Object.prototype.hasOwnProperty.call(tool, 'argumentNameMap') &&
            typeof tool.argumentNameMap === 'object' &&
            tool.argumentNameMap !== null,
        )
      : [];
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
}
