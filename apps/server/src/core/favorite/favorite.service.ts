import { Injectable } from '@nestjs/common';
import {
  FavoriteRepo,
  FavoriteType,
} from '@docmost/db/repos/favorite/favorite.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { InsertableFavorite, Page } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../page-access/page-access.service';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';

@Injectable()
export class FavoriteService {
  constructor(
    private readonly favoriteRepo: FavoriteRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async getFavoriteIds(
    userId: string,
    workspaceId: string,
    type: FavoriteType,
    spaceId?: string,
  ) {
    const result = await this.favoriteRepo.getFavoriteIds(
      userId,
      workspaceId,
      type,
      spaceId,
    );

    if (result.items.length === 0) {
      return result;
    }

    if (type === FavoriteType.SPACE) {
      const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);
      const spaceSet = new Set(userSpaceIds);
      result.items = result.items.filter((id) => spaceSet.has(id));
    }

    return result;
  }

  async addFavorite(
    userId: string,
    workspaceId: string,
    opts: {
      type: FavoriteType;
      pageId?: string;
      spaceId?: string;
    },
  ): Promise<void> {
    const favorite: InsertableFavorite = {
      userId,
      pageId: opts.pageId ?? null,
      spaceId: opts.spaceId ?? null,
      type: opts.type,
      workspaceId,
    };

    await this.favoriteRepo.insert(favorite);
  }

  async removeFavorite(
    userId: string,
    opts: {
      type: FavoriteType;
      pageId?: string;
      spaceId?: string;
    },
  ): Promise<void> {
    if (opts.type === FavoriteType.PAGE && opts.pageId) {
      await this.favoriteRepo.deleteByUserAndPage(userId, opts.pageId);
    } else if (opts.type === FavoriteType.SPACE && opts.spaceId) {
      await this.favoriteRepo.deleteByUserAndSpace(userId, opts.spaceId);
    }
  }

  async getUserFavorites(
    user: { id: string; workspaceId: string },
    pagination: PaginationOptions,
    type?: FavoriteType,
    spaceId?: string,
  ) {
    const result = await this.favoriteRepo.findUserFavorites(
      user.id,
      user.workspaceId,
      pagination,
      type,
      spaceId,
    );

    if (result.items.length === 0) {
      return result;
    }

    const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
    const spaceSet = new Set(userSpaceIds);

    result.items = (
      await Promise.all(
        result.items.map(async (favorite) => {
          if (favorite.type === FavoriteType.SPACE) {
            return favorite.spaceId && spaceSet.has(favorite.spaceId)
              ? favorite
              : null;
          }

          const page = (favorite as any).page as Page | null;
          if (!page || page.deletedAt) {
            return null;
          }

          const access = await this.pageAccessService.getEffectiveAccess(
            page,
            user as any,
          );

          return access.capabilities.canRead ? favorite : null;
        }),
      )
    ).filter((favorite): favorite is NonNullable<typeof favorite> => !!favorite);

    return result;
  }
}
