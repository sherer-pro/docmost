import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type {
  AuthenticationRequirement,
  SpacePolicy,
  SpacePolicyOverrides,
  SpacePolicyValues,
} from '@docmost/api-contract';
import type { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import type { Space, User, Workspace } from '@docmost/db/types/entity.types';
import { validate as isValidUuid } from 'uuid';
import { sql } from 'kysely';
import type {
  AuthenticationPolicyEvaluation,
  SessionAssuranceSource,
  SpaceWithPolicy,
  WorkspacePolicySource,
} from './space-policy.types';

@Injectable()
export class SpacePolicyService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  getWorkspaceValues(workspace: WorkspacePolicySource): SpacePolicyValues {
    return {
      enforceMfa: workspace.enforceMfa === true,
      enforceSso: workspace.enforceSso === true,
      disablePublicSharing:
        (workspace.settings as any)?.sharing?.disabled === true,
    };
  }

  getEffectivePublicSharingDisabled(
    workspaceSettings: unknown,
    spaceSettings: unknown,
  ): boolean {
    const workspaceDisabled =
      (workspaceSettings as any)?.sharing?.disabled === true;
    return (
      this.getOverrides(spaceSettings).disablePublicSharing ??
      workspaceDisabled
    );
  }

  getOverrides(spaceSettings: unknown): SpacePolicyOverrides {
    const settings = (spaceSettings ?? {}) as any;
    return {
      enforceMfa: this.optionalBoolean(settings?.security?.enforceMfa),
      enforceSso: this.optionalBoolean(settings?.security?.enforceSso),
      disablePublicSharing: this.optionalBoolean(settings?.sharing?.disabled),
    };
  }

  resolveFromSettings(
    workspace: WorkspacePolicySource,
    spaceSettings: unknown,
  ): SpacePolicy {
    const workspaceValues = this.getWorkspaceValues(workspace);
    const overrides = this.getOverrides(spaceSettings);

    return {
      overrides,
      effective: {
        enforceMfa: overrides.enforceMfa ?? workspaceValues.enforceMfa,
        enforceSso: overrides.enforceSso ?? workspaceValues.enforceSso,
        disablePublicSharing:
          overrides.disablePublicSharing ??
          workspaceValues.disablePublicSharing,
      },
    };
  }

  async resolve(
    workspaceId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<SpacePolicy | null> {
    const db = trx ?? this.db;
    const row = await db
      .selectFrom('workspaces')
      .innerJoin('spaces', 'spaces.workspaceId', 'workspaces.id')
      .select([
        'workspaces.enforceMfa',
        'workspaces.enforceSso',
        'workspaces.settings as workspaceSettings',
        'spaces.settings as spaceSettings',
      ])
      .where('workspaces.id', '=', workspaceId)
      .where('spaces.id', '=', spaceId)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return this.resolveFromSettings(
      {
        enforceMfa: row.enforceMfa,
        enforceSso: row.enforceSso,
        settings: row.workspaceSettings,
      },
      row.spaceSettings,
    );
  }

  async resolveSpaceId(
    workspaceId: string,
    identifier?: string,
  ): Promise<string | null> {
    if (!identifier) {
      return null;
    }

    let query = this.db
      .selectFrom('spaces')
      .select('id')
      .where('workspaceId', '=', workspaceId);

    query = isValidUuid(identifier)
      ? query.where('id', '=', identifier)
      : query.where(sql`LOWER(slug)`, '=', identifier.toLowerCase());

    const space = await query.executeTakeFirst();
    return space?.id ?? null;
  }

  async resolveAccessibleTarget(
    workspace: Workspace,
    user: User,
    spaceSlug?: string,
  ): Promise<{ space: Space; policy: SpacePolicy } | null> {
    if (!spaceSlug) {
      return null;
    }

    return this.resolveAccessibleSpace(workspace, user, spaceSlug);
  }

  async resolveAccessibleSpace(
    workspace: Workspace,
    user: User,
    identifier: string,
  ): Promise<{ space: Space; policy: SpacePolicy } | null> {
    const byId = isValidUuid(identifier);

    let query = this.db
      .selectFrom('spaces')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null);
    query = byId
      ? query.where('id', '=', identifier)
      : query.where(sql`LOWER(slug)`, '=', identifier.toLowerCase());
    const space = await query.executeTakeFirst();
    if (!space) {
      return null;
    }

    if (!(await this.canUserAccessSpace(user, space.id))) {
      return null;
    }

    return {
      space,
      policy: this.resolveFromSettings(workspace, space.settings),
    };
  }

  async resolveInvitationEntrySpace(
    workspace: Workspace,
    groupIds: string[] | null | undefined,
    invitedRole: string | null,
  ): Promise<{ space: Space; policy: SpacePolicy } | null> {
    let candidateIds: string[] | null = null;

    if (invitedRole !== 'owner' && invitedRole !== 'admin') {
      const groups = await this.db
        .selectFrom('groups')
        .select('id')
        .where('workspaceId', '=', workspace.id)
        .where((eb) =>
          eb.or([
            eb('isDefault', '=', true),
            ...(groupIds?.length
              ? [eb('id', 'in', groupIds)]
              : []),
          ]),
        )
        .execute();
      const effectiveGroupIds = groups.map((group) => group.id);
      if (effectiveGroupIds.length === 0) {
        return null;
      }

      const [spaceMemberships, pageRules] = await Promise.all([
        this.db
          .selectFrom('spaceMembers')
          .select('spaceId')
          .where('groupId', 'in', effectiveGroupIds)
          .execute(),
        this.db
          .selectFrom('pageAccessRules')
          .select('spaceId')
          .where('workspaceId', '=', workspace.id)
          .where('groupId', 'in', effectiveGroupIds)
          .where('effect', '=', 'allow')
          .execute(),
      ]);
      candidateIds = [
        ...new Set([
          ...spaceMemberships.map((row) => row.spaceId),
          ...pageRules.map((row) => row.spaceId),
        ]),
      ];
      if (candidateIds.length === 0) {
        return null;
      }
    }

    let query = this.db
      .selectFrom('spaces')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null);
    if (candidateIds) {
      query = query.where('id', 'in', candidateIds);
    }
    const spaces = await query.execute();
    spaces.sort((left, right) => {
      if (left.id === workspace.defaultSpaceId) return -1;
      if (right.id === workspace.defaultSpaceId) return 1;
      const created = left.createdAt.getTime() - right.createdAt.getTime();
      return created || left.id.localeCompare(right.id);
    });

    for (const space of spaces) {
      const policy = this.resolveFromSettings(workspace, space.settings);
      if (!policy.effective.enforceSso) {
        return { space, policy };
      }
    }

    return null;
  }

  withPolicy(space: Space, workspace: WorkspacePolicySource): SpaceWithPolicy {
    return {
      ...space,
      policy: this.resolveFromSettings(workspace, space.settings),
    };
  }

  evaluateAuthentication(
    values: Pick<SpacePolicyValues, 'enforceMfa' | 'enforceSso'>,
    session: SessionAssuranceSource,
  ): AuthenticationPolicyEvaluation {
    const requirements: AuthenticationRequirement[] = [];
    const missingRequirements: AuthenticationRequirement[] = [];

    if (values.enforceSso) {
      requirements.push('sso');
      if (!session.ssoVerifiedAt) {
        missingRequirements.push('sso');
      }
    }

    if (values.enforceMfa) {
      requirements.push('mfa');
      if (!session.mfaVerifiedAt) {
        missingRequirements.push('mfa');
      }
    }

    return {
      requirements,
      missingRequirements,
      satisfied: missingRequirements.length === 0,
    };
  }

  async hasEffectiveSsoEnforcement(
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    const db = trx ?? this.db;
    const workspace = await db
      .selectFrom('workspaces')
      .select('enforceSso')
      .where('id', '=', workspaceId)
      .executeTakeFirst();

    if (!workspace) {
      return false;
    }

    if (workspace.enforceSso) {
      return true;
    }

    const enforcedSpace = await db
      .selectFrom('spaces')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where(sql<boolean>`settings #>> '{security,enforceSso}' = 'true'`)
      .limit(1)
      .executeTakeFirst();

    return Boolean(enforcedSpace);
  }

  isLoosening(
    current: SpacePolicyValues,
    next: SpacePolicyValues,
  ): boolean {
    return (
      (current.enforceMfa && !next.enforceMfa) ||
      (current.enforceSso && !next.enforceSso) ||
      (current.disablePublicSharing && !next.disablePublicSharing)
    );
  }

  private optionalBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private async canUserAccessSpace(user: User, spaceId: string) {
    if (user.role === 'owner' || user.role === 'admin') {
      return true;
    }

    const direct = await this.db
      .selectFrom('spaceMembers')
      .select('id')
      .where('spaceId', '=', spaceId)
      .where('userId', '=', user.id)
      .executeTakeFirst();
    if (direct) {
      return true;
    }

    const groupMembership = await this.db
      .selectFrom('spaceMembers')
      .innerJoin('groupUsers', 'groupUsers.groupId', 'spaceMembers.groupId')
      .select('spaceMembers.id')
      .where('spaceMembers.spaceId', '=', spaceId)
      .where('groupUsers.userId', '=', user.id)
      .executeTakeFirst();
    if (groupMembership) {
      return true;
    }

    const pageRule = await this.db
      .selectFrom('pageAccessRules')
      .leftJoin('groupUsers', (join) =>
        join
          .onRef('groupUsers.groupId', '=', 'pageAccessRules.groupId')
          .on('groupUsers.userId', '=', user.id),
      )
      .select('pageAccessRules.id')
      .where('pageAccessRules.spaceId', '=', spaceId)
      .where('pageAccessRules.effect', '=', 'allow')
      .where((eb) =>
        eb.or([
          eb('pageAccessRules.userId', '=', user.id),
          eb('groupUsers.userId', '=', user.id),
        ]),
      )
      .executeTakeFirst();
    return Boolean(pageRule);
  }
}
