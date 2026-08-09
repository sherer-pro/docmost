import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import {
  AI_ASSISTANT_PROFILE_ICONS,
  AI_ASSISTANT_PROFILE_LIMITS,
  AI_BUILTIN_TOOL_CAPABILITIES,
  AiAssistantProfile as AiAssistantProfileContract,
  AiAssistantProfileAgentStatus,
  AiAssistantProfileAvailability,
  AiAssistantProfileConversationSummary,
  AiAssistantProfileExternalTool,
  AiAssistantProfileGroupPolicy,
  AiAssistantProfilePreferences,
  AiAssistantProfileProviderSnapshot,
  AiAssistantProfileSnapshot,
  AiAssistantProfileSummary,
  AiAssistantProfilesView,
  AiAssistantProfileTestResult,
  AiAssistantProfileVerificationStatus,
  AiAssistantProfileWorkspacePolicy,
  AiBuiltinToolCapability,
  AiModelTestResult,
  AiQuickCommand,
} from '@docmost/api-contract';
import {
  AiAssistantProfile as AiAssistantProfileEntity,
  AiRun,
  AiSpaceConfig,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import {
  KyselyDB,
  KyselyTransaction,
} from '@docmost/db/types/kysely.types';
import { UserRole } from '../../../common/helpers/types/permission';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import {
  CreateAiAssistantProfileDto,
  UpdateAiAssistantProfileDto,
  UpdateAiAssistantProfilePreferencesDto,
  UpdateAiAssistantProfileWorkspacePolicyDto,
} from '../dto/ai-assistant-profile.dto';
import { AiProviderConfig } from '../ai.types';
import { AiMcpPolicyService } from '../mcp/ai-mcp-policy.service';
import { AiMcpRunSnapshot } from '../mcp/ai-mcp-snapshot.types';
import { AiBuiltinToolPolicyService } from '../tools/ai-builtin-tool-policy.service';
import { AiConfigService } from './ai-config.service';
import { AiOperationalMetricsService } from './ai-operational-metrics.service';
import { hashCanonicalJson } from '../../../common/helpers/canonical-json.util';
import { OpenAiCompatibleProviderService } from './openai-compatible-provider.service';
import { postgresJsonb } from '../utils/postgres-jsonb.util';

type Db = KyselyDB | KyselyTransaction;

type NormalizedProfileValues = {
  name: string;
  description: string | null;
  icon: (typeof AI_ASSISTANT_PROFILE_ICONS)[number];
  instructions: string;
  quickCommands: AiQuickCommand[] | null;
  chatModelOverride: string | null;
  temperatureOverride: number | null;
  maxOutputTokensOverride: number | null;
  allowedBuiltinCapabilities: AiBuiltinToolCapability[];
  allowedExternalTools: Array<{ bindingId: string; toolName: string }>;
  groupPolicies: AiAssistantProfileGroupPolicy[];
  autoStart: boolean;
  launchMessage: string | null;
  enabled: boolean;
};

type VerificationParts = {
  providerFingerprint: string;
  toolSchemaFingerprint: string;
  toolPolicyFingerprint: string;
  verificationFingerprint: string;
  effectiveBuiltinCapabilities: AiBuiltinToolCapability[];
  externalToolCount: number;
};

function fingerprint(value: unknown): string {
  return hashCanonicalJson(value);
}

@Injectable()
export class AiAssistantProfileService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environment: EnvironmentService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly configs: AiConfigService,
    private readonly builtinTools: AiBuiltinToolPolicyService,
    private readonly mcpPolicy: AiMcpPolicyService,
    private readonly provider: OpenAiCompatibleProviderService,
    private readonly metrics: AiOperationalMetricsService,
  ) {}

  async getWorkspacePolicy(
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfileWorkspacePolicy> {
    this.assertWorkspaceAdmin(user);
    const settings = await this.readWorkspaceSettings(workspace.id);
    return this.toWorkspacePolicy(settings);
  }

  async updateWorkspacePolicy(
    dto: UpdateAiAssistantProfileWorkspacePolicyDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfileWorkspacePolicy> {
    this.assertWorkspaceAdmin(user);
    const current = await this.readWorkspaceSettings(workspace.id);
    await this.db
      .insertInto('aiAssistantProfileWorkspaceSettings')
      .values({
        workspaceId: workspace.id,
        enabled: dto.enabled ?? current.enabled,
        modelOverridesEnabled:
          dto.modelOverridesEnabled ?? current.modelOverridesEnabled,
        updatedById: user.id,
      })
      .onConflict((oc) =>
        oc.column('workspaceId').doUpdateSet({
          enabled: dto.enabled ?? current.enabled,
          modelOverridesEnabled:
            dto.modelOverridesEnabled ?? current.modelOverridesEnabled,
          policyVersion: sql<number>`ai_assistant_profile_workspace_settings.policy_version + 1`,
          updatedAt: new Date(),
          updatedById: user.id,
        }),
      )
      .execute();
    this.metrics.observeProfileOutcome('policy_updated');
    return this.getWorkspacePolicy(user, workspace);
  }

  async list(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfilesView> {
    await this.assertCanUseSpace(user, spaceId);
    const [settings, config, preferences, canManage] = await Promise.all([
      this.readWorkspaceSettings(workspace.id),
      this.configs.getRawConfig(spaceId, workspace.id),
      this.readPreferences(spaceId, user.id, workspace.id),
      this.canManageSpace(user, spaceId),
    ]);
    const deploymentEnabled = this.environment.isAiAssistantProfilesEnabled();
    const rows = await this.db
      .selectFrom('aiAssistantProfiles')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .orderBy('name', 'asc')
      .execute();

    const summaries: AiAssistantProfileSummary[] = [];
    for (const row of rows) {
      const groupAllowed = await this.isGroupAllowed(
        row.id,
        user.id,
        this.db,
      );
      const availability = this.availabilityForRow({
        row,
        deploymentEnabled,
        workspaceEnabled: settings.enabled,
        groupAllowed,
      });
      if (!canManage && availability !== 'available') continue;
      summaries.push(
        await this.toSummary(row, config, availability, this.db, user.id),
      );
    }

    const availableIds = new Set(
      summaries
        .filter((profile) => profile.availability === 'available')
        .map((profile) => profile.id),
    );
    return {
      enabled: deploymentEnabled && settings.enabled,
      defaultProfileId:
        config?.defaultAssistantProfileId &&
        availableIds.has(config.defaultAssistantProfileId)
          ? config.defaultAssistantProfileId
          : null,
      preferredProfileId:
        preferences.preferredProfileId &&
        availableIds.has(preferences.preferredProfileId)
          ? preferences.preferredProfileId
          : null,
      items: summaries,
    };
  }

  async getAdmin(
    spaceId: string,
    profileId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfileContract> {
    await this.assertCanManageSpace(user, spaceId);
    const row = await this.getProfileRow(
      profileId,
      spaceId,
      workspace.id,
      this.db,
      true,
    );
    const config = await this.configs.getRawConfig(spaceId, workspace.id);
    return this.toAdminProfile(row, config, this.db);
  }

  async create(
    spaceId: string,
    dto: CreateAiAssistantProfileDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfileContract> {
    await this.assertCanManageSpace(user, spaceId);
    const config = await this.requireConfig(spaceId, workspace.id);
    const settings = await this.readWorkspaceSettings(workspace.id);
    const values = await this.normalizeValues(
      dto,
      undefined,
      config,
      settings,
      spaceId,
      workspace.id,
      this.db,
    );
    let row: AiAssistantProfileEntity;
    try {
      row = await this.db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`ai-profiles:${spaceId}`}, 0))`.execute(
          trx,
        );
        const count = await trx
          .selectFrom('aiAssistantProfiles')
          .select(sql<number>`count(*)`.as('count'))
          .where('workspaceId', '=', workspace.id)
          .where('spaceId', '=', spaceId)
          .where('deletedAt', 'is', null)
          .executeTakeFirstOrThrow();
        if (Number(count.count) >= AI_ASSISTANT_PROFILE_LIMITS.perSpace) {
          throw new BadRequestException(
            `A space can have at most ${AI_ASSISTANT_PROFILE_LIMITS.perSpace} assistant profiles`,
          );
        }
        const inserted = await trx
          .insertInto('aiAssistantProfiles')
          .values({
            workspaceId: workspace.id,
            spaceId,
            name: values.name,
            description: values.description,
            icon: values.icon,
            instructions: values.instructions,
            quickCommands:
              values.quickCommands === null
                ? null
                : (postgresJsonb(values.quickCommands) as never),
            chatModelOverride: values.chatModelOverride,
            temperatureOverride: values.temperatureOverride,
            maxOutputTokensOverride: values.maxOutputTokensOverride,
            allowedBuiltinCapabilities: postgresJsonb(
              values.allowedBuiltinCapabilities,
            ) as never,
            autoStart: values.autoStart,
            launchMessage: values.launchMessage,
            enabled: values.enabled,
            createdById: user.id,
            updatedById: user.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.replaceRelations(trx, inserted.id, values, user.id);
        return inserted;
      });
    } catch (error) {
      this.translateUniqueNameError(error);
      throw error;
    }
    this.metrics.observeProfileOutcome('created');
    return this.toAdminProfile(row, config, this.db);
  }

  async update(
    spaceId: string,
    profileId: string,
    dto: UpdateAiAssistantProfileDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfileContract> {
    await this.assertCanManageSpace(user, spaceId);
    const config = await this.requireConfig(spaceId, workspace.id);
    const settings = await this.readWorkspaceSettings(workspace.id);
    let row: AiAssistantProfileEntity;
    try {
      row = await this.db.transaction().execute(async (trx) => {
        const existing = await this.getProfileRow(
          profileId,
          spaceId,
          workspace.id,
          trx,
          false,
          true,
        );
        if (existing.version !== dto.expectedVersion) {
          throw this.versionConflict();
        }
        const detail = await this.loadRelations(existing.id, trx);
        const values = await this.normalizeValues(
          dto,
          { row: existing, ...detail },
          config,
          settings,
          spaceId,
          workspace.id,
          trx,
        );
        const updated = await trx
          .updateTable('aiAssistantProfiles')
          .set({
            name: values.name,
            description: values.description,
            icon: values.icon,
            instructions: values.instructions,
            quickCommands:
              values.quickCommands === null
                ? null
                : (postgresJsonb(values.quickCommands) as never),
            chatModelOverride: values.chatModelOverride,
            temperatureOverride: values.temperatureOverride,
            maxOutputTokensOverride: values.maxOutputTokensOverride,
            allowedBuiltinCapabilities: postgresJsonb(
              values.allowedBuiltinCapabilities,
            ) as never,
            autoStart: values.autoStart,
            launchMessage: values.launchMessage,
            enabled: values.enabled,
            version: sql<number>`version + 1`,
            updatedAt: new Date(),
            updatedById: user.id,
          })
          .where('id', '=', existing.id)
          .where('version', '=', dto.expectedVersion)
          .returningAll()
          .executeTakeFirst();
        if (!updated) throw this.versionConflict();
        await this.replaceRelations(trx, existing.id, values, user.id);
        return updated;
      });
    } catch (error) {
      this.translateUniqueNameError(error);
      throw error;
    }
    this.metrics.observeProfileOutcome('updated');
    return this.toAdminProfile(row, config, this.db);
  }

  async remove(
    spaceId: string,
    profileId: string,
    user: User,
    workspace: Workspace,
  ): Promise<{ success: true }> {
    await this.assertCanManageSpace(user, spaceId);
    await this.db.transaction().execute(async (trx) => {
      const row = await this.getProfileRow(
        profileId,
        spaceId,
        workspace.id,
        trx,
        true,
        true,
      );
      if (row.deletedAt) return;
      const now = new Date();
      await trx
        .updateTable('aiAssistantProfiles')
        .set({
          enabled: false,
          deletedAt: now,
          version: sql<number>`version + 1`,
          updatedAt: now,
          updatedById: user.id,
        })
        .where('id', '=', row.id)
        .execute();
      await trx
        .updateTable('aiSpaceConfigs')
        .set({ defaultAssistantProfileId: null, updatedAt: now })
        .where('spaceId', '=', spaceId)
        .where('workspaceId', '=', workspace.id)
        .where('defaultAssistantProfileId', '=', row.id)
        .execute();
      await trx
        .updateTable('aiAssistantProfileUserPreferences')
        .set({
          preferredProfileId: null,
          hiddenProfileIds: sql<string[]>`array_remove(hidden_profile_ids, ${row.id}::uuid)`,
          updatedAt: now,
        })
        .where('spaceId', '=', spaceId)
        .where('workspaceId', '=', workspace.id)
        .where((eb) =>
          eb.or([
            eb('preferredProfileId', '=', row.id),
            sql<boolean>`${row.id}::uuid = any(hidden_profile_ids)`,
          ]),
        )
        .execute();
    });
    this.metrics.observeProfileOutcome('deleted');
    return { success: true };
  }

  async getPreferences(
    spaceId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfilePreferences> {
    await this.assertCanUseSpace(user, spaceId);
    return this.readPreferences(spaceId, user.id, workspace.id);
  }

  async updatePreferences(
    spaceId: string,
    dto: UpdateAiAssistantProfilePreferencesDto,
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfilePreferences> {
    await this.assertCanUseSpace(user, spaceId);
    if (
      dto.preferredProfileId &&
      dto.hiddenProfileIds.includes(dto.preferredProfileId)
    ) {
      throw new BadRequestException(
        'The preferred assistant profile cannot also be hidden',
      );
    }
    const ids = [
      ...new Set(
        [dto.preferredProfileId, ...dto.hiddenProfileIds].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    if (ids.length > 0) {
      const rows = await this.db
        .selectFrom('aiAssistantProfiles')
        .select(['id', 'enabled'])
        .where('id', 'in', ids)
        .where('workspaceId', '=', workspace.id)
        .where('spaceId', '=', spaceId)
        .where('deletedAt', 'is', null)
        .execute();
      if (rows.length !== ids.length) {
        throw new NotFoundException('Assistant profile not found');
      }
      if (
        dto.preferredProfileId &&
        !rows.find(
          (row) => row.id === dto.preferredProfileId && row.enabled,
        )
      ) {
        throw new BadRequestException({
          code: 'ai_profile_disabled',
          message: 'The preferred assistant profile is disabled',
        });
      }
      if (
        dto.preferredProfileId &&
        !(await this.isGroupAllowed(
          dto.preferredProfileId,
          user.id,
          this.db,
        ))
      ) {
        throw new ForbiddenException({
          code: 'ai_profile_not_allowed',
          message: 'The assistant profile is not available to this user',
        });
      }
    }
    const now = new Date();
    await this.db
      .insertInto('aiAssistantProfileUserPreferences')
      .values({
        workspaceId: workspace.id,
        spaceId,
        userId: user.id,
        preferredProfileId: dto.preferredProfileId,
        hiddenProfileIds: dto.hiddenProfileIds,
        createdAt: now,
        updatedAt: now,
      })
      .onConflict((oc) =>
        oc.columns(['spaceId', 'userId']).doUpdateSet({
          preferredProfileId: dto.preferredProfileId,
          hiddenProfileIds: dto.hiddenProfileIds,
          updatedAt: now,
        }),
      )
      .execute();
    return this.getPreferences(spaceId, user, workspace);
  }

  async resolveConversationSnapshot(
    db: Db,
    params: {
      workspaceId: string;
      spaceId: string;
      userId: string;
      assistantProfileId?: string | null;
    },
  ): Promise<{
    snapshot: AiAssistantProfileSnapshot;
    fingerprint: string;
  }> {
    const config = await db
      .selectFrom('aiSpaceConfigs')
      .selectAll()
      .where('spaceId', '=', params.spaceId)
      .where('workspaceId', '=', params.workspaceId)
      .forUpdate()
      .executeTakeFirst();
    let selected = params.assistantProfileId;
    if (selected === undefined) {
      const preferences = await this.readPreferences(
        params.spaceId,
        params.userId,
        params.workspaceId,
        db,
      );
      const candidates = [
        preferences.preferredProfileId,
        config?.defaultAssistantProfileId ?? null,
      ].filter((id): id is string => Boolean(id));
      selected = null;
      for (const candidate of [...new Set(candidates)]) {
        if (
          await this.canSelectProfile(
            candidate,
            params.spaceId,
            params.workspaceId,
            params.userId,
            db,
          )
        ) {
          selected = candidate;
          break;
        }
      }
    }

    if (!selected) {
      const snapshot = this.buildLegacySnapshot(config);
      return { snapshot, fingerprint: fingerprint(snapshot) };
    }

    await this.assertProfilesEnabled(params.workspaceId, db);
    const row = await this.getProfileRow(
      selected,
      params.spaceId,
      params.workspaceId,
      db,
    );
    if (!row.enabled) {
      throw new BadRequestException({
        code: 'ai_profile_disabled',
        message: 'The assistant profile is disabled',
      });
    }
    if (!(await this.isGroupAllowed(row.id, params.userId, db))) {
      throw new ForbiddenException({
        code: 'ai_profile_not_allowed',
        message: 'The assistant profile is not available to this user',
      });
    }
    if (!config) {
      throw new BadRequestException(
        'Configure the space AI provider before selecting a profile',
      );
    }
    const snapshot = await this.buildProfileSnapshot(row, config, db);
    this.metrics.observeProfileOutcome('selected');
    return { snapshot, fingerprint: fingerprint(snapshot) };
  }

  readSnapshot(
    value: unknown,
    expectedFingerprint?: string | null,
  ): AiAssistantProfileSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    const snapshot = value as AiAssistantProfileSnapshot;
    if (
      snapshot.schemaVersion !== 1 ||
      !['assistant_profile', 'legacy_space'].includes(snapshot.source) ||
      (!Array.isArray(snapshot.quickCommands) && snapshot.quickCommands !== null)
    ) {
      return null;
    }
    if (
      expectedFingerprint &&
      expectedFingerprint !== fingerprint(snapshot)
    ) {
      return null;
    }
    return snapshot;
  }

  snapshotFingerprint(snapshot: AiAssistantProfileSnapshot): string {
    return fingerprint(snapshot);
  }

  async snapshotAvailability(
    snapshot: AiAssistantProfileSnapshot,
    userId: string,
    workspaceId: string,
    db: Db = this.db,
  ): Promise<AiAssistantProfileAvailability> {
    if (snapshot.source === 'legacy_space' || !snapshot.profileId) {
      return 'available';
    }
    if (!this.environment.isAiAssistantProfilesEnabled()) {
      return 'policy_disabled';
    }
    const settings = await this.readWorkspaceSettings(workspaceId, db);
    if (!settings.enabled) return 'policy_disabled';
    const row = await db
      .selectFrom('aiAssistantProfiles')
      .select(['enabled', 'deletedAt'])
      .where('id', '=', snapshot.profileId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    if (!row || row.deletedAt) return 'deleted';
    if (!row.enabled) return 'disabled';
    return (await this.isGroupAllowed(snapshot.profileId, userId, db))
      ? 'available'
      : 'not_allowed';
  }

  toConversationSummary(
    snapshot: AiAssistantProfileSnapshot,
    availability: AiAssistantProfileAvailability,
  ): AiAssistantProfileConversationSummary {
    return {
      source: snapshot.source,
      id: snapshot.profileId,
      version: snapshot.profileVersion,
      name: snapshot.display?.name ?? null,
      description: snapshot.display?.description ?? null,
      icon: snapshot.display?.icon ?? null,
      quickCommands: snapshot.quickCommands,
      availability,
    };
  }

  async assertSnapshotLive(
    snapshot: AiAssistantProfileSnapshot,
    userId: string,
    db: Db = this.db,
  ): Promise<void> {
    if (snapshot.source === 'legacy_space' || !snapshot.profileId) return;
    await this.assertProfilesEnabledForRun(snapshot, db);
    const row = await this.getProfileRow(
      snapshot.profileId,
      undefined,
      undefined,
      db,
      true,
    );
    if (row.deletedAt || !row.enabled) {
      throw this.profileRunError(
        'ai_profile_disabled',
        'The assistant profile is disabled',
      );
    }
    if (!(await this.isGroupAllowed(row.id, userId, db))) {
      throw this.profileRunError(
        'ai_profile_not_allowed',
        'The assistant profile is not available to this user',
      );
    }
    const currentCapabilities = new Set(
      this.readCapabilities(row.allowedBuiltinCapabilities),
    );
    if (
      (snapshot.allowedBuiltinCapabilities ?? []).some(
        (capability) => !currentCapabilities.has(capability),
      )
    ) {
      throw this.profileRunError(
        'agent_profile_policy_changed',
        'The assistant profile tool policy was narrowed',
      );
    }
    const currentExternal = new Set(
      (await this.loadExternalSelections(row.id, db)).map(
        (tool) => `${tool.bindingId}:${tool.toolName}`,
      ),
    );
    if (
      (snapshot.allowedExternalTools ?? []).some(
        (tool) => !currentExternal.has(`${tool.bindingId}:${tool.toolName}`),
      )
    ) {
      throw this.profileRunError(
        'agent_profile_policy_changed',
        'The assistant profile external tool policy was narrowed',
      );
    }
  }

  async resolveRunToolPolicy(
    snapshot: AiAssistantProfileSnapshot,
    userId: string,
    db: Db,
  ): Promise<{
    maximumBuiltinCapabilities?: AiBuiltinToolCapability[];
    profileKey?: string;
    externalTools?: AiAssistantProfileExternalTool[];
  }> {
    if (snapshot.source === 'legacy_space' || !snapshot.profileId) return {};
    await this.assertSnapshotLive(snapshot, userId, db);
    let capabilities = [...(snapshot.allowedBuiltinCapabilities ?? [])];
    const applicable = await this.applicableGroupPolicies(
      snapshot.profileId,
      userId,
      db,
    );
    for (const policy of applicable) {
      const allowed = this.readCapabilities(policy.allowedBuiltinCapabilities);
      if (policy.allowedBuiltinCapabilities !== null) {
        const set = new Set(allowed);
        capabilities = capabilities.filter((capability) =>
          set.has(capability),
        );
      }
    }
    return {
      maximumBuiltinCapabilities: capabilities,
      profileKey: snapshot.profileId,
      externalTools: snapshot.allowedExternalTools ?? [],
    };
  }

  async assertRunProfileCurrent(run: AiRun): Promise<void> {
    const snapshot = this.readSnapshot(
      run.assistantProfileSnapshot,
      run.assistantProfileFingerprint,
    );
    if (!snapshot) {
      if (run.assistantProfileSnapshot) {
        throw this.profileRunError(
          'agent_profile_policy_changed',
          'The assistant profile snapshot failed its integrity check',
        );
      }
      return;
    }
    await this.assertSnapshotLive(snapshot, run.userId);
    if (snapshot.source !== 'assistant_profile') return;
    const current = await this.resolveRunToolPolicy(
      snapshot,
      run.userId,
      this.db,
    );
    const allowed = new Set(current.maximumBuiltinCapabilities ?? []);
    const runSnapshot = run.builtinToolPolicySnapshot as
      | { capabilities?: unknown }
      | null;
    const runCapabilities = Array.isArray(runSnapshot?.capabilities)
      ? (runSnapshot.capabilities as string[])
      : [];
    if (runCapabilities.some((capability) => !allowed.has(capability as never))) {
      throw this.profileRunError(
        'agent_profile_policy_changed',
        'A group or profile policy revoked a built-in tool',
      );
    }
    const frozenMcpSnapshot = run.mcpPolicySnapshot as
      | AiMcpRunSnapshot
      | null;
    if (frozenMcpSnapshot) {
      if (
        !run.mcpPolicyFingerprint ||
        run.mcpPolicyFingerprint !==
          this.mcpPolicy.fingerprintSnapshot(frozenMcpSnapshot)
      ) {
        throw this.profileRunError(
          'agent_profile_policy_changed',
          'The external MCP policy snapshot failed its integrity check',
        );
      }
      const currentMcpSnapshot = await this.mcpPolicy.buildRunSnapshot(this.db, {
        workspaceId: run.workspaceId,
        spaceId: run.spaceId,
        userId: run.userId,
        executionMode: run.executionMode,
        profileKey: snapshot.profileId!,
        profileAllowedTools: snapshot.allowedExternalTools ?? [],
      });
      this.assertFrozenExternalPolicyCurrent(
        frozenMcpSnapshot,
        currentMcpSnapshot,
      );
    }
  }

  private assertFrozenExternalPolicyCurrent(
    frozen: AiMcpRunSnapshot,
    current: AiMcpRunSnapshot | null,
  ): void {
    const currentConnections = new Map(
      (current?.connections ?? []).map((connection) => [
        connection.bindingId,
        connection,
      ]),
    );
    for (const connection of frozen.connections) {
      const live = currentConnections.get(connection.bindingId);
      if (
        !live ||
        live.serverId !== connection.serverId ||
        live.namespace !== connection.namespace ||
        live.configVersion !== connection.configVersion
      ) {
        throw this.profileRunError(
          'agent_profile_policy_changed',
          'External MCP access or configuration changed during the run',
        );
      }
      const liveTools = new Map(live.tools.map((tool) => [tool.name, tool]));
      for (const tool of connection.tools) {
        const liveTool = liveTools.get(tool.name);
        if (
          !liveTool ||
          liveTool.remoteName !== tool.remoteName ||
          liveTool.schemaFingerprint !== tool.schemaFingerprint
        ) {
          throw this.profileRunError(
            'agent_profile_policy_changed',
            'An external MCP tool was revoked or changed during the run',
          );
        }
      }
    }
  }

  buildProviderSnapshot(
    config: AiSpaceConfig,
    snapshot: AiAssistantProfileSnapshot,
  ): AiAssistantProfileProviderSnapshot {
    const maxOutputTokens = Math.min(
      config.maxOutputTokens,
      snapshot.maxOutputTokensOverride ?? config.maxOutputTokens,
    );
    return {
      schemaVersion: 1,
      providerProtocolVersion: 'openai-compatible:v1',
      normalizedBaseUrl: config.baseUrl.replace(/\/+$/, ''),
      chatModel: snapshot.chatModelOverride ?? config.chatModel,
      temperature: snapshot.temperatureOverride ?? config.temperature,
      maxOutputTokens,
      contextWindow: config.contextWindow,
      requestTimeoutMs: config.requestTimeoutMs,
      visionEnabled: config.visionEnabled,
      reasoningEnabled: config.reasoningEnabled,
    };
  }

  providerSnapshotFingerprint(
    snapshot: AiAssistantProfileProviderSnapshot,
  ): string {
    return fingerprint(snapshot);
  }

  effectiveProviderFingerprint(
    snapshot: AiAssistantProfileProviderSnapshot,
  ): string {
    return fingerprint({
      providerProtocolVersion: snapshot.providerProtocolVersion,
      normalizedBaseUrl: snapshot.normalizedBaseUrl,
      chatModel: snapshot.chatModel,
    });
  }

  providerSnapshotForRun(
    run: AiRun,
    config: AiSpaceConfig,
  ): AiAssistantProfileProviderSnapshot | null {
    const value = run.providerConfigSnapshot;
    if (!value || typeof value !== 'object') return null;
    const snapshot = value as unknown as AiAssistantProfileProviderSnapshot;
    if (
      snapshot.schemaVersion !== 1 ||
      run.providerConfigFingerprint !== this.providerSnapshotFingerprint(snapshot)
    ) {
      throw this.profileRunError(
        'agent_provider_config_changed',
        'The provider snapshot failed its integrity check',
      );
    }
    if (
      snapshot.normalizedBaseUrl !== config.baseUrl.replace(/\/+$/, '') ||
      snapshot.providerProtocolVersion !== 'openai-compatible:v1'
    ) {
      throw this.profileRunError(
        'agent_provider_config_changed',
        'The provider origin changed after this run was created',
      );
    }
    return snapshot;
  }

  providerConfigForRun(run: AiRun, config: AiSpaceConfig): AiProviderConfig {
    const current = this.configs.toProviderConfig(config);
    const snapshot = this.providerSnapshotForRun(run, config);
    if (!snapshot) return current;
    return {
      ...current,
      baseUrl: snapshot.normalizedBaseUrl,
      chatModel: snapshot.chatModel,
      temperature: snapshot.temperature,
      maxOutputTokens: snapshot.maxOutputTokens,
      requestTimeoutMs: snapshot.requestTimeoutMs,
    };
  }

  assertProviderSnapshotCurrent(run: AiRun, config: AiSpaceConfig): void {
    this.providerSnapshotForRun(run, config);
  }

  async assertProfileAgentAvailable(
    snapshot: AiAssistantProfileSnapshot,
    config: AiSpaceConfig,
    userId: string,
    db: Db = this.db,
  ): Promise<void> {
    if (snapshot.source !== 'assistant_profile') return;
    if (!config.agentEnabled) {
      throw this.profileRunError(
        'agent_profile_unverified',
        'Agent mode is disabled for this space',
      );
    }
    await this.assertSnapshotLive(snapshot, userId, db);
    const status = await this.verificationStatus(snapshot, config, db);
    if (!status.verified) {
      throw this.profileRunError(
        status.reason === 'policy_changed'
          ? 'agent_profile_policy_changed'
          : 'agent_profile_unverified',
        status.reason === 'no_tools'
          ? 'The assistant profile has no available Agent tools'
          : 'The assistant profile has not passed the exact Agent verification',
      );
    }
    const policy = await this.resolveRunToolPolicy(snapshot, userId, db);
    const [builtinSnapshot, mcpSnapshot] = await Promise.all([
      this.builtinTools.buildRunSnapshot(db, {
        workspaceId: config.workspaceId,
        spaceId: config.spaceId,
        executionMode: 'agent',
        maximumCapabilities: policy.maximumBuiltinCapabilities,
      }),
      this.mcpPolicy.buildRunSnapshot(db, {
        workspaceId: config.workspaceId,
        spaceId: config.spaceId,
        userId,
        executionMode: 'agent',
        profileKey: policy.profileKey,
        profileAllowedTools: policy.externalTools,
      }),
    ]);
    if (
      (builtinSnapshot?.capabilities.length ?? 0) === 0 &&
      (mcpSnapshot?.connections.length ?? 0) === 0
    ) {
      throw this.profileRunError(
        'agent_profile_unverified',
        'The assistant profile has no available Agent tools for this user',
      );
    }
  }

  async testModel(
    spaceId: string,
    profileId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiModelTestResult> {
    await this.assertCanManageSpace(user, spaceId);
    const [row, config] = await Promise.all([
      this.getProfileRow(profileId, spaceId, workspace.id, this.db),
      this.requireConfig(spaceId, workspace.id),
    ]);
    const snapshot = await this.buildProfileSnapshot(row, config, this.db);
    const providerSnapshot = this.buildProviderSnapshot(config, snapshot);
    const providerConfig = this.providerConfigFromSnapshot(
      config,
      providerSnapshot,
    );
    const startedAt = Date.now();
    let models: string[] = [];
    let modelsAvailable = true;
    try {
      models = await this.provider.listModels(providerConfig);
    } catch {
      modelsAvailable = false;
    }
    const completion = await this.provider.complete(
      { ...providerConfig, maxOutputTokens: Math.min(512, providerConfig.maxOutputTokens) },
      [{ role: 'user', content: 'Reply with OK.' }],
    );
    this.metrics.observeProfileOutcome('test_model_ok');
    return {
      ok: Boolean(completion.content),
      models,
      modelsAvailable,
      chatModelAvailable:
        !modelsAvailable ||
        models.length === 0 ||
        models.includes(providerConfig.chatModel),
      vision: false,
      latencyMs: Date.now() - startedAt,
    };
  }

  async testAgent(
    spaceId: string,
    profileId: string,
    user: User,
    workspace: Workspace,
  ): Promise<AiAssistantProfileTestResult> {
    await this.assertCanManageSpace(user, spaceId);
    const [row, config] = await Promise.all([
      this.getProfileRow(profileId, spaceId, workspace.id, this.db),
      this.requireConfig(spaceId, workspace.id),
    ]);
    const snapshot = await this.buildProfileSnapshot(row, config, this.db);
    const parts = await this.verificationParts(snapshot, config, this.db);
    if (
      parts.effectiveBuiltinCapabilities.length === 0 &&
      parts.externalToolCount === 0
    ) {
      throw new BadRequestException({
        code: 'agent_profile_unverified',
        message: 'The assistant profile has no Agent tools to verify',
      });
    }
    const providerSnapshot = this.buildProviderSnapshot(config, snapshot);
    const providerConfig = this.providerConfigFromSnapshot(
      config,
      providerSnapshot,
    );
    const startedAt = Date.now();
    const toolName = 'capabilityProbe';
    const completion = await this.provider.completeWithTools(
      { ...providerConfig, maxOutputTokens: Math.min(256, providerConfig.maxOutputTokens) },
      [
        {
          role: 'user',
          content:
            'Call the capabilityProbe tool with {"value":"ok"}. Do not answer with text.',
        },
      ],
      [
        {
          type: 'function',
          function: {
            name: toolName,
            description: 'Tests whether the model can call a function.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['value'],
              properties: { value: { type: 'string', enum: ['ok'] } },
            },
          },
        },
      ],
      { type: 'function', function: { name: toolName } },
    );
    const call = completion.toolCalls[0];
    let argumentsValue: unknown = null;
    try {
      argumentsValue = call ? JSON.parse(call.function.arguments) : null;
    } catch {
      argumentsValue = null;
    }
    if (
      completion.toolCalls.length !== 1 ||
      call?.function.name !== toolName ||
      !argumentsValue ||
      typeof argumentsValue !== 'object' ||
      (argumentsValue as Record<string, unknown>).value !== 'ok'
    ) {
      this.metrics.observeProfileOutcome('test_agent_failed');
      throw new BadRequestException(
        'The provider did not complete the required tool call',
      );
    }
    const testedAt = new Date();
    await this.db
      .insertInto('aiAgentToolVerifications')
      .values({
        workspaceId: workspace.id,
        spaceId,
        profileId: row.id,
        profileVersion: row.version,
        providerFingerprint: parts.providerFingerprint,
        toolSchemaFingerprint: parts.toolSchemaFingerprint,
        toolPolicyFingerprint: parts.toolPolicyFingerprint,
        verificationFingerprint: parts.verificationFingerprint,
        probeToolName: toolName,
        testedAt,
        testedById: user.id,
      })
      .onConflict((oc) =>
        oc.columns(['profileId', 'verificationFingerprint']).doNothing(),
      )
      .execute();
    this.metrics.observeProfileOutcome('test_agent_ok');
    return {
      ok: true,
      toolName,
      latencyMs: Date.now() - startedAt,
      verification: {
        verified: true,
        reason: 'available',
        verificationFingerprint: parts.verificationFingerprint,
        providerFingerprint: parts.providerFingerprint,
        toolSchemaFingerprint: parts.toolSchemaFingerprint,
        toolPolicyFingerprint: parts.toolPolicyFingerprint,
        verifiedAt: testedAt.toISOString(),
      },
    };
  }

  private async normalizeValues(
    dto: CreateAiAssistantProfileDto | UpdateAiAssistantProfileDto,
    existing:
      | {
          row: AiAssistantProfileEntity;
          externalTools: Array<{ bindingId: string; toolName: string }>;
          groupPolicies: AiAssistantProfileGroupPolicy[];
        }
      | undefined,
    config: AiSpaceConfig,
    settings: {
      enabled: boolean;
      modelOverridesEnabled: boolean;
      policyVersion: number;
      updatedAt: Date | null;
    },
    spaceId: string,
    workspaceId: string,
    db: Db,
  ): Promise<NormalizedProfileValues> {
    const row = existing?.row;
    const name = (dto.name ?? row?.name ?? '').trim();
    const description =
      dto.description !== undefined
        ? dto.description?.trim() || null
        : (row?.description ?? null);
    const icon = dto.icon ?? (row?.icon as never);
    const instructions = (dto.instructions ?? row?.instructions ?? '').trim();
    const quickCommands =
      dto.quickCommands !== undefined
        ? this.normalizeQuickCommands(dto.quickCommands)
        : this.readQuickCommands(row?.quickCommands);
    const chatModelOverride =
      dto.chatModelOverride !== undefined
        ? dto.chatModelOverride?.trim() || null
        : (row?.chatModelOverride ?? null);
    const temperatureOverride =
      dto.temperatureOverride !== undefined
        ? dto.temperatureOverride
        : (row?.temperatureOverride ?? null);
    const maxOutputTokensOverride =
      dto.maxOutputTokensOverride !== undefined
        ? dto.maxOutputTokensOverride
        : (row?.maxOutputTokensOverride ?? null);
    const allowedBuiltinCapabilities =
      dto.allowedBuiltinCapabilities !== undefined
        ? [...new Set(dto.allowedBuiltinCapabilities)]
        : this.readCapabilities(row?.allowedBuiltinCapabilities);
    const allowedExternalTools =
      dto.allowedExternalTools !== undefined
        ? dto.allowedExternalTools.map(({ bindingId, toolName }) => ({
            bindingId,
            toolName,
          }))
        : (existing?.externalTools ?? []);
    const groupPolicies =
      dto.groupPolicies !== undefined
        ? dto.groupPolicies.map((policy) => ({
            groupId: policy.groupId,
            available: policy.available,
            allowedBuiltinCapabilities:
              policy.allowedBuiltinCapabilities === null
                ? null
                : [...new Set(policy.allowedBuiltinCapabilities)],
          }))
        : (existing?.groupPolicies ?? []);
    const autoStart = dto.autoStart ?? row?.autoStart ?? false;
    const launchMessage =
      dto.launchMessage !== undefined
        ? dto.launchMessage?.trim() || null
        : (row?.launchMessage ?? null);
    const enabled = dto.enabled ?? row?.enabled ?? false;

    if (!name || !instructions || !AI_ASSISTANT_PROFILE_ICONS.includes(icon)) {
      throw new BadRequestException('Invalid assistant profile fields');
    }
    if (autoStart && !launchMessage) {
      throw new BadRequestException(
        'launchMessage is required when autoStart is enabled',
      );
    }
    const introducesProviderOverride =
      (dto.chatModelOverride !== undefined &&
        chatModelOverride !== null &&
        chatModelOverride !== (row?.chatModelOverride ?? null)) ||
      (dto.temperatureOverride !== undefined &&
        temperatureOverride !== null &&
        temperatureOverride !== (row?.temperatureOverride ?? null)) ||
      (dto.maxOutputTokensOverride !== undefined &&
        maxOutputTokensOverride !== null &&
        maxOutputTokensOverride !== (row?.maxOutputTokensOverride ?? null));
    if (!settings.modelOverridesEnabled && introducesProviderOverride) {
      throw new BadRequestException(
        'Assistant profile provider overrides are disabled for this workspace',
      );
    }
    if (
      maxOutputTokensOverride !== null &&
      maxOutputTokensOverride > config.maxOutputTokens
    ) {
      throw new BadRequestException(
        'maxOutputTokensOverride cannot exceed the space limit',
      );
    }

    const maximum = new Set(
      await this.builtinTools.getEffectiveCapabilities(
        workspaceId,
        spaceId,
        'agent',
      ),
    );
    if (
      allowedBuiltinCapabilities.some(
        (capability) => !maximum.has(capability),
      )
    ) {
      throw new BadRequestException(
        'An assistant profile can only narrow the space tool policy',
      );
    }
    const profileCapabilities = new Set(allowedBuiltinCapabilities);
    if (
      groupPolicies.some((policy) =>
        (policy.allowedBuiltinCapabilities ?? []).some(
          (capability) => !profileCapabilities.has(capability),
        ),
      )
    ) {
      throw new BadRequestException(
        'A group can only narrow the assistant profile tool policy',
      );
    }
    await Promise.all([
      this.validateExternalTools(
        allowedExternalTools,
        spaceId,
        workspaceId,
        db,
      ),
      this.validateGroups(groupPolicies, workspaceId, db),
    ]);
    return {
      name,
      description,
      icon,
      instructions,
      quickCommands,
      chatModelOverride,
      temperatureOverride,
      maxOutputTokensOverride,
      allowedBuiltinCapabilities,
      allowedExternalTools,
      groupPolicies,
      autoStart,
      launchMessage,
      enabled,
    };
  }

  private async replaceRelations(
    trx: KyselyTransaction,
    profileId: string,
    values: NormalizedProfileValues,
    userId: string,
  ): Promise<void> {
    await Promise.all([
      trx
        .deleteFrom('aiAssistantProfileMcpTools')
        .where('profileId', '=', profileId)
        .execute(),
      trx
        .deleteFrom('aiAssistantProfileGroupPolicies')
        .where('profileId', '=', profileId)
        .execute(),
    ]);
    if (values.allowedExternalTools.length > 0) {
      await trx
        .insertInto('aiAssistantProfileMcpTools')
        .values(
          values.allowedExternalTools.map((tool) => ({
            profileId,
            bindingId: tool.bindingId,
            toolName: tool.toolName,
          })),
        )
        .execute();
    }
    if (values.groupPolicies.length > 0) {
      await trx
        .insertInto('aiAssistantProfileGroupPolicies')
        .values(
          values.groupPolicies.map((policy) => ({
            profileId,
            groupId: policy.groupId,
            available: policy.available,
            allowedBuiltinCapabilities:
              policy.allowedBuiltinCapabilities === null
                ? null
                : (postgresJsonb(policy.allowedBuiltinCapabilities) as never),
            createdById: userId,
          })),
        )
        .execute();
    }
  }

  private async buildProfileSnapshot(
    row: AiAssistantProfileEntity,
    config: AiSpaceConfig,
    db: Db,
  ): Promise<AiAssistantProfileSnapshot> {
    const allowedBuiltinCapabilities = this.readCapabilities(
      row.allowedBuiltinCapabilities,
    );
    const [allowedExternalTools, builtinSnapshot, settings] = await Promise.all([
      this.loadExternalSelections(row.id, db),
      this.builtinTools.buildRunSnapshot(db, {
        workspaceId: row.workspaceId,
        spaceId: row.spaceId,
        executionMode: 'agent',
        maximumCapabilities: allowedBuiltinCapabilities,
      }),
      this.readWorkspaceSettings(row.workspaceId, db),
    ]);
    const toolPolicyFingerprint = fingerprint({
      workspacePolicyVersion: builtinSnapshot?.workspacePolicyVersion ?? 0,
      spacePolicyVersion: builtinSnapshot?.spacePolicyVersion ?? 0,
      allowedBuiltinCapabilities: [...allowedBuiltinCapabilities].sort(),
      allowedExternalTools: allowedExternalTools
        .map(({ bindingId, toolName }) => ({ bindingId, toolName }))
        .sort((left, right) =>
          `${left.bindingId}:${left.toolName}`.localeCompare(
            `${right.bindingId}:${right.toolName}`,
          ),
        ),
    });
    return {
      schemaVersion: 1,
      source: 'assistant_profile',
      profileId: row.id,
      profileVersion: row.version,
      display: {
        name: row.name,
        description: row.description,
        icon: row.icon as AiAssistantProfileSummary['icon'],
      },
      instructions: row.instructions,
      quickCommands:
        row.quickCommands === null
          ? this.readQuickCommands(config.quickCommands)
          : this.readQuickCommands(row.quickCommands),
      chatModelOverride: settings.modelOverridesEnabled
        ? row.chatModelOverride
        : null,
      temperatureOverride: settings.modelOverridesEnabled
        ? row.temperatureOverride
        : null,
      maxOutputTokensOverride: settings.modelOverridesEnabled
        ? row.maxOutputTokensOverride
        : null,
      allowedBuiltinCapabilities,
      allowedExternalTools,
      autoStart: row.autoStart,
      launchMessage: row.launchMessage,
      toolPolicyFingerprint,
    };
  }

  private buildLegacySnapshot(
    config: AiSpaceConfig | undefined,
  ): AiAssistantProfileSnapshot {
    return {
      schemaVersion: 1,
      source: 'legacy_space',
      profileId: null,
      profileVersion: null,
      display: null,
      instructions: config?.systemInstructions ?? null,
      quickCommands: this.readQuickCommands(config?.quickCommands),
      chatModelOverride: null,
      temperatureOverride: null,
      maxOutputTokensOverride: null,
      allowedBuiltinCapabilities: null,
      allowedExternalTools: null,
      autoStart: false,
      launchMessage: null,
      toolPolicyFingerprint: fingerprint({ source: 'legacy_space' }),
    };
  }

  private async verificationStatus(
    snapshot: AiAssistantProfileSnapshot,
    config: AiSpaceConfig,
    db: Db,
  ): Promise<AiAssistantProfileVerificationStatus> {
    const parts = await this.verificationParts(snapshot, config, db);
    if (!config.agentEnabled) {
      return this.verificationView(parts, false, 'agent_disabled', null);
    }
    if (
      parts.effectiveBuiltinCapabilities.length === 0 &&
      parts.externalToolCount === 0
    ) {
      return this.verificationView(parts, false, 'no_tools', null);
    }
    const row = await db
      .selectFrom('aiAgentToolVerifications')
      .select('testedAt')
      .where('profileId', '=', snapshot.profileId!)
      .where('verificationFingerprint', '=', parts.verificationFingerprint)
      .orderBy('testedAt', 'desc')
      .executeTakeFirst();
    return this.verificationView(
      parts,
      Boolean(row),
      row ? 'available' : 'unverified',
      row?.testedAt ?? null,
    );
  }

  private async verificationParts(
    snapshot: AiAssistantProfileSnapshot,
    config: AiSpaceConfig,
    db: Db,
  ): Promise<VerificationParts> {
    const providerSnapshot = this.buildProviderSnapshot(config, snapshot);
    const providerFingerprint = this.effectiveProviderFingerprint(
      providerSnapshot,
    );
    const builtinSnapshot = await this.builtinTools.buildRunSnapshot(db, {
      workspaceId: config.workspaceId,
      spaceId: config.spaceId,
      executionMode: 'agent',
      maximumCapabilities: snapshot.allowedBuiltinCapabilities ?? undefined,
    });
    const effectiveBuiltinCapabilities =
      builtinSnapshot?.capabilities ?? [];
    const externalPolicyFingerprint =
      await this.mcpPolicy.maximumProfilePolicyFingerprint(db, {
        workspaceId: config.workspaceId,
        spaceId: config.spaceId,
        tools: snapshot.allowedExternalTools ?? [],
      });
    const frozenExternalKeys = new Set(
      (snapshot.allowedExternalTools ?? []).map(
        (tool) => `${tool.bindingId}:${tool.toolName}`,
      ),
    );
    const effectiveExternalTools = snapshot.profileId
      ? (await this.loadExternalSelections(snapshot.profileId, db)).filter(
          (tool) =>
            frozenExternalKeys.has(`${tool.bindingId}:${tool.toolName}`),
        )
      : [];
    const toolSchemaFingerprint = fingerprint({
      builtin: this.builtinTools.toolSchemaFingerprint(
        effectiveBuiltinCapabilities,
      ),
      external: effectiveExternalTools
        .map((tool) => ({
          bindingId: tool.bindingId,
          toolName: tool.toolName,
          schemaFingerprint: tool.schemaFingerprint ?? null,
        }))
        .sort((left, right) =>
          `${left.bindingId}:${left.toolName}`.localeCompare(
            `${right.bindingId}:${right.toolName}`,
          ),
        ),
    });
    const toolPolicyFingerprint = fingerprint({
      profilePolicyFingerprint: snapshot.toolPolicyFingerprint,
      builtinWorkspacePolicyVersion:
        builtinSnapshot?.workspacePolicyVersion ?? 0,
      builtinSpacePolicyVersion: builtinSnapshot?.spacePolicyVersion ?? 0,
      externalPolicyFingerprint,
    });
    const verificationFingerprint = fingerprint({
      providerFingerprint,
      toolSchemaFingerprint,
      toolPolicyFingerprint,
    });
    return {
      providerFingerprint,
      toolSchemaFingerprint,
      toolPolicyFingerprint,
      verificationFingerprint,
      effectiveBuiltinCapabilities,
      externalToolCount: effectiveExternalTools.filter(
        (tool) => Boolean(tool.schemaFingerprint),
      ).length,
    };
  }

  private verificationView(
    parts: VerificationParts,
    verified: boolean,
    reason: AiAssistantProfileVerificationStatus['reason'],
    verifiedAt: Date | null,
  ): AiAssistantProfileVerificationStatus {
    return {
      verified,
      reason,
      verificationFingerprint: parts.verificationFingerprint,
      providerFingerprint: parts.providerFingerprint,
      toolSchemaFingerprint: parts.toolSchemaFingerprint,
      toolPolicyFingerprint: parts.toolPolicyFingerprint,
      verifiedAt: verifiedAt?.toISOString() ?? null,
    };
  }

  private async toSummary(
    row: AiAssistantProfileEntity,
    config: AiSpaceConfig | undefined,
    availability: AiAssistantProfileAvailability,
    db: Db,
    userId?: string,
  ): Promise<AiAssistantProfileSummary> {
    const snapshot = config
      ? await this.buildProfileSnapshot(row, config, db)
      : null;
    const verification =
      snapshot && config
        ? await this.verificationStatus(snapshot, config, db)
        : null;
    let agent: AiAssistantProfileAgentStatus = verification
      ? {
          available:
            availability === 'available' && verification.verified,
          reason:
            availability === 'available'
              ? verification.reason
              : 'policy_changed',
          verifiedAt: verification.verifiedAt,
        }
      : {
          available: false,
          reason: 'agent_disabled',
          verifiedAt: null,
        };
    if (agent.available && snapshot && config && userId) {
      const policy = await this.resolveRunToolPolicy(snapshot, userId, db);
      const [builtinSnapshot, mcpSnapshot] = await Promise.all([
        this.builtinTools.buildRunSnapshot(db, {
          workspaceId: config.workspaceId,
          spaceId: config.spaceId,
          executionMode: 'agent',
          maximumCapabilities: policy.maximumBuiltinCapabilities,
        }),
        this.mcpPolicy.buildRunSnapshot(db, {
          workspaceId: config.workspaceId,
          spaceId: config.spaceId,
          userId,
          executionMode: 'agent',
          profileKey: policy.profileKey,
          profileAllowedTools: policy.externalTools,
        }),
      ]);
      if (
        (builtinSnapshot?.capabilities.length ?? 0) === 0 &&
        (mcpSnapshot?.connections.length ?? 0) === 0
      ) {
        agent = {
          available: false,
          reason: 'no_tools',
          verifiedAt: verification?.verifiedAt ?? null,
        };
      }
    }
    return {
      id: row.id,
      spaceId: row.spaceId,
      name: row.name,
      description: row.description,
      icon: row.icon as AiAssistantProfileSummary['icon'],
      version: row.version,
      enabled: row.enabled,
      autoStart: row.autoStart,
      launchMessage: row.launchMessage,
      quickCommands: snapshot?.quickCommands ?? null,
      availability,
      agent,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async toAdminProfile(
    row: AiAssistantProfileEntity,
    config: AiSpaceConfig | undefined,
    db: Db,
  ): Promise<AiAssistantProfileContract> {
    const relations = await this.loadRelations(row.id, db);
    const summary = await this.toSummary(
      row,
      config,
      row.deletedAt ? 'deleted' : row.enabled ? 'available' : 'disabled',
      db,
    );
    return {
      ...summary,
      workspaceId: row.workspaceId,
      instructions: row.instructions,
      chatModelOverride: row.chatModelOverride,
      temperatureOverride: row.temperatureOverride,
      maxOutputTokensOverride: row.maxOutputTokensOverride,
      allowedBuiltinCapabilities: this.readCapabilities(
        row.allowedBuiltinCapabilities,
      ),
      allowedExternalTools: relations.externalTools,
      groupPolicies: relations.groupPolicies,
      createdById: row.createdById,
      updatedById: row.updatedById,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      quickCommands: this.readQuickCommands(row.quickCommands),
    };
  }

  private async loadRelations(profileId: string, db: Db) {
    const [externalTools, groupRows] = await Promise.all([
      db
        .selectFrom('aiAssistantProfileMcpTools')
        .select(['bindingId', 'toolName'])
        .where('profileId', '=', profileId)
        .orderBy('bindingId', 'asc')
        .orderBy('toolName', 'asc')
        .execute(),
      db
        .selectFrom('aiAssistantProfileGroupPolicies')
        .select(['groupId', 'available', 'allowedBuiltinCapabilities'])
        .where('profileId', '=', profileId)
        .orderBy('groupId', 'asc')
        .execute(),
    ]);
    return {
      externalTools,
      groupPolicies: groupRows.map((row) => ({
        groupId: row.groupId,
        available: row.available,
        allowedBuiltinCapabilities:
          row.allowedBuiltinCapabilities === null
            ? null
            : this.readCapabilities(row.allowedBuiltinCapabilities),
      })),
    };
  }

  private async loadExternalSelections(
    profileId: string,
    db: Db,
  ): Promise<AiAssistantProfileExternalTool[]> {
    const rows = await db
      .selectFrom('aiAssistantProfileMcpTools as pt')
      .innerJoin('aiMcpSpaceBindings as b', 'b.id', 'pt.bindingId')
      .innerJoin('aiMcpServers as s', 's.id', 'b.serverId')
      .select([
        'pt.bindingId',
        'pt.toolName',
        's.approvedTools',
      ])
      .where('pt.profileId', '=', profileId)
      .orderBy('pt.bindingId', 'asc')
      .orderBy('pt.toolName', 'asc')
      .execute();
    return rows.map((row) => {
      const approved = this.readApprovedExternalTools(row.approvedTools).find(
        (tool) => tool.toolName === row.toolName,
      );
      return {
        bindingId: row.bindingId,
        toolName: row.toolName,
        ...(approved?.schemaFingerprint
          ? { schemaFingerprint: approved.schemaFingerprint }
          : {}),
      };
    });
  }

  private async validateExternalTools(
    values: Array<{ bindingId: string; toolName: string }>,
    spaceId: string,
    workspaceId: string,
    db: Db,
  ): Promise<void> {
    const keys = values.map((item) => `${item.bindingId}:${item.toolName}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException(
        'Assistant profile external tools must be unique',
      );
    }
    if (values.length === 0) return;
    const bindingIds = [...new Set(values.map((item) => item.bindingId))];
    const bindings = await db
      .selectFrom('aiMcpSpaceBindings as b')
      .innerJoin('aiMcpServers as s', 's.id', 'b.serverId')
      .select(['b.id', 'b.allowedTools', 's.approvedTools'])
      .where('b.id', 'in', bindingIds)
      .where('b.workspaceId', '=', workspaceId)
      .where('b.spaceId', '=', spaceId)
      .execute();
    if (bindings.length !== bindingIds.length) {
      throw new NotFoundException('External MCP binding not found');
    }
    for (const selected of values) {
      const binding = bindings.find((row) => row.id === selected.bindingId)!;
      const approved = this.readApprovedExternalTools(binding.approvedTools);
      const spaceAllowed = this.readStringArray(binding.allowedTools);
      if (
        !approved.some((tool) => tool.toolName === selected.toolName) ||
        (spaceAllowed.length > 0 && !spaceAllowed.includes(selected.toolName))
      ) {
        throw new BadRequestException(
          'An assistant profile can only narrow approved space MCP tools',
        );
      }
    }
  }

  private async validateGroups(
    policies: AiAssistantProfileGroupPolicy[],
    workspaceId: string,
    db: Db,
  ): Promise<void> {
    const ids = policies.map((policy) => policy.groupId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Assistant profile group policies must be unique',
      );
    }
    if (ids.length === 0) return;
    const rows = await db
      .selectFrom('groups')
      .select('id')
      .where('id', 'in', ids)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
    if (rows.length !== ids.length) {
      throw new NotFoundException('Group not found');
    }
  }

  private async isGroupAllowed(
    profileId: string,
    userId: string,
    db: Db,
  ): Promise<boolean> {
    const [count, applicable] = await Promise.all([
      db
        .selectFrom('aiAssistantProfileGroupPolicies')
        .select(sql<number>`count(*)`.as('count'))
        .where('profileId', '=', profileId)
        .executeTakeFirstOrThrow(),
      this.applicableGroupPolicies(profileId, userId, db),
    ]);
    if (Number(count.count) === 0) return true;
    return applicable.length > 0 && applicable.every((row) => row.available);
  }

  private applicableGroupPolicies(
    profileId: string,
    userId: string,
    db: Db,
  ) {
    return db
      .selectFrom('aiAssistantProfileGroupPolicies as gp')
      .innerJoin('groupUsers as gu', 'gu.groupId', 'gp.groupId')
      .select(['gp.available', 'gp.allowedBuiltinCapabilities'])
      .where('gp.profileId', '=', profileId)
      .where('gu.userId', '=', userId)
      .execute();
  }

  private async canSelectProfile(
    profileId: string,
    spaceId: string,
    workspaceId: string,
    userId: string,
    db: Db,
  ): Promise<boolean> {
    if (!this.environment.isAiAssistantProfilesEnabled()) return false;
    const settings = await this.readWorkspaceSettings(workspaceId, db);
    if (!settings.enabled) return false;
    const row = await db
      .selectFrom('aiAssistantProfiles')
      .select(['id', 'enabled'])
      .where('id', '=', profileId)
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return Boolean(
      row?.enabled && (await this.isGroupAllowed(profileId, userId, db)),
    );
  }

  private availabilityForRow(params: {
    row: AiAssistantProfileEntity;
    deploymentEnabled: boolean;
    workspaceEnabled: boolean;
    groupAllowed: boolean;
  }): AiAssistantProfileAvailability {
    if (params.row.deletedAt) return 'deleted';
    if (!params.deploymentEnabled || !params.workspaceEnabled) {
      return 'policy_disabled';
    }
    if (!params.row.enabled) return 'disabled';
    return params.groupAllowed ? 'available' : 'not_allowed';
  }

  private async readWorkspaceSettings(
    workspaceId: string,
    db: Db = this.db,
  ) {
    const row = await db
      .selectFrom('aiAssistantProfileWorkspaceSettings')
      .select([
        'enabled',
        'modelOverridesEnabled',
        'policyVersion',
        'updatedAt',
      ])
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    return {
      enabled: row?.enabled ?? false,
      modelOverridesEnabled: row?.modelOverridesEnabled ?? false,
      policyVersion: row?.policyVersion ?? 0,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  private toWorkspacePolicy(settings: {
    enabled: boolean;
    modelOverridesEnabled: boolean;
    policyVersion: number;
    updatedAt: Date | null;
  }): AiAssistantProfileWorkspacePolicy {
    return {
      deploymentEnabled: this.environment.isAiAssistantProfilesEnabled(),
      enabled: settings.enabled,
      modelOverridesEnabled: settings.modelOverridesEnabled,
      policyVersion: settings.policyVersion,
      updatedAt: settings.updatedAt?.toISOString() ?? null,
    };
  }

  private async readPreferences(
    spaceId: string,
    userId: string,
    workspaceId: string,
    db: Db = this.db,
  ): Promise<AiAssistantProfilePreferences> {
    const row = await db
      .selectFrom('aiAssistantProfileUserPreferences')
      .select(['preferredProfileId', 'hiddenProfileIds'])
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('userId', '=', userId)
      .executeTakeFirst();
    return {
      spaceId,
      preferredProfileId: row?.preferredProfileId ?? null,
      hiddenProfileIds: row?.hiddenProfileIds ?? [],
    };
  }

  private async getProfileRow(
    profileId: string,
    spaceId: string | undefined,
    workspaceId: string | undefined,
    db: Db,
    includeDeleted = false,
    forUpdate = false,
  ): Promise<AiAssistantProfileEntity> {
    let query = db
      .selectFrom('aiAssistantProfiles')
      .selectAll()
      .where('id', '=', profileId);
    if (spaceId) query = query.where('spaceId', '=', spaceId);
    if (workspaceId) query = query.where('workspaceId', '=', workspaceId);
    if (!includeDeleted) query = query.where('deletedAt', 'is', null);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    if (!row) throw new NotFoundException('Assistant profile not found');
    return row;
  }

  private async requireConfig(
    spaceId: string,
    workspaceId: string,
  ): Promise<AiSpaceConfig> {
    const config = await this.configs.getRawConfig(spaceId, workspaceId);
    if (!config) {
      throw new BadRequestException(
        'Configure the space AI provider before managing profiles',
      );
    }
    return config;
  }

  private providerConfigFromSnapshot(
    config: AiSpaceConfig,
    snapshot: AiAssistantProfileProviderSnapshot,
  ): AiProviderConfig {
    return {
      ...this.configs.toProviderConfig(config),
      baseUrl: snapshot.normalizedBaseUrl,
      chatModel: snapshot.chatModel,
      temperature: snapshot.temperature,
      maxOutputTokens: snapshot.maxOutputTokens,
      requestTimeoutMs: snapshot.requestTimeoutMs,
    };
  }

  private normalizeQuickCommands(
    commands: CreateAiAssistantProfileDto['quickCommands'],
  ): AiQuickCommand[] | null {
    if (commands === null || commands === undefined) return null;
    const ids = new Set<string>();
    return commands.map((command, position) => {
      const id = command.id.trim();
      const label = command.label.trim();
      const prompt = command.prompt.trim();
      if (!id || !label || !prompt || ids.has(id)) {
        throw new BadRequestException('Invalid assistant profile quick command');
      }
      ids.add(id);
      return {
        id,
        label,
        prompt,
        ...(command.description?.trim()
          ? { description: command.description.trim() }
          : {}),
        enabled: command.enabled ?? true,
        position,
      };
    });
  }

  private readQuickCommands(value: unknown): AiQuickCommand[] | null {
    if (!Array.isArray(value)) return null;
    return value
      .filter(
        (item): item is AiQuickCommand =>
          Boolean(
            item &&
              typeof item === 'object' &&
              typeof (item as any).id === 'string' &&
              typeof (item as any).label === 'string' &&
              typeof (item as any).prompt === 'string',
          ),
      )
      .map((item, position) => ({
        id: item.id,
        label: item.label,
        prompt: item.prompt,
        ...(item.description ? { description: item.description } : {}),
        enabled: item.enabled !== false,
        position: Number.isFinite(item.position) ? item.position : position,
      }))
      .sort((left, right) => left.position - right.position);
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

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(value.filter((item): item is string => typeof item === 'string')),
    ];
  }

  private readApprovedExternalTools(value: unknown): Array<{
    toolName: string;
    schemaFingerprint: string;
  }> {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is { toolName: string; schemaFingerprint: string } =>
          Boolean(
            item &&
              typeof item === 'object' &&
              typeof (item as any).toolName === 'string' &&
              typeof (item as any).schemaFingerprint === 'string',
          ),
      )
      .map((item) => ({
        toolName: item.toolName,
        schemaFingerprint: item.schemaFingerprint,
      }));
  }

  private async assertProfilesEnabled(workspaceId: string, db: Db) {
    if (!this.environment.isAiAssistantProfilesEnabled()) {
      throw new BadRequestException({
        code: 'ai_profile_disabled',
        message: 'Assistant profiles are disabled for this deployment',
      });
    }
    const settings = await this.readWorkspaceSettings(workspaceId, db);
    if (!settings.enabled) {
      throw new BadRequestException({
        code: 'ai_profile_disabled',
        message: 'Assistant profiles are disabled for this workspace',
      });
    }
  }

  private async assertProfilesEnabledForRun(
    snapshot: AiAssistantProfileSnapshot,
    db: Db,
  ) {
    try {
      const row = await db
        .selectFrom('aiAssistantProfiles')
        .select('workspaceId')
        .where('id', '=', snapshot.profileId!)
        .executeTakeFirst();
      if (!row) {
        throw this.profileRunError(
          'ai_profile_disabled',
          'The assistant profile was deleted',
        );
      }
      await this.assertProfilesEnabled(row.workspaceId, db);
    } catch (error) {
      if ((error as any)?.response?.code === 'ai_profile_disabled') {
        throw this.profileRunError(
          'ai_profile_disabled',
          'Assistant profiles are disabled',
        );
      }
      throw error;
    }
  }

  private async assertCanManageSpace(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
  }

  private async canManageSpace(user: User, spaceId: string): Promise<boolean> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    return ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings);
  }

  private async assertCanUseSpace(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  private assertWorkspaceAdmin(user: User): void {
    if (![UserRole.OWNER, UserRole.ADMIN].includes(user.role as UserRole)) {
      throw new ForbiddenException(
        'Only workspace administrators can manage assistant profile policy',
      );
    }
  }

  private translateUniqueNameError(error: unknown): void {
    const constraint = String(
      (error as any)?.constraint ?? (error as any)?.constraint_name ?? '',
    );
    if (
      (error as any)?.code === '23505' &&
      constraint.includes('ai_assistant_profiles_active_name_unique')
    ) {
      throw new ConflictException({
        code: 'ai_profile_name_conflict',
        message: 'Assistant profile name already exists',
      });
    }
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'ai_profile_version_conflict',
      message: 'The assistant profile was updated elsewhere',
    });
  }

  private profileRunError(code: string, message: string): BadRequestException {
    this.metrics.observeProfileOutcome(
      code === 'agent_provider_config_changed'
        ? 'provider_config_changed'
        : code === 'agent_profile_policy_changed'
          ? 'policy_changed'
          : code === 'ai_profile_not_allowed'
            ? 'not_allowed'
            : 'disabled',
    );
    return new BadRequestException({ code, message });
  }
}
