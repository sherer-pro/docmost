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
  CreateFromTemplateDto,
  DetachPageEmbedDto,
  InsertPageEmbedDto,
  PageTemplateDiscoveryDto,
  PageTemplateGroupPolicyDto,
  PageTemplateSpacePolicyDto,
  PageTemplateWorkspacePolicyDto,
  SetPageTemplateDto,
} from './dto/page-template.dto';
import { PageTemplatePolicyService } from './transclusion/page-template-policy.service';
import { PageEmbedService } from './transclusion/page-embed.service';
import { PageTemplateService } from './services/page-template.service';

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class PageTemplateController {
  constructor(
    private readonly templates: PageTemplateService,
    private readonly policy: PageTemplatePolicyService,
    private readonly pageEmbeds: PageEmbedService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @Get('templates')
  async discover(
    @Query() dto: PageTemplateDiscoveryDto,
    @AuthUser() user: User,
  ) {
    return this.templates.discover(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'params', key: 'pageId' })
  @Post(':pageId/actions/set-template')
  async setTemplate(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: SetPageTemplateDto,
    @AuthUser() user: User,
  ) {
    return this.templates.setTemplate(pageId, dto.enabled, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('actions/create-from-template')
  async createFromTemplate(
    @Body() dto: CreateFromTemplateDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @AuthUser() user: User,
  ) {
    return this.templates.createFromTemplate(dto, idempotencyKey, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body', key: 'consumerPageId' })
  @Post('transclusion/actions/insert-page-embed')
  async insertPageEmbed(
    @Body() dto: InsertPageEmbedDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @AuthUser() user: User,
  ) {
    return this.templates.insertPageEmbed(dto, idempotencyKey, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body', key: 'consumerPageId' })
  @Post('transclusion/actions/detach-page-embed')
  async detachPageEmbed(
    @Body() dto: DetachPageEmbedDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @AuthUser() user: User,
  ) {
    return this.templates.detachPageEmbed(dto, idempotencyKey, user);
  }

  @Get('templates/:pageId/actions/usages')
  async listUsages(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    return this.pageEmbeds.listUsages(pageId, user);
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
