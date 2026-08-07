import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import {
  PAGE_TEMPLATE_ACTIONS,
  PageTemplateAction,
} from '../../../common/config/page-embed.constants';

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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  getMaxPageEmbedDepth(): number {
    return this.environment.getMaxPageEmbedDepth();
  }

  async resolveForUser(
    workspaceId: string,
    spaceId: string,
    userId: string,
  ): Promise<EffectivePageTemplatePolicy> {
    const base = await this.readBasePolicy(workspaceId, spaceId);
    const rows = await this.db
      .selectFrom('pageTemplateGroupPolicies as policy')
      .innerJoin('groupUsers as member', 'member.groupId', 'policy.groupId')
      .select('policy.allowedActions')
      .where('policy.workspaceId', '=', workspaceId)
      .where('policy.spaceId', '=', spaceId)
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
    this.emitVisibilityChanged(params.workspaceId);
    return this.getWorkspacePolicy(params.workspaceId);
  }

  async getSpacePolicy(workspaceId: string, spaceId: string) {
    const row = await this.db
      .selectFrom('pageTemplateSpacePolicies')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .executeTakeFirst();
    return {
      spaceId,
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
    this.emitVisibilityChanged(params.workspaceId);
    return this.getSpacePolicy(params.workspaceId, params.spaceId);
  }

  async getGroupPolicy(workspaceId: string, spaceId: string, groupId: string) {
    const row = await this.db
      .selectFrom('pageTemplateGroupPolicies')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('groupId', '=', groupId)
      .executeTakeFirst();
    return {
      groupId,
      spaceId,
      allowedActions: row?.allowedActions ?? null,
      revision: row?.revision ?? 0,
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
    const group = await this.db
      .selectFrom('groups')
      .select('id')
      .where('id', '=', params.groupId)
      .where('workspaceId', '=', params.workspaceId)
      .executeTakeFirst();
    if (!group) throw new BadRequestException('Group not found');
    const updated =
      params.expectedRevision === 0
        ? await this.db
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
        : await this.db
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
    this.emitVisibilityChanged(params.workspaceId);
    return this.getGroupPolicy(
      params.workspaceId,
      params.spaceId,
      params.groupId,
    );
  }

  private emitVisibilityChanged(workspaceId: string): void {
    this.eventEmitter.emit(EventName.PAGE_EMBED_VISIBILITY_CHANGED, {
      workspaceId,
    });
  }

  private throwRevisionConflict(): never {
    throw new ConflictException({
      code: 'page_template_policy_revision_conflict',
      message: 'Page template policy was updated elsewhere',
    });
  }

  private async readBasePolicy(
    workspaceId: string,
    spaceId: string,
  ): Promise<Omit<EffectivePageTemplatePolicy, 'allowedActions'>> {
    const [workspace, space] = await Promise.all([
      this.getWorkspacePolicy(workspaceId),
      this.getSpacePolicy(workspaceId, spaceId),
    ]);
    return {
      systemEnabled: workspace.systemEnabled,
      workspaceEnabled: workspace.enabled,
      templatesEnabled: space.templatesEnabled,
      allowCreateTemplate: space.allowCreateTemplate,
      allowRegularTemplate: space.allowRegularTemplate,
      allowSyncedTemplate: space.allowSyncedTemplate,
    };
  }
}
