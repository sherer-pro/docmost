import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import {
  AiExternalMcpDiscoverResult,
  AiExternalMcpDiscoverySnapshot,
  AiExternalMcpServer,
  AiExternalMcpServerListItem,
  AiExternalMcpSettings,
  AiExternalMcpTestResult,
} from '@docmost/api-contract';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../casl/interfaces/workspace-ability.type';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AiMcpUrlPolicyService } from '../services/ai-mcp-url-policy.service';
import { AiOperationalMetricsService } from '../services/ai-operational-metrics.service';
import { AiMcpClientPoolService } from './ai-mcp-client-pool.service';
import {
  decryptAiMcpHeaders,
  encryptAiMcpHeaders,
  validateAiMcpHeaders,
} from './ai-mcp-headers.util';
import {
  AiMcpStoredApprovedTool,
  AiMcpStoredDiscoveredTool,
  storeDiscoveredTools,
  toApprovedToolView,
  toDiscoveredToolView,
} from './ai-mcp-discovery.util';
import { AiMcpTransportError } from './ai-mcp-pinned-fetch';
import { AiMcpPolicyError } from './ai-mcp.types';
import {
  AI_MCP_MAX_SERVERS_PER_WORKSPACE,
  AI_MCP_TRANSPORT,
} from './ai-mcp.constants';
import {
  CreateAiMcpServerDto,
  UpdateAiMcpServerDto,
  UpdateAiMcpSettingsDto,
} from '../dto/ai-mcp.dto';

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value ?? null)}::jsonb`;
}

function parseOriginList(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

@Injectable()
export class AiMcpAdminService {
  private readonly logger = new Logger(AiMcpAdminService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly urlPolicy: AiMcpUrlPolicyService,
    private readonly pool: AiMcpClientPoolService,
    private readonly metrics: AiOperationalMetricsService,
  ) {}

  async getSettings(
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpSettings> {
    this.assertCanManage(user, workspace);
    const row = await this.readSettings(workspace.id);
    return {
      deploymentEnabled: this.environmentService.isAiExternalMcpEnabled(),
      enabled: row.enabled,
      deploymentAllowedOrigins: parseOriginList(
        this.environmentService.getAiMcpAllowedOrigins(),
      ),
      allowedOrigins: parseOriginList(row.allowedOrigins),
      policyVersion: row.policyVersion,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  }

  async updateSettings(
    dto: UpdateAiMcpSettingsDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpSettings> {
    this.assertCanManage(user, workspace);

    if (dto.allowedOrigins) {
      // Reject anything the deployment does not already allow, so a stored
      // value can never imply more reach than an operator granted.
      const deploymentOrigins = new Set(
        parseOriginList(this.environmentService.getAiMcpAllowedOrigins()).map(
          (origin) => this.normalizeOrigin(origin),
        ),
      );
      for (const origin of dto.allowedOrigins) {
        const normalized = this.normalizeOrigin(origin);
        if (!normalized) {
          throw new BadRequestException(`Invalid origin: ${origin}`);
        }
        if (!deploymentOrigins.has(normalized)) {
          throw new BadRequestException(
            `Origin is not allowed by this deployment: ${origin}`,
          );
        }
      }
    }

    const now = new Date();
    const changed = await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('aiMcpWorkspaceSettings')
        .values({
          workspaceId: workspace.id,
          enabled: false,
          allowedOrigins: '',
          createdById: user.id,
          updatedById: user.id,
          updatedAt: now,
        })
        .onConflict((oc) => oc.column('workspaceId').doNothing())
        .execute();

      // Serialize the read/merge/write so concurrent partial updates cannot
      // overwrite each other or reuse one policy version.
      const current = await trx
        .selectFrom('aiMcpWorkspaceSettings')
        .select(['enabled', 'allowedOrigins'])
        .where('workspaceId', '=', workspace.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const nextEnabled = dto.enabled ?? current.enabled;
      const nextOrigins = dto.allowedOrigins
        ? dto.allowedOrigins
            .map((origin) => this.normalizeOrigin(origin))
            .join(',')
        : current.allowedOrigins;
      const didChange =
        nextEnabled !== current.enabled || nextOrigins !== current.allowedOrigins;
      if (didChange) {
        await trx
          .updateTable('aiMcpWorkspaceSettings')
          .set({
            enabled: nextEnabled,
            allowedOrigins: nextOrigins,
            policyVersion: sql<number>`ai_mcp_workspace_settings.policy_version + 1`,
            updatedById: user.id,
            updatedAt: now,
          })
          .where('workspaceId', '=', workspace.id)
          .execute();
      }
      return didChange;
    });

    if (changed) {
      await this.invalidateWorkspace(workspace.id, 'settings');
    }
    return this.getSettings(user, workspace);
  }

  async listServers(
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpServerListItem[]> {
    this.assertCanManage(user, workspace);
    const rows = await this.db
      .selectFrom('aiMcpServers')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .orderBy('createdAt', 'asc')
      .execute();

    const counts = await this.countBindings(rows.map((row) => row.id));
    return rows.map((row) => this.toListItem(row, counts.get(row.id) ?? 0));
  }

  async createServer(
    dto: CreateAiMcpServerDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpServer> {
    this.assertCanManage(user, workspace);

    const existing = await this.db
      .selectFrom('aiMcpServers')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirstOrThrow();
    if (Number(existing.count) >= AI_MCP_MAX_SERVERS_PER_WORKSPACE) {
      throw new BadRequestException(
        `A workspace may configure at most ${AI_MCP_MAX_SERVERS_PER_WORKSPACE} external MCP servers`,
      );
    }

    const settings = await this.readSettings(workspace.id);
    await this.assertUrlAllowed(dto.url, settings.allowedOrigins);
    const headers = this.validateHeaders(dto.headers);

    try {
      const row = await this.db
        .insertInto('aiMcpServers')
        .values({
          workspaceId: workspace.id,
          name: dto.name.trim(),
          namespace: dto.namespace,
          transport: dto.transport ?? AI_MCP_TRANSPORT,
          url: dto.url,
          headersEncrypted: encryptAiMcpHeaders(
            headers.map,
            this.environmentService.getAppSecret(),
          ),
          headerNames: jsonb(headers.names) as never,
          // Always created disabled: an administrator must test and approve
          // tools before anything reaches an agent run.
          enabled: false,
          createdById: user.id,
          updatedById: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return this.toDetail(row, 0);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async getServer(
    serverId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpServer> {
    this.assertCanManage(user, workspace);
    const row = await this.requireServer(serverId, workspace.id);
    const counts = await this.countBindings([row.id]);
    return this.toDetail(row, counts.get(row.id) ?? 0);
  }

  async updateServer(
    serverId: string,
    dto: UpdateAiMcpServerDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpServer> {
    this.assertCanManage(user, workspace);

    if (dto.headers && dto.clearHeaders) {
      throw new BadRequestException({
        code: 'external_mcp_headers_conflict',
        message:
          'Choose either new header values or clearing headers, not both',
      });
    }

    const row = await this.requireServer(serverId, workspace.id);
    const settings = await this.readSettings(workspace.id);
    const update: Record<string, unknown> = { updatedById: user.id };
    let connectionChanged = false;

    if (dto.name !== undefined) {
      update.name = dto.name.trim();
    }
    if (dto.url !== undefined && dto.url !== row.url) {
      await this.assertUrlAllowed(dto.url, settings.allowedOrigins);
      update.url = dto.url;
      connectionChanged = true;
    }
    if (dto.headers !== undefined) {
      const headers = this.validateHeaders(dto.headers);
      update.headersEncrypted = encryptAiMcpHeaders(
        headers.map,
        this.environmentService.getAppSecret(),
      );
      update.headerNames = jsonb(headers.names);
      connectionChanged = true;
    } else if (dto.clearHeaders) {
      update.headersEncrypted = null;
      update.headerNames = jsonb([]);
      connectionChanged = true;
    }

    const discovered = this.readDiscovered(row.discoveredTools);
    let approved = this.readApproved(row.approvedTools);

    if (dto.tools !== undefined) {
      approved = this.applyApprovals(dto.tools, discovered, approved, user.id);
      update.approvedTools = jsonb(approved);
      connectionChanged = true;
    }

    if (dto.enabled !== undefined && dto.enabled !== row.enabled) {
      if (dto.enabled && approved.length === 0) {
        throw new BadRequestException(
          'Approve at least one tool before enabling this server',
        );
      }
      update.enabled = dto.enabled;
      connectionChanged = true;
    }

    if (connectionChanged) {
      update.configVersion = sql<number>`ai_mcp_servers.config_version + 1`;
    }
    update.updatedAt = new Date();

    let updated;
    try {
      updated = await this.db
        .updateTable('aiMcpServers')
        .set(update as never)
        .where('id', '=', serverId)
        .where('workspaceId', '=', workspace.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }

    if (connectionChanged) {
      await this.pool.publishInvalidation(serverId, 'config');
    }
    const counts = await this.countBindings([serverId]);
    return this.toDetail(updated, counts.get(serverId) ?? 0);
  }

  async deleteServer(
    serverId: string,
    user: User,
    workspace: Workspace,
  ): Promise<void> {
    this.assertCanManage(user, workspace);
    await this.requireServer(serverId, workspace.id);

    // A hard delete, so the encrypted headers actually stop existing. Run steps
    // keep their audit trail through an on-delete-set-null reference.
    await this.db
      .deleteFrom('aiMcpServers')
      .where('id', '=', serverId)
      .where('workspaceId', '=', workspace.id)
      .execute();

    await this.pool.publishInvalidation(serverId, 'deleted');
  }

  async testServer(
    serverId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpTestResult> {
    this.assertCanManage(user, workspace);
    const row = await this.requireServer(serverId, workspace.id);
    const startedAt = Date.now();

    try {
      const probe = await this.pool.probe({
        workspaceId: workspace.id,
        url: row.url,
        headers: decryptAiMcpHeaders(
          row.headersEncrypted,
          this.environmentService.getAppSecret(),
        ),
        mode: 'test',
      });
      await this.recordTest(serverId, 'passed', null);
      this.metrics.observeMcpProbe('test', 'ok', probe.latencyMs);
      return {
        status: 'passed',
        latencyMs: probe.latencyMs,
        protocolVersion: probe.protocolVersion,
        serverName: probe.serverName,
        serverVersion: probe.serverVersion,
        toolCount: null,
        errorCode: null,
      };
    } catch (error) {
      const code = this.errorCode(error);
      await this.recordTest(serverId, 'failed', code);
      this.metrics.observeMcpProbe(
        'test',
        'connect_error',
        Date.now() - startedAt,
      );
      return {
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        protocolVersion: null,
        serverName: null,
        serverVersion: null,
        toolCount: null,
        errorCode: code,
      };
    }
  }

  async discoverServer(
    serverId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiExternalMcpDiscoverResult> {
    this.assertCanManage(user, workspace);
    const row = await this.requireServer(serverId, workspace.id);
    const startedAt = Date.now();

    let probe;
    try {
      probe = await this.pool.probe({
        workspaceId: workspace.id,
        url: row.url,
        headers: decryptAiMcpHeaders(
          row.headersEncrypted,
          this.environmentService.getAppSecret(),
        ),
        mode: 'discover',
      });
    } catch (error) {
      const code = this.errorCode(error);
      await this.recordTest(serverId, 'failed', code);
      this.metrics.observeMcpProbe(
        'discover',
        'connect_error',
        Date.now() - startedAt,
      );
      return { snapshot: null, latencyMs: Date.now() - startedAt, errorCode: code };
    }

    let stored: AiMcpStoredDiscoveredTool[];
    try {
      stored = storeDiscoveredTools(row.namespace, probe.tools);
    } catch (error) {
      const code = this.errorCode(error);
      await this.recordTest(serverId, 'failed', code);
      this.metrics.observeMcpProbe(
        'discover',
        'protocol_error',
        Date.now() - startedAt,
      );
      return { snapshot: null, latencyMs: Date.now() - startedAt, errorCode: code };
    }
    const previouslyApproved = this.readApproved(row.approvedTools);
    // A tool whose schema moved loses its approval. Widening is always an
    // explicit administrator action, never a side effect of re-discovery.
    const byRemoteName = new Map(
      stored.map((tool) => [tool.remoteName, tool] as const),
    );
    const retainedApprovals = previouslyApproved.filter((approval) => {
      const match = byRemoteName.get(approval.remoteName);
      return match?.schemaFingerprint === approval.schemaFingerprint;
    });

    const now = new Date();
    const updated = await this.db
      .updateTable('aiMcpServers')
      .set({
        discoveredTools: jsonb(stored) as never,
        discoveryToolCount: stored.length,
        discoveredAt: now,
        approvedTools: jsonb(retainedApprovals) as never,
        // Discovery is a capability snapshot. Every successful replacement gets
        // a new version, including an apparently identical result.
        configVersion: Number(row.configVersion) + 1,
        testStatus: 'passed',
        testErrorCode: null,
        testCheckedAt: now,
        updatedById: user.id,
        updatedAt: now,
      })
      .where('id', '=', serverId)
      .where('workspaceId', '=', workspace.id)
      .where('configVersion', '=', row.configVersion)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      throw new ConflictException({
        code: 'agent_mcp_config_changed',
        message: 'External MCP server changed while discovery was running',
      });
    }
    await this.pool.publishInvalidation(serverId, 'discovery');
    this.metrics.observeMcpProbe('discover', 'ok', probe.latencyMs);

    return {
      snapshot: this.toDiscoverySnapshot(updated),
      latencyMs: probe.latencyMs,
      errorCode: null,
    };
  }

  private applyApprovals(
    inputs: Array<{ remoteName: string; approved: boolean; description?: string }>,
    discovered: AiMcpStoredDiscoveredTool[],
    current: AiMcpStoredApprovedTool[],
    userId: string,
  ): AiMcpStoredApprovedTool[] {
    const byRemoteName = new Map(
      discovered.map((tool) => [tool.remoteName, tool] as const),
    );
    const existing = new Map(
      current.map((tool) => [tool.remoteName, tool] as const),
    );
    const result: AiMcpStoredApprovedTool[] = [];
    const now = new Date().toISOString();

    for (const input of inputs) {
      if (!input.approved) {
        continue;
      }
      const tool = byRemoteName.get(input.remoteName);
      if (!tool) {
        throw new BadRequestException(
          `Unknown external MCP tool: ${input.remoteName}. Run discovery first.`,
        );
      }
      if (!tool.inputSchema) {
        throw new BadRequestException(
          `External MCP tool cannot be approved because its schema is unsupported: ${input.remoteName}`,
        );
      }
      const description = input.description?.trim();
      if (!description) {
        throw new BadRequestException(
          `A model-facing description is required to approve ${input.remoteName}`,
        );
      }

      const previous = existing.get(input.remoteName);
      result.push({
        toolName: tool.toolName,
        remoteName: tool.remoteName,
        description,
        inputSchema: tool.inputSchema,
        argumentNameMap: tool.argumentNameMap ?? {},
        schemaFingerprint: tool.schemaFingerprint,
        approvedAt:
          previous?.schemaFingerprint === tool.schemaFingerprint
            ? previous.approvedAt
            : now,
        approvedByUserId: userId,
      });
    }

    return result;
  }

  private validateHeaders(headers: Record<string, string> | undefined): {
    map: Record<string, string>;
    names: string[];
  } {
    if (!headers) {
      return { map: {}, names: [] };
    }
    const result = validateAiMcpHeaders(headers);
    if (result.status === 'rejected') {
      throw new BadRequestException(result.reason);
    }
    return { map: result.headers, names: result.names };
  }

  private async assertUrlAllowed(
    url: string,
    workspaceAllowedOrigins: string,
  ): Promise<void> {
    await this.urlPolicy.assertAllowedForWorkspace(url, workspaceAllowedOrigins);
  }

  private normalizeOrigin(raw: string): string {
    try {
      return new URL(raw).origin;
    } catch {
      return '';
    }
  }

  private async readSettings(workspaceId: string) {
    const row = await this.db
      .selectFrom('aiMcpWorkspaceSettings')
      .select(['enabled', 'allowedOrigins', 'policyVersion', 'updatedAt'])
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    return {
      enabled: row?.enabled ?? false,
      allowedOrigins: row?.allowedOrigins ?? '',
      policyVersion: row ? Number(row.policyVersion) : 0,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  private async requireServer(serverId: string, workspaceId: string) {
    const row = await this.db
      .selectFrom('aiMcpServers')
      .selectAll()
      .where('id', '=', serverId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException('External MCP server not found');
    }
    return row;
  }

  private async countBindings(
    serverIds: string[],
  ): Promise<Map<string, number>> {
    if (serverIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .selectFrom('aiMcpSpaceBindings')
      .select((eb) => ['serverId', eb.fn.countAll<string>().as('count')])
      .where('serverId', 'in', serverIds)
      .groupBy('serverId')
      .execute();
    return new Map(rows.map((row) => [row.serverId, Number(row.count)]));
  }

  private async recordTest(
    serverId: string,
    status: 'passed' | 'failed',
    errorCode: string | null,
  ): Promise<void> {
    await this.db
      .updateTable('aiMcpServers')
      .set({
        testStatus: status,
        testErrorCode: errorCode,
        testCheckedAt: new Date(),
      })
      .where('id', '=', serverId)
      .execute();
  }

  private async invalidateWorkspace(
    workspaceId: string,
    reason: string,
  ): Promise<void> {
    const rows = await this.db
      .selectFrom('aiMcpServers')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .execute();
    for (const row of rows) {
      await this.pool.publishInvalidation(row.id, reason);
    }
  }

  private readDiscovered(value: unknown): AiMcpStoredDiscoveredTool[] {
    return Array.isArray(value) ? (value as AiMcpStoredDiscoveredTool[]) : [];
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

  private toListItem(row: any, boundSpaceCount: number): AiExternalMcpServerListItem {
    const approved = this.readApproved(row.approvedTools);
    return {
      id: row.id,
      name: row.name,
      namespace: row.namespace,
      url: row.url,
      transport: row.transport,
      enabled: row.enabled,
      // A boolean only. Never a value, never a length, never a count.
      headersConfigured: Boolean(row.headersEncrypted),
      approvedToolCount: approved.length,
      discoveredToolCount: Number(row.discoveryToolCount ?? 0),
      boundSpaceCount,
      testStatus: row.testStatus,
      testErrorCode: row.testErrorCode,
      testCheckedAt: row.testCheckedAt?.toISOString() ?? null,
      discoveredAt: row.discoveredAt?.toISOString() ?? null,
      configVersion: Number(row.configVersion),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(row: any, boundSpaceCount: number): AiExternalMcpServer {
    const discovered = this.readDiscovered(row.discoveredTools);
    const approved = this.readApproved(row.approvedTools);
    const byRemoteName = new Map(
      discovered.map((tool) => [tool.remoteName, tool] as const),
    );

    return {
      ...this.toListItem(row, boundSpaceCount),
      // Names only. A workspace administrator can see which headers exist
      // without any endpoint ever returning a value.
      headerNames: Array.isArray(row.headerNames)
        ? (row.headerNames as string[])
        : [],
      approvedTools: approved.map((tool) =>
        toApprovedToolView(tool, byRemoteName.get(tool.remoteName)),
      ),
      discovery: this.toDiscoverySnapshot(row),
    };
  }

  private toDiscoverySnapshot(row: any): AiExternalMcpDiscoverySnapshot | null {
    if (!row.discoveredAt) {
      return null;
    }
    const discovered = this.readDiscovered(row.discoveredTools);
    const approved = new Map(
      this.readApproved(row.approvedTools).map(
        (tool) => [tool.remoteName, tool] as const,
      ),
    );
    return {
      discoveredAt: row.discoveredAt.toISOString(),
      toolCount: discovered.length,
      tools: discovered.map((tool) =>
        toDiscoveredToolView(tool, approved.get(tool.remoteName)),
      ),
    };
  }

  private errorCode(error: unknown): AiExternalMcpTestResult['errorCode'] {
    if (error instanceof AiMcpTransportError) {
      return error.code;
    }
    if (error instanceof AiMcpPolicyError) {
      return error.code;
    }
    if (error instanceof BadRequestException) {
      return 'external_mcp_url_rejected';
    }
    return 'external_mcp_unavailable';
  }

  private mapUniqueViolation(error: unknown): Error {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('ai_mcp_servers_workspace_namespace_unique')) {
      return new BadRequestException({
        code: 'external_mcp_namespace_conflict',
        message: 'That namespace is already used by another external server',
      });
    }
    if (message.includes('ai_mcp_servers_workspace_name_unique')) {
      return new BadRequestException('That name is already in use');
    }
    return error instanceof Error ? error : new Error('Unexpected error');
  }

  private assertCanManage(user: User, workspace: Workspace): void {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }
  }
}
