import type postgresTypes from 'postgres';
import { CamelCasePlugin, Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { v7 as uuid7 } from 'uuid';
import { normalizePostgresUrl } from '../src/common/helpers';
import { postgres } from '../src/database/postgres-client';
import type { DB } from '../src/database/types/db';

jest.mock('../src/core/ai/mcp/ai-mcp-policy.service', () => ({
  AiMcpPolicyService: class AiMcpPolicyService {},
}));
jest.mock('../src/core/ai/tools/ai-builtin-tool-policy.service', () => ({
  AiBuiltinToolPolicyService: class AiBuiltinToolPolicyService {},
}));

import { AiAssistantProfileService } from '../src/core/ai/services/ai-assistant-profile.service';

jest.setTimeout(30_000);

describe('assistant profiles with PostgreSQL (e2e)', () => {
  let database: postgresTypes.Sql;
  let repositoryClient: postgresTypes.Sql;
  let kysely: any;
  let profiles: AiAssistantProfileService;
  let fixtureCreated = false;

  const workspaceId = uuid7();
  const ownerId = uuid7();
  const hiddenUserId = uuid7();
  const spaceId = uuid7();
  const secondSpaceId = uuid7();
  const owner = {
    id: ownerId,
    workspaceId,
    role: 'owner',
  } as any;
  const workspace = { id: workspaceId } as any;

  beforeAll(async () => {
    const databaseUrl = normalizePostgresUrl(process.env.DATABASE_URL!);
    database = postgres(databaseUrl, { max: 4 });
    repositoryClient = postgres(databaseUrl, { max: 4 });
    kysely = new Kysely<DB>({
      dialect: new PostgresJSDialect({ postgres: repositoryClient }),
      plugins: [new CamelCasePlugin()],
    });

    await database`
      insert into workspaces (id, name)
      values (${workspaceId}::uuid, 'Assistant profiles e2e')
    `;
    fixtureCreated = true;
    await database`
      insert into users (id, name, email, role, workspace_id)
      values
        (
          ${ownerId}::uuid,
          'Profiles owner',
          ${`profiles-${ownerId}@example.test`},
          'owner',
          ${workspaceId}::uuid
        ),
        (
          ${hiddenUserId}::uuid,
          'Profiles hidden user',
          ${`profiles-${hiddenUserId}@example.test`},
          'member',
          ${workspaceId}::uuid
        )
    `;
    await database`
      insert into spaces (id, name, slug, creator_id, workspace_id)
      values
        (
          ${spaceId}::uuid,
          'Profiles primary',
          ${`profiles-${spaceId}`},
          ${ownerId}::uuid,
          ${workspaceId}::uuid
        ),
        (
          ${secondSpaceId}::uuid,
          'Profiles secondary',
          ${`profiles-${secondSpaceId}`},
          ${ownerId}::uuid,
          ${workspaceId}::uuid
        )
    `;
    await database`
      insert into ai_assistant_profile_workspace_settings (
        workspace_id,
        enabled,
        model_overrides_enabled,
        updated_by_id
      ) values (${workspaceId}::uuid, true, true, ${ownerId}::uuid)
    `;
    await database`
      insert into ai_space_configs (
        workspace_id,
        space_id,
        enabled,
        base_url,
        chat_model,
        system_instructions,
        created_by_id,
        updated_by_id
      ) values
        (
          ${workspaceId}::uuid,
          ${spaceId}::uuid,
          true,
          'https://provider.example/v1',
          'space-model',
          'PROFILE_MARKER:LEGACY',
          ${ownerId}::uuid,
          ${ownerId}::uuid
        ),
        (
          ${workspaceId}::uuid,
          ${secondSpaceId}::uuid,
          true,
          'https://provider.example/v1',
          'space-model',
          'PROFILE_MARKER:LEGACY',
          ${ownerId}::uuid,
          ${ownerId}::uuid
        )
    `;

    const configService = {
      getRawConfig: async (requestedSpaceId: string) =>
        kysely
          .selectFrom('aiSpaceConfigs')
          .selectAll()
          .where('spaceId', '=', requestedSpaceId)
          .where('workspaceId', '=', workspaceId)
          .executeTakeFirst(),
      toProviderConfig: (config: any) => ({
        ...config,
        apiKey: 'current-provider-secret',
      }),
    };
    const spaceAbility = {
      createForUser: async (user: any) => {
        const canManage =
          ['owner', 'admin'].includes(user.role) || user.spaceRole === 'admin';
        return {
          can: (action: string, subject: string) =>
            action === 'read' ||
            subject === 'page' ||
            (action === 'manage' && canManage),
          cannot: (action: string, subject: string) =>
            !(
              action === 'read' ||
              subject === 'page' ||
              (action === 'manage' && canManage)
            ),
        };
      },
    };
    profiles = new AiAssistantProfileService(
      kysely,
      { isAiAssistantProfilesEnabled: () => true } as any,
      spaceAbility as any,
      configService as any,
      {
        getEffectiveCapabilities: jest.fn(async () => []),
        buildRunSnapshot: jest.fn(async () => ({
          schemaVersion: 1,
          workspacePolicyVersion: 1,
          spacePolicyVersion: 1,
          capabilities: [],
        })),
      } as any,
      { buildRunSnapshot: jest.fn(async () => null) } as any,
      {} as any,
      { observeProfileOutcome: jest.fn() } as any,
    );
    jest.spyOn(profiles as any, 'verificationStatus').mockResolvedValue({
      verified: false,
      reason: 'no_tools',
      verifiedAt: null,
    });
  });

  afterAll(async () => {
    if (database && fixtureCreated) {
      await database`delete from workspaces where id = ${workspaceId}::uuid`;
    }
    await Promise.all([kysely?.destroy(), database?.end({ timeout: 5 })]);
  });

  const createProfile = (
    name: string,
    overrides: Record<string, unknown> = {},
  ) =>
    profiles.create(
      spaceId,
      {
        name,
        icon: 'sparkles',
        instructions: `PROFILE_MARKER:${name.replace(/\W/g, '_')}`,
        chatModelOverride: 'qa-model-alpha',
        allowedBuiltinCapabilities: [],
        enabled: true,
        ...overrides,
      } as any,
      owner,
      workspace,
    );

  it('creates, reads, updates concurrently, and soft-deletes a profile', async () => {
    const created = await createProfile('CRUD profile');
    await expect(
      profiles.getAdmin(spaceId, created.id, owner, workspace),
    ).resolves.toMatchObject({
      id: created.id,
      name: 'CRUD profile',
      version: 1,
    });

    const first = profiles.update(
      spaceId,
      created.id,
      { expectedVersion: 1, description: 'first admin' } as any,
      owner,
      workspace,
    );
    const second = profiles.update(
      spaceId,
      created.id,
      { expectedVersion: 1, description: 'second admin' } as any,
      owner,
      workspace,
    );
    const results = await Promise.allSettled([first, second]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      (results.find((result) => result.status === 'rejected') as any).reason
        .response,
    ).toMatchObject({ code: 'ai_profile_version_conflict' });

    await expect(
      profiles.remove(spaceId, created.id, owner, workspace),
    ).resolves.toEqual({ success: true });
    const [deleted] = await database<
      { enabled: boolean; deleted_at: Date; version: number }[]
    >`
      select enabled, deleted_at, version
      from ai_assistant_profiles
      where id = ${created.id}::uuid
    `;
    expect(deleted.enabled).toBe(false);
    expect(deleted.deleted_at).toBeInstanceOf(Date);
    expect(deleted.version).toBe(3);
  });

  it('enforces active case-insensitive uniqueness and permits name reuse after delete', async () => {
    const first = await createProfile('Unique profile');
    await expect(createProfile('unique PROFILE')).rejects.toMatchObject({
      status: 409,
      response: { code: 'ai_profile_name_conflict' },
    });
    await profiles.remove(spaceId, first.id, owner, workspace);
    await expect(createProfile('UNIQUE PROFILE')).resolves.toMatchObject({
      name: 'UNIQUE PROFILE',
    });
  });

  it('freezes runtime model and instructions and rejects cross-space selection', async () => {
    const created = await createProfile('Runtime Alpha', {
      instructions: 'PROFILE_MARKER:ALPHA',
      chatModelOverride: 'qa-model-alpha',
    });
    await database`
      update ai_space_configs
      set default_assistant_profile_id = ${created.id}::uuid
      where space_id = ${spaceId}::uuid
    `;
    await profiles.updatePreferences(
      spaceId,
      { preferredProfileId: created.id, hiddenProfileIds: [] },
      owner,
      workspace,
    );

    const frozen = await profiles.resolveConversationSnapshot(kysely, {
      workspaceId,
      spaceId,
      userId: ownerId,
    });
    expect(frozen.snapshot).toMatchObject({
      profileId: created.id,
      profileVersion: 1,
      instructions: 'PROFILE_MARKER:ALPHA',
      chatModelOverride: 'qa-model-alpha',
    });
    const updated = await profiles.update(
      spaceId,
      created.id,
      {
        expectedVersion: 1,
        instructions: 'PROFILE_MARKER:ALPHA_EDITED',
        chatModelOverride: 'qa-model-beta',
      } as any,
      owner,
      workspace,
    );
    expect(updated.version).toBe(2);
    expect(frozen.snapshot).toMatchObject({
      profileVersion: 1,
      instructions: 'PROFILE_MARKER:ALPHA',
      chatModelOverride: 'qa-model-alpha',
    });
    await expect(
      profiles.resolveConversationSnapshot(kysely, {
        workspaceId,
        spaceId: secondSpaceId,
        userId: ownerId,
        assistantProfileId: created.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('clears default and personal assignments when deleting a profile', async () => {
    const created = await createProfile('Assigned profile');
    await database`
      update ai_space_configs
      set default_assistant_profile_id = ${created.id}::uuid
      where space_id = ${spaceId}::uuid
    `;
    await profiles.updatePreferences(
      spaceId,
      {
        preferredProfileId: created.id,
        hiddenProfileIds: [],
      },
      owner,
      workspace,
    );
    await profiles.updatePreferences(
      spaceId,
      {
        preferredProfileId: null,
        hiddenProfileIds: [created.id],
      },
      { ...owner, id: hiddenUserId },
      workspace,
    );
    const frozen = await profiles.resolveConversationSnapshot(kysely, {
      workspaceId,
      spaceId,
      userId: ownerId,
    });

    await profiles.remove(spaceId, created.id, owner, workspace);
    const [config] = await database<
      { default_assistant_profile_id: string | null }[]
    >`
      select default_assistant_profile_id
      from ai_space_configs
      where space_id = ${spaceId}::uuid
    `;
    const preferences = await database<
      {
        user_id: string;
        preferred_profile_id: string | null;
        hidden_profile_ids: string[];
      }[]
    >`
      select user_id, preferred_profile_id, hidden_profile_ids
      from ai_assistant_profile_user_preferences
      where space_id = ${spaceId}::uuid
        and user_id in (${ownerId}::uuid, ${hiddenUserId}::uuid)
      order by user_id
    `;
    expect(config.default_assistant_profile_id).toBeNull();
    expect(preferences).toHaveLength(2);
    expect(preferences).toEqual(
      expect.arrayContaining([
        {
          user_id: ownerId,
          preferred_profile_id: null,
          hidden_profile_ids: [],
        },
        {
          user_id: hiddenUserId,
          preferred_profile_id: null,
          hidden_profile_ids: [],
        },
      ]),
    );
    await expect(
      profiles.assertSnapshotLive(frozen.snapshot, ownerId, kysely),
    ).rejects.toMatchObject({
      response: { code: 'ai_profile_disabled' },
    });
  });

  it('enforces the workspace-admin and space-role management matrix', async () => {
    const spaceAdmin = {
      id: ownerId,
      workspaceId,
      role: 'member',
      spaceRole: 'admin',
    } as any;
    const editor = {
      id: ownerId,
      workspaceId,
      role: 'member',
      spaceRole: 'writer',
    } as any;
    const viewer = {
      id: ownerId,
      workspaceId,
      role: 'member',
      spaceRole: 'reader',
    } as any;

    await expect(
      profiles.create(
        spaceId,
        {
          name: 'Space admin profile',
          icon: 'sparkles',
          instructions: 'PROFILE_MARKER:SPACE_ADMIN',
          allowedBuiltinCapabilities: [],
        } as any,
        spaceAdmin,
        workspace,
      ),
    ).resolves.toMatchObject({ name: 'Space admin profile' });
    await expect(
      profiles.updateWorkspacePolicy({}, spaceAdmin, workspace),
    ).rejects.toMatchObject({ status: 403 });
    for (const user of [editor, viewer]) {
      await expect(
        profiles.create(
          spaceId,
          {
            name: `Forbidden ${user.spaceRole}`,
            icon: 'sparkles',
            instructions: 'PROFILE_MARKER:FORBIDDEN',
            allowedBuiltinCapabilities: [],
          } as any,
          user,
          workspace,
        ),
      ).rejects.toMatchObject({ status: 403 });
    }
  });
});
