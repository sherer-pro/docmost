import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  PAGE_TEMPLATE_ACTIONS,
  PageTemplateAction,
} from '../../../common/config/page-template.constants';
import { SpaceRole, UserRole } from '../../../common/helpers/types/permission';
import type {
  PageTemplatePolicyGroupsQuery,
  PageTemplatePolicyGroupsResponse,
} from '@docmost/api-contract';
import { sql } from 'kysely';

export interface EffectivePageTemplatePolicy {
  systemEnabled: boolean;
  workspaceEnabled: boolean;
  templatesEnabled: boolean;
  allowCreateTemplate: boolean;
  allowRegularTemplate: boolean;
  allowSyncedTemplate: boolean;
  allowedActions: PageTemplateAction[];
}

@Injectable()
export class PageTemplatePolicyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environment: EnvironmentService,
  ) {}

  async resolveForUser(
    workspaceId: string,
    spaceId: string,
    userId: string,
  ): Promise<EffectivePageTemplatePolicy> {
    const [base, bypassGroupIntersection] = await Promise.all([
      this.readBasePolicy(workspaceId, spaceId),
      this.isPolicyAdministrator(workspaceId, spaceId, userId),
    ]);
    if (bypassGroupIntersection) {
      return {
        ...base,
        allowedActions: [...PAGE_TEMPLATE_ACTIONS] as PageTemplateAction[],
      };
    }
    const rows = await this.db
      .selectFrom('pageTemplateGroupPolicies as policy')
      .innerJoin('spaceMembers as policyMembership', (join) =>
        join
          .onRef('policyMembership.groupId', '=', 'policy.groupId')
          .onRef('policyMembership.spaceId', '=', 'policy.spaceId')
          .on('policyMembership.deletedAt', 'is', null),
      )
      .innerJoin('groups as policyGroup', 'policyGroup.id', 'policy.groupId')
      .innerJoin('groupUsers as member', 'member.groupId', 'policy.groupId')
      .select('policy.allowedActions')
      .where('policy.workspaceId', '=', workspaceId)
      .where('policy.spaceId', '=', spaceId)
      .where('policyGroup.workspaceId', '=', workspaceId)
      .where('policyGroup.deletedAt', 'is', null)
      .where('member.userId', '=', userId)
      .execute();

    let allowed = [...PAGE_TEMPLATE_ACTIONS] as PageTemplateAction[];
    for (const row of rows) {
      if (!Array.isArray(row.allowedActions)) continue;
      const narrowing = new Set(
        row.allowedActions.filter((value): value is PageTemplateAction =>
          PAGE_TEMPLATE_ACTIONS.includes(value as PageTemplateAction),
        ),
      );
      allowed = allowed.filter((action) => narrowing.has(action));
    }
    return { ...base, allowedActions: allowed };
  }

  async isPolicyAdministrator(
    workspaceId: string,
    spaceId: string,
    userId: string,
  ): Promise<boolean> {
    const user = await this.db
      .selectFrom('users')
      .select('role')
      .where('id', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN) {
      return true;
    }

    const membership = await this.db
      .selectFrom('spaceMembers as member')
      .innerJoin('spaces as policySpace', 'policySpace.id', 'member.spaceId')
      .leftJoin(
        'groupUsers as groupUser',
        'groupUser.groupId',
        'member.groupId',
      )
      .leftJoin('groups as memberGroup', 'memberGroup.id', 'member.groupId')
      .select('member.id')
      .where('member.spaceId', '=', spaceId)
      .where('policySpace.workspaceId', '=', workspaceId)
      .where('policySpace.deletedAt', 'is', null)
      .where('member.deletedAt', 'is', null)
      .where('member.role', '=', SpaceRole.ADMIN)
      .where((eb) =>
        eb.or([
          eb('member.userId', '=', userId),
          eb.and([
            eb('groupUser.userId', '=', userId),
            eb('memberGroup.workspaceId', '=', workspaceId),
            eb('memberGroup.deletedAt', 'is', null),
          ]),
        ]),
      )
      .executeTakeFirst();
    return Boolean(membership);
  }

  async resolvePublic(
    workspaceId: string,
    spaceId: string,
  ): Promise<EffectivePageTemplatePolicy> {
    return {
      ...(await this.readBasePolicy(workspaceId, spaceId)),
      allowedActions: [],
    };
  }

  async assertAction(
    workspaceId: string,
    spaceId: string,
    userId: string,
    action: PageTemplateAction,
  ): Promise<EffectivePageTemplatePolicy> {
    const policy = await this.resolveForUser(workspaceId, spaceId, userId);
    const actionEnabled =
      action === 'create_template' || action === 'manage_template'
        ? policy.allowCreateTemplate
        : action === 'use_regular_template'
          ? policy.allowRegularTemplate
          : policy.allowSyncedTemplate;
    if (
      !policy.systemEnabled ||
      !policy.workspaceEnabled ||
      !policy.templatesEnabled ||
      !actionEnabled ||
      !policy.allowedActions.includes(action)
    ) {
      throw new ForbiddenException({
        code: 'page_template_policy_denied',
        message: 'Page template action is disabled by policy',
      });
    }
    return policy;
  }

  async getWorkspacePolicy(workspaceId: string) {
    const row = await this.db
      .selectFrom('pageTemplateWorkspacePolicies')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    return {
      enabled: row?.enabled ?? false,
      revision: row?.revision ?? 0,
      systemEnabled: this.environment.isPageTemplatesEnabled(),
    };
  }

  async updateWorkspacePolicy(params: {
    workspaceId: string;
    userId: string;
    enabled: boolean;
    expectedRevision: number;
  }) {
    const updated =
      params.expectedRevision === 0
        ? await this.db
            .insertInto('pageTemplateWorkspacePolicies')
            .values({
              workspaceId: params.workspaceId,
              enabled: params.enabled,
              revision: 1,
              updatedById: params.userId,
            })
            .onConflict((conflict) =>
              conflict.column('workspaceId').doNothing(),
            )
            .returning('revision')
            .executeTakeFirst()
        : await this.db
            .updateTable('pageTemplateWorkspacePolicies')
            .set({
              enabled: params.enabled,
              revision: params.expectedRevision + 1,
              updatedById: params.userId,
              updatedAt: new Date(),
            })
            .where('workspaceId', '=', params.workspaceId)
            .where('revision', '=', params.expectedRevision)
            .returning('revision')
            .executeTakeFirst();
    if (!updated) this.throwRevisionConflict();
    return this.getWorkspacePolicy(params.workspaceId);
  }

  async getSpacePolicy(workspaceId: string, spaceId: string) {
    const [row, workspace] = await Promise.all([
      this.db
        .selectFrom('pageTemplateSpacePolicies')
        .selectAll()
        .where('workspaceId', '=', workspaceId)
        .where('spaceId', '=', spaceId)
        .executeTakeFirst(),
      this.getWorkspacePolicy(workspaceId),
    ]);
    return {
      spaceId,
      systemEnabled: workspace.systemEnabled,
      workspaceEnabled: workspace.enabled,
      templatesEnabled: row?.templatesEnabled ?? false,
      allowCreateTemplate: row?.allowCreateTemplate ?? false,
      allowRegularTemplate: row?.allowRegularTemplate ?? false,
      allowSyncedTemplate: row?.allowSyncedTemplate ?? false,
      revision: row?.revision ?? 0,
    };
  }

  async updateSpacePolicy(params: {
    workspaceId: string;
    spaceId: string;
    userId: string;
    expectedRevision: number;
    templatesEnabled: boolean;
    allowCreateTemplate: boolean;
    allowRegularTemplate: boolean;
    allowSyncedTemplate: boolean;
  }) {
    const values = {
      workspaceId: params.workspaceId,
      spaceId: params.spaceId,
      templatesEnabled: params.templatesEnabled,
      allowCreateTemplate: params.allowCreateTemplate,
      allowRegularTemplate: params.allowRegularTemplate,
      allowSyncedTemplate: params.allowSyncedTemplate,
      updatedById: params.userId,
    };
    const updated =
      params.expectedRevision === 0
        ? await this.db
            .insertInto('pageTemplateSpacePolicies')
            .values({ ...values, revision: 1 })
            .onConflict((conflict) => conflict.column('spaceId').doNothing())
            .returning('revision')
            .executeTakeFirst()
        : await this.db
            .updateTable('pageTemplateSpacePolicies')
            .set({
              templatesEnabled: params.templatesEnabled,
              allowCreateTemplate: params.allowCreateTemplate,
              allowRegularTemplate: params.allowRegularTemplate,
              allowSyncedTemplate: params.allowSyncedTemplate,
              revision: params.expectedRevision + 1,
              updatedById: params.userId,
              updatedAt: new Date(),
            })
            .where('workspaceId', '=', params.workspaceId)
            .where('spaceId', '=', params.spaceId)
            .where('revision', '=', params.expectedRevision)
            .returning('revision')
            .executeTakeFirst();
    if (!updated) this.throwRevisionConflict();
    return this.getSpacePolicy(params.workspaceId, params.spaceId);
  }

  async getGroupPolicy(workspaceId: string, spaceId: string, groupId: string) {
    const row = await this.db
      .selectFrom('groups as policyGroup')
      .innerJoin('spaceMembers as policyMembership', (join) =>
        join
          .onRef('policyMembership.groupId', '=', 'policyGroup.id')
          .on('policyMembership.spaceId', '=', spaceId)
          .on('policyMembership.deletedAt', 'is', null),
      )
      .leftJoin('pageTemplateGroupPolicies as policy', (join) =>
        join
          .onRef('policy.groupId', '=', 'policyGroup.id')
          .on('policy.workspaceId', '=', workspaceId)
          .on('policy.spaceId', '=', spaceId),
      )
      .select(['policy.allowedActions', 'policy.revision'])
      .where('policyGroup.id', '=', groupId)
      .where('policyGroup.workspaceId', '=', workspaceId)
      .where('policyGroup.deletedAt', 'is', null)
      .executeTakeFirst();
    if (!row) this.throwInactiveSpaceGroup();
    return {
      groupId,
      spaceId,
      allowedActions: row?.allowedActions ?? null,
      revision: row?.revision ?? 0,
    };
  }

  async listPolicyGroups(
    workspaceId: string,
    spaceId: string,
    options: PageTemplatePolicyGroupsQuery,
  ): Promise<PageTemplatePolicyGroupsResponse> {
    const limit = options.limit ?? 20;
    const cursor = this.decodePolicyGroupCursor(options.cursor);
    let query = this.db
      .selectFrom('groups as policyGroup')
      .innerJoin('spaceMembers as policyMembership', (join) =>
        join
          .onRef('policyMembership.groupId', '=', 'policyGroup.id')
          .on('policyMembership.spaceId', '=', spaceId)
          .on('policyMembership.deletedAt', 'is', null),
      )
      .select([
        'policyGroup.id',
        'policyGroup.name',
        'policyGroup.description',
        'policyGroup.isDefault',
      ])
      .select((eb) =>
        eb
          .selectFrom('groupUsers as member')
          .select((memberEb) => memberEb.fn.countAll().as('count'))
          .whereRef('member.groupId', '=', 'policyGroup.id')
          .as('memberCount'),
      )
      .where('policyGroup.workspaceId', '=', workspaceId)
      .where('policyGroup.deletedAt', 'is', null);
    const search = options.query?.trim();
    if (search) {
      query = query.where((eb) =>
        eb(
          sql`f_unaccent(${sql.ref('policyGroup.name')})`,
          'ilike',
          sql`f_unaccent(${'%' + search + '%'})`,
        ).or(
          sql`f_unaccent(${sql.ref('policyGroup.description')})`,
          'ilike',
          sql`f_unaccent(${'%' + search + '%'})`,
        ),
      );
    }
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('policyGroup.name', '>', cursor.name),
          eb.and([
            eb('policyGroup.name', '=', cursor.name),
            eb('policyGroup.id', '>', cursor.id),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('policyGroup.name', 'asc')
      .orderBy('policyGroup.id', 'asc')
      .limit(limit + 1)
      .execute();
    const items = rows.slice(0, limit).map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      isDefault: group.isDefault,
      memberCount: Number(group.memberCount ?? 0),
    }));
    return {
      items,
      nextCursor:
        rows.length > limit && items.length > 0
          ? this.encodePolicyGroupCursor(items.at(-1)!)
          : null,
    };
  }

  async updateGroupPolicy(params: {
    workspaceId: string;
    spaceId: string;
    groupId: string;
    userId: string;
    expectedRevision: number;
    allowedActions: PageTemplateAction[] | null;
  }) {
    const result = await executeTx(this.db, async (trx) => {
      await this.requireActiveSpaceGroup(
        trx,
        params.workspaceId,
        params.spaceId,
        params.groupId,
      );
      const updated =
        params.expectedRevision === 0
          ? await trx
              .insertInto('pageTemplateGroupPolicies')
              .values({
                workspaceId: params.workspaceId,
                spaceId: params.spaceId,
                groupId: params.groupId,
                allowedActions: params.allowedActions,
                revision: 1,
                updatedById: params.userId,
              })
              .onConflict((conflict) =>
                conflict.columns(['spaceId', 'groupId']).doNothing(),
              )
              .returning('revision')
              .executeTakeFirst()
          : await trx
              .updateTable('pageTemplateGroupPolicies')
              .set({
                allowedActions: params.allowedActions,
                revision: params.expectedRevision + 1,
                updatedById: params.userId,
                updatedAt: new Date(),
              })
              .where('workspaceId', '=', params.workspaceId)
              .where('spaceId', '=', params.spaceId)
              .where('groupId', '=', params.groupId)
              .where('revision', '=', params.expectedRevision)
              .returning('revision')
              .executeTakeFirst();
      if (!updated) this.throwRevisionConflict();
      return {
        groupId: params.groupId,
        spaceId: params.spaceId,
        allowedActions: params.allowedActions,
        revision: Number(updated.revision),
      };
    });
    return result;
  }

  private async requireActiveSpaceGroup(
    trx: KyselyTransaction,
    workspaceId: string,
    spaceId: string,
    groupId: string,
  ): Promise<void> {
    const group = await trx
      .selectFrom('groups as policyGroup')
      .innerJoin('spaceMembers as policyMembership', (join) =>
        join
          .onRef('policyMembership.groupId', '=', 'policyGroup.id')
          .on('policyMembership.spaceId', '=', spaceId)
          .on('policyMembership.deletedAt', 'is', null),
      )
      .select('policyGroup.id')
      .where('policyGroup.id', '=', groupId)
      .where('policyGroup.workspaceId', '=', workspaceId)
      .where('policyGroup.deletedAt', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!group) this.throwInactiveSpaceGroup();
  }

  private throwRevisionConflict(): never {
    throw new ConflictException({
      code: 'page_template_policy_revision_conflict',
      message: 'Page template policy was updated elsewhere',
    });
  }

  private throwInactiveSpaceGroup(): never {
    throw new BadRequestException({
      code: 'page_template_policy_group_not_in_space',
      message: 'Group is not an active member of this space',
    });
  }

  private encodePolicyGroupCursor(group: { id: string; name: string }): string {
    return Buffer.from(
      JSON.stringify({
        version: 1,
        type: 'page_template_policy_group',
        name: group.name,
        id: group.id,
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodePolicyGroupCursor(cursor?: string): {
    name: string;
    id: string;
  } | null {
    if (!cursor) return null;
    try {
      const value = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (
        value.version !== 1 ||
        value.type !== 'page_template_policy_group' ||
        typeof value.name !== 'string' ||
        typeof value.id !== 'string'
      ) {
        throw new Error('invalid cursor');
      }
      return { name: value.name, id: value.id };
    } catch {
      throw new BadRequestException({
        code: 'page_template_cursor_invalid',
        message: 'Invalid page template cursor',
      });
    }
  }

  private async readBasePolicy(
    workspaceId: string,
    spaceId: string,
  ): Promise<Omit<EffectivePageTemplatePolicy, 'allowedActions'>> {
    const space = await this.getSpacePolicy(workspaceId, spaceId);
    return {
      systemEnabled: space.systemEnabled,
      workspaceEnabled: space.workspaceEnabled,
      templatesEnabled: space.templatesEnabled,
      allowCreateTemplate: space.allowCreateTemplate,
      allowRegularTemplate: space.allowRegularTemplate,
      allowSyncedTemplate: space.allowSyncedTemplate,
    };
  }
}
