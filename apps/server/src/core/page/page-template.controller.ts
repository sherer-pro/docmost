import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/helpers/types/permission';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import {
  CreatePageTemplateDto,
  CreateFromTemplateDto,
  DetachSyncedTemplateDto,
  PageTemplateDestinationsDto,
  PageTemplateDiscoveryDto,
  PageTemplateGroupPolicyDto,
  PublishPageTemplateDto,
  PageTemplateSpacePolicyDto,
  PageTemplateWorkspacePolicyDto,
} from './dto/page-template.dto';
import { PageTemplatePolicyService } from './transclusion/page-template-policy.service';
import { PageTemplateService } from './services/page-template.service';

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class PageTemplateController {
  constructor(
    private readonly templates: PageTemplateService,
    private readonly policy: PageTemplatePolicyService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @Get('templates')
  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  async discover(
    @Query() dto: PageTemplateDiscoveryDto,
    @AuthUser() user: User,
  ) {
    return this.templates.discover(dto, user);
  }

  @Get('templates/destinations')
  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  async listDestinations(
    @Query() dto: PageTemplateDestinationsDto,
    @AuthUser() user: User,
  ) {
    return this.templates.listDestinations(dto, user);
  }

  @Post('templates/actions/create')
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  async createTemplate(
    @Body() dto: CreatePageTemplateDto,
    @AuthUser() user: User,
  ) {
    return this.templates.createTemplate(dto, user);
  }

  @Get('templates/:pageId/provenance')
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  async getProvenance(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    return this.templates.getProvenance(pageId, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  @Post('actions/create-from-template')
  async createFromTemplate(
    @Body() dto: CreateFromTemplateDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @AuthUser() user: User,
  ) {
    return this.templates.createFromTemplate(dto, idempotencyKey, user);
  }

  @Get('templates/:pageId/actions/usages')
  async listUsages(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    return this.templates.listUsages(pageId, user);
  }

  @Post('templates/:pageId/actions/preflight-publish')
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  async preflightPublish(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    return this.templates.preflightPublish(pageId, user);
  }

  @Post('templates/:pageId/actions/publish')
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  async publish(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: PublishPageTemplateDto,
    @AuthUser() user: User,
  ) {
    return this.templates.publish(pageId, dto, user);
  }

  @Get('templates/:pageId/revisions')
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  async listRevisions(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    return this.templates.listRevisions(pageId, user);
  }

  @Get('templates/:pageId/sync-runs')
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  async listSyncRuns(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    return this.templates.listSyncRuns(pageId, user);
  }

  @Post('templates/:pageId/sync-runs/:runId/actions/retry')
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  async retrySyncRun(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @AuthUser() user: User,
  ) {
    return this.templates.retrySyncRun(pageId, runId, user);
  }

  @Post('templates/:pageId/actions/archive')
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  async archive(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    return this.templates.archive(pageId, user);
  }

  @Post(':pageId/actions/detach-template')
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  async detachTemplate(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: DetachSyncedTemplateDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @AuthUser() user: User,
  ) {
    return this.templates.detachTemplate(pageId, dto, idempotencyKey, user);
  }

  @Get('templates/policies/workspace')
  async getWorkspacePolicy(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertWorkspaceAdmin(user);
    return this.policy.getWorkspacePolicy(workspace.id);
  }

  @Patch('templates/policies/workspace')
  async updateWorkspacePolicy(
    @Body() dto: PageTemplateWorkspacePolicyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertWorkspaceAdmin(user);
    return this.policy.updateWorkspacePolicy({
      workspaceId: workspace.id,
      userId: user.id,
      enabled: dto.enabled,
      expectedRevision: dto.expectedRevision,
    });
  }

  @Get('templates/policies/spaces/:spaceId')
  async getSpacePolicy(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @AuthUser() user: User,
  ) {
    await this.assertManageSpace(user, spaceId);
    return this.policy.getSpacePolicy(user.workspaceId, spaceId);
  }

  @Put('templates/policies/spaces/:spaceId')
  async updateSpacePolicy(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() dto: PageTemplateSpacePolicyDto,
    @AuthUser() user: User,
  ) {
    await this.assertManageSpace(user, spaceId);
    return this.policy.updateSpacePolicy({
      workspaceId: user.workspaceId,
      spaceId,
      userId: user.id,
      ...dto,
    });
  }

  @Get('templates/policies/spaces/:spaceId/groups/:groupId')
  async getGroupPolicy(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @AuthUser() user: User,
  ) {
    await this.assertManageSpace(user, spaceId);
    return this.policy.getGroupPolicy(user.workspaceId, spaceId, groupId);
  }

  @Put('templates/policies/spaces/:spaceId/groups/:groupId')
  async updateGroupPolicy(
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: PageTemplateGroupPolicyDto,
    @AuthUser() user: User,
  ) {
    await this.assertManageSpace(user, spaceId);
    return this.policy.updateGroupPolicy({
      workspaceId: user.workspaceId,
      spaceId,
      groupId,
      userId: user.id,
      expectedRevision: dto.expectedRevision,
      allowedActions: (dto.allowedActions ?? null) as any,
    });
  }

  private assertWorkspaceAdmin(user: User): void {
    if (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException();
    }
  }

  private async assertManageSpace(user: User, spaceId: string): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException();
    }
  }
}
