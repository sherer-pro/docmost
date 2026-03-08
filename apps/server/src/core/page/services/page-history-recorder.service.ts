import { Injectable } from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageHistoryRepo } from '@docmost/db/repos/page/page-history.repo';
import { Page } from '@docmost/db/types/entity.types';
import {
  IRecordPageHistoryEventInput,
  IRecordPageHistoryEventsInput,
  PAGE_HISTORY_EVENT_VERSION,
  PageHistoryChangeData,
} from './page-history-change.types';

@Injectable()
export class PageHistoryRecorderService {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly pageHistoryRepo: PageHistoryRepo,
  ) {}

  async recordPageEvent(input: IRecordPageHistoryEventInput): Promise<void> {
    await this.recordPageEvents({
      pageIds: [input.pageId],
      changeType: input.changeType,
      changeData: input.changeData,
      actorId: input.actorId,
      contributorIds: input.contributorIds,
      trx: input.trx,
    });
  }

  async recordPageEvents(input: IRecordPageHistoryEventsInput): Promise<void> {
    const uniquePageIds = [...new Set(input.pageIds.filter(Boolean))];

    if (uniquePageIds.length === 0) {
      return;
    }

    const pages = await Promise.all(
      uniquePageIds.map((pageId) =>
        this.pageRepo.findById(pageId, {
          includeContent: true,
          trx: input.trx,
        }),
      ),
    );

    const normalizedChangeData = this.normalizeChangeData(input.changeData);

    for (const page of pages) {
      if (!page) {
        continue;
      }

      await this.insertPageHistory(page, {
        changeType: input.changeType,
        changeData: normalizedChangeData,
        actorId: input.actorId,
        contributorIds: input.contributorIds,
        trx: input.trx,
      });
    }
  }

  private async insertPageHistory(
    page: Page,
    input: {
      changeType: string;
      changeData: PageHistoryChangeData;
      actorId?: string | null;
      contributorIds?: string[] | null;
      trx?: IRecordPageHistoryEventInput['trx'];
    },
  ): Promise<void> {
    await this.pageHistoryRepo.insertPageHistory(
      {
        pageId: page.id,
        slugId: page.slugId,
        title: page.title,
        content: page.content,
        icon: page.icon,
        coverPhoto: page.coverPhoto,
        lastUpdatedById: input.actorId ?? page.lastUpdatedById ?? page.creatorId,
        contributorIds: input.contributorIds ?? page.contributorIds ?? undefined,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
        changeType: input.changeType,
        changeData: input.changeData as never,
      },
      input.trx,
    );
  }

  private normalizeChangeData(
    changeData?: PageHistoryChangeData | null,
  ): PageHistoryChangeData {
    const safeData =
      changeData && typeof changeData === 'object' ? changeData : {};

    return {
      ...safeData,
      eventVersion: PAGE_HISTORY_EVENT_VERSION,
    };
  }
}
