import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { MAX_PAGE_TREE_DEPTH } from '../../../common/config/page-tree.constants';
import { QueueOutboxService } from '../../../integrations/queue/outbox/queue-outbox.service';
import { executeTx } from '@docmost/db/utils';

@Injectable()
export class TrashCleanupService {
  private readonly logger = new Logger(TrashCleanupService.name);
  private readonly RETENTION_DAYS = 30;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly queueOutbox: QueueOutboxService,
  ) {}

  @Interval('trash-cleanup', 24 * 60 * 60 * 1000) // every 24 hours
  async cleanupOldTrash() {
    try {
      this.logger.debug('Starting trash cleanup job');

      const retentionDate = new Date();
      retentionDate.setDate(retentionDate.getDate() - this.RETENTION_DAYS);

      // Get all pages that were deleted more than 30 days ago
      const oldDeletedPages = await this.db
        .selectFrom('pages')
        .select(['id', 'spaceId', 'workspaceId'])
        .where('deletedAt', '<', retentionDate)
        .orderBy('id')
        .limit(100)
        .execute();

      if (oldDeletedPages.length === 0) {
        this.logger.debug('No old trash items to clean up');
        return;
      }

      this.logger.debug(`Found ${oldDeletedPages.length} pages to clean up`);

      // Process each page
      let failedCount = 0;
      for (const page of oldDeletedPages) {
        try {
          await this.cleanupPage(page.id);
        } catch (error) {
          failedCount += 1;
          this.logger.error(
            `Failed to cleanup page ${page.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }

      if (failedCount > 0) {
        throw new Error(`trash_cleanup_incomplete:${failedCount}`);
      }

      this.logger.debug('Trash cleanup job completed');
    } catch (error) {
      this.logger.error(
        'Trash cleanup job failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async cleanupPage(pageId: string) {
    const cleanupEnqueued = await executeTx(this.db, async (trx) => {
      const descendants = await trx
        .withRecursive('page_descendants', (db) =>
          db
            .selectFrom('pages')
            .select(['id', sql<number>`0`.as('level')])
            .where('id', '=', pageId)
            .unionAll((exp) =>
              exp
                .selectFrom('pages as p')
                .select(['p.id', sql<number>`pd.level + 1`.as('level')])
                .innerJoin(
                  'page_descendants as pd',
                  'pd.id',
                  'p.parentPageId',
                )
                .where(sql`pd.level`, '<', sql.lit(MAX_PAGE_TREE_DEPTH)),
            ),
        )
        .selectFrom('page_descendants')
        .select(['id'])
        .execute();
      const pageIds = descendants.map((d) => d.id);
      if (pageIds.length === 0) return false;

      const root = await trx
        .selectFrom('pages')
        .select('workspaceId')
        .where('id', '=', pageId)
        .forUpdate()
        .executeTakeFirst();
      if (!root) return false;

      this.logger.debug(
        `Cleaning up page ${pageId} with ${pageIds.length - 1} descendants`,
      );
      const enqueued = await this.queueOutbox.enqueuePageAttachmentCleanup(
        pageIds,
        pageId,
        root.workspaceId,
        trx,
      );
      if (pageIds.length > 0) {
        await trx.deleteFrom('pages').where('id', 'in', pageIds).execute();
      }
      return enqueued;
    });
    if (cleanupEnqueued) this.queueOutbox.kick();
  }
}
