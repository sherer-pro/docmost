import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { Page, User, Workspace } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { FavoriteType } from '@docmost/db/repos/favorite/favorite.repo';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PageAccessService } from '../page-access/page-access.service';
import { AddFavoriteDto, RemoveFavoriteDto } from './dto/favorite.dto';
import { FavoriteIdsDto } from './dto/favorite-ids.dto';
import {
  ListFavoritesDto,
  ListFavoritesQueryDto,
} from './dto/list-favorites.dto';
import { FavoriteService } from './favorite.service';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';

@UseGuards(JwtAuthGuard)
@Controller('favorites')
export class FavoriteController {
  constructor(
    private readonly favoriteService: FavoriteService,
    private readonly pageRepo: PageRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'body',
    key: 'spaceId',
    fallbackKey: 'pageId',
    fallbackScope: 'page',
  })
  @Post('add')
  async addFavorite(
    @Body() dto: AddFavoriteDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<void> {
    const resolved = await this.resolveAndValidate(dto, user, workspace.id);

    await this.favoriteService.addFavorite(user.id, workspace.id, {
      type: dto.type,
      pageId: dto.pageId,
      spaceId: dto.type === FavoriteType.SPACE ? resolved.spaceId : undefined,
    });
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'body',
    key: 'spaceId',
    fallbackKey: 'pageId',
    fallbackScope: 'page',
  })
  @Post('remove')
  async removeFavorite(
    @Body() dto: RemoveFavoriteDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<void> {
    await this.resolveAndValidate(dto, user, workspace.id);

    await this.favoriteService.removeFavorite(user.id, {
      type: dto.type,
      pageId: dto.pageId,
      spaceId: dto.spaceId,
    });
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'query',
    key: 'spaceId',
    optional: true,
  })
  @Get('ids')
  async getFavoriteIdsViaQuery(
    @Query() dto: FavoriteIdsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.getFavoriteIds(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', {
    source: 'query',
    key: 'spaceId',
    optional: true,
  })
  @Get()
  async getUserFavoritesViaQuery(
    @Query() query: ListFavoritesQueryDto,
    @AuthUser() user: User,
  ) {
    return this.getUserFavorites(query, user);
  }

  private async resolveAndValidate(
    dto: AddFavoriteDto | RemoveFavoriteDto,
    user: User,
    workspaceId: string,
  ): Promise<{ spaceId: string; page?: Page }> {
    if (dto.type === FavoriteType.PAGE) {
      if (!dto.pageId) {
        throw new BadRequestException('pageId is required');
      }

      const page = await this.pageRepo.findById(dto.pageId);
      if (!page || page.deletedAt) {
        throw new NotFoundException('Page not found');
      }

      await this.pageAccessService.assertCanReadPage(page, user);
      return { spaceId: page.spaceId, page };
    }

    if (dto.type === FavoriteType.SPACE) {
      if (!dto.spaceId) {
        throw new BadRequestException('spaceId is required');
      }

      const space = await this.spaceRepo.findById(dto.spaceId, workspaceId);
      if (!space || space.archivedAt) {
        throw new NotFoundException('Space not found');
      }

      await this.validateSpaceAccess(user.id, space.id);
      return { spaceId: space.id };
    }

    throw new BadRequestException('Invalid favorite type');
  }

  private async validateSpaceAccess(
    userId: string,
    spaceId: string,
  ): Promise<void> {
    const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);
    if (!userSpaceIds.includes(spaceId)) {
      throw new ForbiddenException();
    }
  }

  async getFavoriteIds(
    @Body() dto: FavoriteIdsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.favoriteService.getFavoriteIds(
      user,
      workspace.id,
      dto.type as FavoriteType,
      dto.spaceId,
    );
  }

  async getUserFavorites(
    @Body() dto: ListFavoritesQueryDto,
    @AuthUser() user: User,
  ) {
    return this.favoriteService.getUserFavorites(
      user,
      dto,
      dto.type as FavoriteType | undefined,
      dto.spaceId,
    );
  }
}
