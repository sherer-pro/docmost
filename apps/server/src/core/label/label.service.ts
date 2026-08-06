import { Injectable, NotFoundException } from '@nestjs/common';
import { Label } from '@docmost/db/types/entity.types';
import { LabelRepo, LabelType } from '@docmost/db/repos/label/label.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { PageAccessService } from '../page-access/page-access.service';
import { normalizeLabelName } from './utils';

@Injectable()
export class LabelService {
  constructor(
    private readonly labelRepo: LabelRepo,
    private readonly pageAccessService: PageAccessService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async addLabelsToPage(
    pageId: string,
    names: string[],
    workspaceId: string,
    spaceId: string,
  ): Promise<Label[]> {
    const attached: Label[] = [];
    const uniqueNames = Array.from(new Set(names.map(normalizeLabelName)));

    await executeTx(this.db, async (trx) => {
      for (const name of uniqueNames) {
        const label = await this.labelRepo.findOrCreate(
          name,
          workspaceId,
          spaceId,
          LabelType.PAGE,
          trx,
        );
        await this.labelRepo.addLabelToPage(pageId, label.id, trx);
        attached.push(label);
      }
    });
    return attached;
  }

  async removeLabelFromPage(
    pageId: string,
    labelId: string,
    workspaceId: string,
    spaceId: string,
  ): Promise<void> {
    await executeTx(this.db, async (trx) => {
      const label = await this.labelRepo.findById(labelId, trx);
      if (
        !label ||
        label.workspaceId !== workspaceId ||
        label.spaceId !== spaceId
      ) {
        throw new NotFoundException('Label not found');
      }

      await this.labelRepo.removeLabelFromPage(
        pageId,
        labelId,
        workspaceId,
        spaceId,
        trx,
      );

      const count = await this.labelRepo.getLabelPageCount(
        labelId,
        workspaceId,
        spaceId,
        trx,
      );
      if (count === 0) {
        await this.labelRepo.deleteLabel(labelId, workspaceId, spaceId, trx);
      }
    });
  }

  async getPageLabels(pageId: string, pagination: PaginationOptions) {
    return this.labelRepo.findLabelsByPageId(pageId, pagination);
  }

  async getLabels(
    workspaceId: string,
    userId: string,
    spaceId: string,
    type: LabelType,
    pagination: PaginationOptions,
  ) {
    return this.labelRepo.findLabels(
      workspaceId,
      userId,
      spaceId,
      type,
      pagination,
    );
  }

  async findPagesByLabel(
    labelId: string,
    user: { id: string; workspaceId: string },
    opts: {
      spaceId?: string;
      query?: string;
      pagination: PaginationOptions;
    },
  ) {
    const result = await this.labelRepo.findPagesByLabelId(labelId, user.id, {
      ...opts,
      workspaceId: user.workspaceId,
    });
    if (result.items.length === 0) {
      return result;
    }

    result.items = (
      await Promise.all(
        result.items.map(async (page) => {
          const access = await this.pageAccessService.getEffectiveAccess(
            {
              ...page,
              workspaceId: user.workspaceId,
              deletedAt: null,
            } as any,
            user as any,
          );
          return access.capabilities.canRead ? page : null;
        }),
      )
    ).filter((page): page is NonNullable<typeof page> => !!page);

    return result;
  }
}
