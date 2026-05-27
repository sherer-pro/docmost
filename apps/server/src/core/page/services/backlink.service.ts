import { Injectable } from '@nestjs/common';
import { BacklinkRepo } from '@docmost/db/repos/backlink/backlink.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { PageAccessService } from '../../page-access/page-access.service';
import { User } from '@docmost/db/types/entity.types';

export type BacklinkDirection = 'incoming' | 'outgoing';

@Injectable()
export class BacklinkService {
  constructor(
    private readonly backlinkRepo: BacklinkRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  async countByPageId(
    pageId: string,
    user: User,
  ): Promise<{ incoming: number; outgoing: number }> {
    const [incomingIds, outgoingIds] = await Promise.all([
      this.accessibleRelatedIds(pageId, 'incoming', user),
      this.accessibleRelatedIds(pageId, 'outgoing', user),
    ]);
    return { incoming: incomingIds.length, outgoing: outgoingIds.length };
  }

  async findByPageId(
    pageId: string,
    direction: BacklinkDirection,
    user: User,
    pagination: PaginationOptions,
  ) {
    const accessibleIds = await this.accessibleRelatedIds(
      pageId,
      direction,
      user,
    );
    return this.backlinkRepo.findPagesByIdsPaginated(accessibleIds, pagination);
  }

  private async accessibleRelatedIds(
    pageId: string,
    direction: BacklinkDirection,
    user: User,
  ): Promise<string[]> {
    const candidateIds = await this.backlinkRepo.findRelatedPageIds(
      pageId,
      direction,
      user.id,
    );

    if (candidateIds.length === 0) {
      return [];
    }

    const pages = await Promise.all(
      candidateIds.map((candidateId) => this.pageRepo.findById(candidateId)),
    );
    const readableIds: string[] = [];

    for (const page of pages) {
      if (!page || page.deletedAt) {
        continue;
      }

      const access = await this.pageAccessService.getEffectiveAccess(page, user);
      if (access.capabilities.canRead) {
        readableIds.push(page.id);
      }
    }

    return readableIds;
  }
}
