import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PageService } from './services/page.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { MovePageDto, MovePageToSpaceDto } from './dto/move-page.dto';
import {
  DeletePageDto,
  PageHistoryQueryDto,
  PageHistoryIdDto,
  PageIdDto,
  PageInfoDto,
  PageLabelsQueryDto,
} from './dto/page.dto';
import { PageHistoryService } from './services/page-history.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { SidebarPageDto, SidebarPagesQueryDto } from './dto/sidebar-page.dto';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { RecentPageDto, RecentPagesQueryDto } from './dto/recent-page.dto';
import { DuplicatePageDto } from './dto/duplicate-page.dto';
import { DeletedPageDto, DeletedPagesQueryDto } from './dto/deleted-page.dto';
import { LinkPreviewDto } from './dto/link-preview.dto';
import { AddLabelsDto, RemoveLabelDto } from '../label/dto/label.dto';
import { LabelService } from '../label/label.service';
import { BacklinkService } from './services/backlink.service';
import { BacklinksListDto, BacklinksListQueryDto } from './dto/backlink.dto';
import {
  jsonToHtml,
  jsonToMarkdown,
} from '../../collaboration/collaboration.util';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import {
  mapPageCustomFields,
  mapPageResponse,
} from './mappers/page-response.mapper';
import { PageAccessService } from '../page-access/page-access.service';
import { PageRole } from '../../common/helpers/types/permission';
import {
  ClosePageGroupAccessDto,
  ClosePageUserAccessDto,
  GrantPageGroupAccessDto,
  GrantPageUserAccessDto,
  ResolvePageAccessUsersDto,
} from './dto/page-access.dto';
import { LinkPreviewService } from './services/link-preview.service';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';
import { PageAccessMutationService } from './services/page-access-mutation.service';

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class PageController {
  constructor(
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly pageHistoryService: PageHistoryService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly databaseRepo: DatabaseRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly pageAccessMutationService: PageAccessMutationService,
    private readonly labelService: LabelService,
    private readonly backlinkService: BacklinkService,
    private readonly linkPreviewService: LinkPreviewService,
  ) {}

  private toAccessResponse(access: {
    role: PageRole | null;
    sources: string[];
    capabilities: {
      canRead: boolean;
      canWrite: boolean;
      canCreateChild: boolean;
      canMoveDeleteShare: boolean;
      canManageAccess: boolean;
    };
    isSystemAccess: boolean;
  }) {
    return {
      role: access.role,
      sources: access.sources,
      capabilities: access.capabilities,
      isSystemAccess: access.isSystemAccess,
    };
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'query' })
  @Get('/info')
  async getPageViaQuery(@Query() dto: PageInfoDto, @AuthUser() user: User) {
    return this.getPage(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body' })
  @Post('labels')
  async getPageLabels(@Body() dto: PageLabelsQueryDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);

    return this.labelService.getPageLabels(page.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body' })
  @Post('labels/add')
  async addPageLabels(
    @Body() dto: AddLabelsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanWritePage(page, user);

    return this.labelService.addLabelsToPage(
      page.id,
      dto.names,
      workspace.id,
      page.spaceId,
    );
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body' })
  @Post('labels/remove')
  async removePageLabel(
    @Body() dto: RemoveLabelDto,
    @AuthUser() user: User,
  ): Promise<void> {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanWritePage(page, user);

    await this.labelService.removeLabelFromPage(
      page.id,
      dto.labelId,
      page.workspaceId,
      page.spaceId,
    );
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'query' })
  @Get('backlinks-count')
  async getBacklinksCountViaQuery(
    @Query() dto: PageIdDto,
    @AuthUser() user: User,
  ): Promise<{ incoming: number; outgoing: number }> {
    return this.getBacklinksCount(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'query' })
  @Get('backlinks')
  async getBacklinksViaQuery(
    @Query() query: BacklinksListQueryDto,
    @AuthUser() user: User,
  ) {
    return this.getBacklinks(query, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/link-preview')
  async getLinkPreview(@Body() dto: LinkPreviewDto) {
    return this.linkPreviewService.getPreview(dto.url);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  @Post('/')
  async createViaResource(
    @Body() createPageDto: CreatePageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.create(createPageDto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body' })
  @Post('actions/update')
  async updateViaAction(
    @Body() updatePageDto: UpdatePageDto,
    @AuthUser() user: User,
  ) {
    return this.update(updatePageDto, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body' })
  @Post('actions/delete')
  async deleteViaAction(
    @Body() deletePageDto: DeletePageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.delete(deletePageDto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body' })
  @Post('restore')
  async restore(
    @Body() pageIdDto: PageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(pageIdDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    await this.pageRepo.restorePage(page.id, workspace.id);

    const restoredPage = await this.pageRepo.findById(page.id, {
      includeHasChildren: true,
    });

    if (!restoredPage) {
      return restoredPage;
    }

    const access = await this.pageAccessService.getEffectiveAccess(
      restoredPage,
      user,
    );
    return {
      ...mapPageResponse(restoredPage),
      access: this.toAccessResponse(access),
    };
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'query',
    key: 'spaceId',
    optional: true,
  })
  @Get('recent')
  async getRecentPagesViaQuery(
    @Query() query: RecentPagesQueryDto,
    @AuthUser() user: User,
  ) {
    return this.getRecentPages(query, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'query',
    key: 'spaceId',
  })
  @Get('trash')
  async getDeletedPagesViaQuery(
    @Query() query: DeletedPagesQueryDto,
    @AuthUser() user: User,
  ) {
    return this.getDeletedPages(query, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'query' })
  @Get('/history')
  async getPageHistoryViaQuery(
    @Query() query: PageHistoryQueryDto,
    @AuthUser() user: User,
  ) {
    return this.getPageHistory(query, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('resource', {
    source: 'query',
    key: 'historyId',
    resourceType: 'pageHistory',
  })
  @Get('/history/info')
  async getPageHistoryInfoViaQuery(
    @Query() dto: PageHistoryIdDto,
    @AuthUser() user: User,
  ) {
    return this.getPageHistoryInfo(dto, user);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthPolicyScope('resource', {
    key: 'historyId',
    resourceType: 'pageHistory',
  })
  @Delete('/history/:historyId')
  async deletePageHistory(
    @Param() dto: PageHistoryIdDto,
    @AuthUser() user: User,
  ): Promise<void> {
    const history = await this.pageHistoryService.findMetadataById(
      dto.historyId,
    );
    if (!history) {
      throw new NotFoundException('Page history not found');
    }

    this.pageAccessService.assertCanManageAccess(user, history.workspaceId);

    await this.pageHistoryService.deleteById(history.id);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'query',
    key: 'spaceId',
    fallbackKey: 'pageId',
    fallbackScope: 'page',
  })
  @Get('/sidebar-pages')
  async getSidebarPagesViaQuery(
    @Query() query: SidebarPagesQueryDto,
    @AuthUser() user: User,
  ) {
    return this.getSidebarPages(query, user);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { key: 'pageId' })
  @Post(':pageId/actions/access/users')
  async listPageAccessUsers(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    this.pageAccessService.assertCanManageAccess(user, page.workspaceId);
    return this.pageAccessService.listEffectiveUsers(page, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { key: 'pageId' })
  @Post(':pageId/actions/access/resolve-users')
  async resolvePageAccessUsers(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: ResolvePageAccessUsersDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);
    return this.pageAccessService.resolveReadableUsers(page, dto.userIds ?? []);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { key: 'pageId' })
  @Post(':pageId/actions/access/groups')
  async listPageAccessGroups(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    this.pageAccessService.assertCanManageAccess(user, page.workspaceId);
    return this.pageAccessService.listGroupRules(page, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { key: 'pageId' })
  @Post(':pageId/actions/access/grant-user')
  async grantPageUserAccess(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: GrantPageUserAccessDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessMutationService.grantUserAccessForSubtree(
      page,
      dto.userId,
      dto.role,
      user,
    );

    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { key: 'pageId' })
  @Post(':pageId/actions/access/close-user')
  async closePageUserAccess(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: ClosePageUserAccessDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessMutationService.closeUserAccessForSubtree(
      page,
      dto.userId,
      user,
    );

    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { key: 'pageId' })
  @Post(':pageId/actions/access/grant-group')
  async grantPageGroupAccess(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: GrantPageGroupAccessDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessMutationService.grantGroupAccessForSubtree(
      page,
      dto.groupId,
      dto.role,
      user,
    );

    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { key: 'pageId' })
  @Post(':pageId/actions/access/close-group')
  async closePageGroupAccess(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: ClosePageGroupAccessDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessMutationService.closeGroupAccessForSubtree(
      page,
      dto.groupId,
      user,
    );

    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { key: 'pageId' })
  @Post(':pageId/convert-to-database')
  async convertToDatabase(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(pageId);

    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    const existingDatabase = await this.databaseRepo.findByPageId(
      page.id,
      page.workspaceId,
    );
    if (existingDatabase) {
      throw new BadRequestException('Page is already a database');
    }

    return this.pageService.convertPageToDatabase(page, user.id);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', {
    source: 'body',
    key: 'pageId',
    additionalTargets: [
      { scope: 'space', source: 'body', key: 'spaceId' },
    ],
  })
  @Post('move-to-space')
  async movePageToSpace(
    @Body() dto: MovePageToSpaceDto,
    @AuthUser() user: User,
  ) {
    const movedPage = await this.pageRepo.findById(dto.pageId);
    if (!movedPage) {
      throw new NotFoundException('Page to move not found');
    }
    if (movedPage.spaceId === dto.spaceId) {
      throw new BadRequestException('Page is already in this space');
    }

    await this.pageAccessService.assertCanMoveDeleteShare(movedPage, user);

    const destinationAbility = await this.spaceAbility.createForUser(
      user,
      dto.spaceId,
    );
    if (
      destinationAbility.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)
    ) {
      throw new ForbiddenException();
    }

    return this.pageService.movePageToSpace(movedPage, dto.spaceId);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', {
    source: 'body',
    key: 'pageId',
    additionalTargets: [
      {
        scope: 'space',
        source: 'body',
        key: 'spaceId',
        optional: true,
      },
    ],
  })
  @Post('duplicate')
  async duplicatePage(@Body() dto: DuplicatePageDto, @AuthUser() user: User) {
    const copiedPage = await this.pageRepo.findById(dto.pageId);
    if (!copiedPage) {
      throw new NotFoundException('Page to copy not found');
    }

    // If spaceId is provided, it's a copy to different space
    if (dto.spaceId) {
      await this.pageAccessService.assertCanReadPage(copiedPage, user);

      const targetAbility = await this.spaceAbility.createForUser(
        user,
        dto.spaceId,
      );
      if (targetAbility.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      const duplicatedPage = await this.pageService.duplicatePage(
        copiedPage,
        dto.spaceId,
        user,
      );

      const access = await this.pageAccessService.getEffectiveAccess(
        duplicatedPage,
        user,
      );
      const databaseId = await this.pageService.resolvePageDatabaseId(
        duplicatedPage.id,
        duplicatedPage.workspaceId,
      );
      return {
        ...mapPageResponse(duplicatedPage, { includeCustomFields: true }),
        databaseId,
        access: this.toAccessResponse(access),
      };
    } else {
      // If no spaceId, it's a duplicate in same space
      await this.pageAccessService.assertCanWritePage(copiedPage, user);

      const duplicatedPage = await this.pageService.duplicatePage(
        copiedPage,
        undefined,
        user,
      );

      const access = await this.pageAccessService.getEffectiveAccess(
        duplicatedPage,
        user,
      );
      const databaseId = await this.pageService.resolvePageDatabaseId(
        duplicatedPage.id,
        duplicatedPage.workspaceId,
      );
      return {
        ...mapPageResponse(duplicatedPage, { includeCustomFields: true }),
        databaseId,
        access: this.toAccessResponse(access),
      };
    }
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body', key: 'pageId' })
  @Post('move')
  async movePage(@Body() dto: MovePageDto, @AuthUser() user: User) {
    const movedPage = await this.pageRepo.findById(dto.pageId);
    if (!movedPage || movedPage.deletedAt) {
      throw new NotFoundException('Moved page not found');
    }

    if (dto.parentPageId && dto.parentPageId === dto.pageId) {
      throw new BadRequestException('Page cannot be moved under itself');
    }

    if (dto.parentPageId) {
      const parentPage = await this.pageRepo.findById(dto.parentPageId);
      if (
        !parentPage ||
        parentPage.deletedAt ||
        parentPage.spaceId !== movedPage.spaceId
      ) {
        throw new NotFoundException('Parent page not found');
      }

      await this.pageAccessService.assertCanCreateChild(parentPage, user);
    }

    await this.pageAccessService.assertCanMoveDeleteShare(movedPage, user);

    return this.pageService.movePage(dto, movedPage);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'query', key: 'pageId' })
  @Get('/breadcrumbs')
  async getPageBreadcrumbsViaQuery(
    @Query() dto: PageIdDto,
    @AuthUser() user: User,
  ) {
    return this.getPageBreadcrumbs(dto, user);
  }

  async getPage(@Body() dto: PageInfoDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(dto.pageId, {
      includeSpace: true,
      includeContent: true,
      includeCreator: true,
      includeLastUpdatedBy: true,
      includeContributors: true,
    });

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    const effectiveAccess = await this.pageAccessService.assertCanReadPage(
      page,
      user,
    );

    const linkedDatabase = await this.databaseRepo.findByPageId(
      page.id,
      page.workspaceId,
    );

    if (dto.format && dto.format !== 'json' && page.content) {
      const contentOutput =
        dto.format === 'markdown'
          ? jsonToMarkdown(page.content)
          : jsonToHtml(page.content);
      return {
        ...mapPageResponse(page, { includeCustomFields: true }),
        databaseId: linkedDatabase?.id ?? null,
        content: contentOutput,
        access: this.toAccessResponse(effectiveAccess),
      };
    }

    return {
      ...mapPageResponse(page, { includeCustomFields: true }),
      databaseId: linkedDatabase?.id ?? null,
      access: this.toAccessResponse(effectiveAccess),
    };
  }

  async getBacklinksCount(
    @Body() dto: PageIdDto,
    @AuthUser() user: User,
  ): Promise<{ incoming: number; outgoing: number }> {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);

    return this.backlinkService.countByPageId(page.id, user);
  }

  async getBacklinks(
    @Body() dto: BacklinksListQueryDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);

    return this.backlinkService.findByPageId(page.id, dto.direction, user, dto);
  }

  async create(
    @Body() createPageDto: CreatePageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (createPageDto.parentPageId) {
      const parentPage = await this.pageRepo.findById(
        createPageDto.parentPageId,
      );
      if (!parentPage || parentPage.deletedAt) {
        throw new NotFoundException('Parent page not found');
      }
      if (parentPage.spaceId !== createPageDto.spaceId) {
        throw new BadRequestException('Parent page not found');
      }
      await this.pageAccessService.assertCanCreateChild(parentPage, user);
    } else {
      const ability = await this.spaceAbility.createForUser(
        user,
        createPageDto.spaceId,
      );
      if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }

    const page = await this.pageService.create(
      user.id,
      workspace.id,
      createPageDto,
    );
    const access = await this.pageAccessService.getEffectiveAccess(page, user);

    if (
      createPageDto.format &&
      createPageDto.format !== 'json' &&
      page.content
    ) {
      const contentOutput =
        createPageDto.format === 'markdown'
          ? jsonToMarkdown(page.content)
          : jsonToHtml(page.content);
      return {
        ...mapPageResponse(page),
        content: contentOutput,
        access: this.toAccessResponse(access),
      };
    }

    return {
      ...mapPageResponse(page),
      access: this.toAccessResponse(access),
    };
  }

  async update(@Body() updatePageDto: UpdatePageDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(updatePageDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanWritePage(page, user);

    const updatedPage = await this.pageService.update(
      page,
      updatePageDto,
      user,
    );
    const access = await this.pageAccessService.getEffectiveAccess(
      updatedPage,
      user,
    );

    if (
      updatePageDto.format &&
      updatePageDto.format !== 'json' &&
      updatedPage.content
    ) {
      const contentOutput =
        updatePageDto.format === 'markdown'
          ? jsonToMarkdown(updatedPage.content)
          : jsonToHtml(updatedPage.content);
      return {
        ...mapPageResponse(updatedPage, { includeCustomFields: true }),
        content: contentOutput,
        access: this.toAccessResponse(access),
      };
    }

    return {
      ...mapPageResponse(updatedPage, { includeCustomFields: true }),
      access: this.toAccessResponse(access),
    };
  }

  async delete(
    @Body() deletePageDto: DeletePageDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(deletePageDto.pageId);

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanMoveDeleteShare(page, user);

    if (deletePageDto.permanentlyDelete) {
      // Permanent deletion requires space admin permissions
      const ability = await this.spaceAbility.createForUser(user, page.spaceId);
      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
        throw new ForbiddenException(
          'Only space admins can permanently delete pages',
        );
      }
      await this.pageService.forceDelete(page.id, workspace.id);
    } else {
      await this.pageService.removePage(page.id, user.id, workspace.id);
    }
  }

  async getRecentPages(
    @Body() recentPageDto: RecentPagesQueryDto,
    @AuthUser() user: User,
  ) {
    if (recentPageDto.spaceId) {
      const hasReadablePages =
        await this.pageAccessService.hasAnyReadablePageInSpace(
          user,
          recentPageDto.spaceId,
        );
      if (!hasReadablePages) {
        throw new ForbiddenException();
      }

      const result = await this.pageService.getRecentSpacePages(
        recentPageDto.spaceId,
        recentPageDto,
      );

      const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
        user,
        recentPageDto.spaceId,
      );

      result.items = result.items.filter((page) =>
        snapshot.readablePageIds.has(page.id),
      );

      return result;
    }

    const result = await this.pageService.getRecentPages(
      user.id,
      recentPageDto,
    );
    const accessByPageId =
      await this.pageAccessService.getEffectiveAccessForPages(
        result.items,
        user,
      );

    result.items = result.items.flatMap((page) => {
      const access = accessByPageId.get(page.id);
      if (!access?.capabilities.canRead) {
        return [];
      }

      return [
        {
          ...page,
          access: this.toAccessResponse(access),
        },
      ];
    });

    return result;
  }

  async getDeletedPages(
    @Body() deletedPageDto: DeletedPagesQueryDto,
    @AuthUser() user: User,
  ) {
    if (deletedPageDto.spaceId) {
      const ability = await this.spaceAbility.createForUser(
        user,
        deletedPageDto.spaceId,
      );

      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }

      return this.pageService.getDeletedSpacePages(
        deletedPageDto.spaceId,
        deletedPageDto,
      );
    }
  }

  async getPageHistory(
    @Body() dto: PageHistoryQueryDto,
    @AuthUser() user: User,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);

    return this.pageHistoryService.findHistoryByPageId(page.id, dto);
  }

  async getPageHistoryInfo(
    @Body() dto: PageHistoryIdDto,
    @AuthUser() user: User,
  ) {
    const history = await this.pageHistoryService.findById(dto.historyId);
    if (!history) {
      throw new NotFoundException('Page history not found');
    }

    const page = await this.pageRepo.findById(history.pageId);
    if (page) {
      await this.pageAccessService.assertCanReadPage(page, user);
      return history;
    }

    const ability = await this.spaceAbility.createForUser(
      user,
      history.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return history;
  }

  async getSidebarPages(
    @Body() dto: SidebarPagesQueryDto,
    @AuthUser() user: User,
  ) {
    if (!dto.spaceId && !dto.pageId) {
      throw new BadRequestException(
        'Either spaceId or pageId must be provided',
      );
    }
    let spaceId = dto.spaceId;

    if (dto.pageId) {
      const page = await this.pageRepo.findById(dto.pageId);
      if (!page || page.deletedAt) {
        throw new NotFoundException('Page not found');
      }

      if (dto.spaceId && dto.spaceId !== page.spaceId) {
        throw new BadRequestException(
          'pageId does not belong to the provided spaceId',
        );
      }

      spaceId = page.spaceId;
    }

    const accessSnapshot =
      await this.pageAccessService.getSidebarAccessSnapshot(user, spaceId);

    if (accessSnapshot.readablePageIds.size === 0) {
      throw new ForbiddenException();
    }

    if (dto.pageId && !accessSnapshot.visiblePageIds.has(dto.pageId)) {
      throw new ForbiddenException();
    }

    const sidebarPages = await this.pageService.getSidebarPages(
      spaceId,
      dto,
      dto.pageId,
      dto.includeNodeTypes,
    );

    const visibleItems = sidebarPages.items.filter((node) =>
      accessSnapshot.visiblePageIds.has(node.id),
    );

    return {
      ...sidebarPages,
      items: visibleItems.map((node) => ({
        ...node,
        hasChildren:
          (accessSnapshot.visibleChildrenCountByParentId.get(node.id) ?? 0) > 0,
        customFields: ['page', 'database', 'databaseRow'].includes(
          node.nodeType,
        )
          ? mapPageCustomFields(node)
          : null,
        access: {
          role: accessSnapshot.writablePageIds.has(node.id)
            ? PageRole.WRITER
            : accessSnapshot.readablePageIds.has(node.id)
              ? PageRole.READER
              : null,
          sources: [],
          capabilities: {
            canRead: accessSnapshot.readablePageIds.has(node.id),
            canWrite: accessSnapshot.writablePageIds.has(node.id),
            canCreateChild: accessSnapshot.createChildPageIds.has(node.id),
            canMoveDeleteShare: accessSnapshot.moveDeleteSharePageIds.has(
              node.id,
            ),
            canManageAccess: accessSnapshot.manageAccessPageIds.has(node.id),
          },
          isSystemAccess: this.pageAccessService.isWorkspaceBypassUser(user),
        },
      })),
    };
  }

  async getPageBreadcrumbs(@Body() dto: PageIdDto, @AuthUser() user: User) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.assertCanReadPage(page, user);
    const snapshot = await this.pageAccessService.getSidebarAccessSnapshot(
      user,
      page.spaceId,
    );

    const breadcrumbs = await this.pageService.getPageBreadCrumbs(page.id);
    return breadcrumbs.filter((crumb) => snapshot.visiblePageIds.has(crumb.id));
  }
}
