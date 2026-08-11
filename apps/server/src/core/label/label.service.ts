import { Injectable, NotFoundException } from '@nestjs/common';
import { Label, User } from '@docmost/db/types/entity.types';
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
    user: User,
    spaceId: string,
    type: LabelType,
    pagination: PaginationOptions,
  ) {
    const accessSnapshot =
      await this.pageAccessService.getSidebarAccessSnapshot(user, spaceId);

    return this.labelRepo.findLabels(
      workspaceId,
      spaceId,
      type,
      accessSnapshot.readablePageIds,
      pagination,
    );
  }

  async findPagesByLabel(
    labelId: string,
    user: User,
    opts: {
      spaceId?: string;
      query?: string;
      pagination: PaginationOptions;
    },
  ) {
    const readablePageIds = opts.spaceId
      ? (
          await this.pageAccessService.getSidebarAccessSnapshot(
            user,
            opts.spaceId,
          )
        ).readablePageIds
      : undefined;
    const result = await this.labelRepo.findPagesByLabelId(labelId, user.id, {
      ...opts,
      workspaceId: user.workspaceId,
      readablePageIds,
    });
    return result;
  }
}
