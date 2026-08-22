import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { v7 as uuid7 } from 'uuid';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { StorageService } from '../../../integrations/storage/storage.service';
import type { AttachmentCleanupOutboxHandler } from '../../../integrations/queue/outbox/queue-outbox.types';

const CLEANUP_CHUNK_SIZE = 50;
const CLEANUP_MAX_CHUNKS = 20;
const ITEM_LEASE_MS = 2 * 60 * 1000;
const BATCH_LEASE_MS = 5 * 60 * 1000;
const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface ClaimedCleanupItem {
  id: string;
  filePath: string;
}

@Injectable()
export class AttachmentCleanupService
  implements AttachmentCleanupOutboxHandler
{
  private readonly logger = new Logger(AttachmentCleanupService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
  ) {}

  async processCleanupBatchFromOutbox(batchId: string): Promise<void> {
    const batch = await this.db
      .selectFrom('attachmentCleanupBatches')
      .select(['id', 'status'])
      .where('id', '=', batchId)
      .executeTakeFirst();
    if (!batch || batch.status === 'completed') return;

    const batchLeaseToken = uuid7();
    const claimedBatch = await this.db
      .updateTable('attachmentCleanupBatches')
      .set({
        status: 'processing',
        leaseToken: batchLeaseToken,
        leaseExpiresAt: new Date(Date.now() + BATCH_LEASE_MS),
        updatedAt: new Date(),
      })
      .where('id', '=', batchId)
      .where((eb) =>
        eb.or([
          eb('status', 'in', ['pending', 'failed']),
          eb.and([
            eb('status', '=', 'processing'),
            eb('leaseExpiresAt', '<=', new Date()),
          ]),
        ]),
      )
      .executeTakeFirst();
    if (Number(claimedBatch.numUpdatedRows) !== 1) return;

    await this.db
      .updateTable('attachmentCleanupItems')
      .set({
        status: 'pending',
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('batchId', '=', batchId)
      .where('status', '=', 'failed')
      .execute();
    let failed = false;
    for (let chunk = 0; chunk < CLEANUP_MAX_CHUNKS; chunk += 1) {
      const leaseToken = uuid7();
      const items = await this.claimItems(batchId, leaseToken);
      if (items.length === 0) break;

      const outcomes = await Promise.allSettled(
        items.map(async (item) => {
          await this.storageService.delete(item.filePath);
          const result = await this.db
            .updateTable('attachmentCleanupItems')
            .set({
              status: 'completed',
              completedAt: new Date(),
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
              updatedAt: new Date(),
            })
            .where('id', '=', item.id)
            .where('status', '=', 'processing')
            .where('leaseToken', '=', leaseToken)
            .executeTakeFirst();
          if (Number(result.numUpdatedRows) !== 1) {
            throw new Error('attachment_cleanup_item_lease_lost');
          }
        }),
      );

      for (let index = 0; index < outcomes.length; index += 1) {
        if (outcomes[index].status === 'fulfilled') continue;
        failed = true;
        await this.db
          .updateTable('attachmentCleanupItems')
          .set({
            status: 'failed',
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: 'storage_delete_failed',
            updatedAt: new Date(),
          })
          .where('id', '=', items[index].id)
          .where('leaseToken', '=', leaseToken)
          .execute();
      }

      const renewed = await this.db
        .updateTable('attachmentCleanupBatches')
        .set({
          leaseExpiresAt: new Date(Date.now() + BATCH_LEASE_MS),
          updatedAt: new Date(),
        })
        .where('id', '=', batchId)
        .where('status', '=', 'processing')
        .where('leaseToken', '=', batchLeaseToken)
        .executeTakeFirst();
      if (Number(renewed.numUpdatedRows) !== 1) {
        throw new Error('attachment_cleanup_batch_lease_lost');
      }

      if (failed || items.length < CLEANUP_CHUNK_SIZE) break;
    }

    const counts = await this.db
      .selectFrom('attachmentCleanupItems')
      .select((eb) => [
        eb.fn.countAll<number>().as('total'),
        eb.fn
          .count<number>('id')
          .filterWhere('status', '=', 'completed')
          .as('completed'),
        eb.fn
          .count<number>('id')
          .filterWhere('status', '=', 'failed')
          .as('failed'),
      ])
      .where('batchId', '=', batchId)
      .executeTakeFirstOrThrow();
    const total = Number(counts.total);
    const completed = Number(counts.completed);
    const failedCount = Number(counts.failed);
    const isComplete = total === completed;

    const finalizedBatch = await this.db
      .updateTable('attachmentCleanupBatches')
      .set({
        status: isComplete ? 'completed' : failedCount > 0 ? 'failed' : 'pending',
        completedCount: completed,
        failedCount,
        completedAt: isComplete ? new Date() : null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', batchId)
      .where('status', '=', 'processing')
      .where('leaseToken', '=', batchLeaseToken)
      .executeTakeFirst();
    if (Number(finalizedBatch.numUpdatedRows) !== 1) {
      throw new Error('attachment_cleanup_batch_lease_lost');
    }

    if (!isComplete) {
      this.logger.warn({
        event:
          failedCount > 0
            ? 'attachment_cleanup_batch_incomplete'
            : 'attachment_cleanup_batch_continuation_pending',
        failedCount,
        remainingCount: total - completed,
      });
      if (failedCount > 0) {
        throw new Error('attachment_cleanup_batch_incomplete');
      }
    }
  }

  @Interval('attachment-cleanup-continuation', 15 * 1000)
  async continuePendingBatches(): Promise<void> {
    const batches = await this.db
      .selectFrom('attachmentCleanupBatches')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('status', '=', 'pending'),
          eb.and([
            eb('status', '=', 'processing'),
            eb('leaseExpiresAt', '<=', new Date()),
          ]),
        ]),
      )
      .orderBy('updatedAt')
      .limit(10)
      .execute();

    for (const batch of batches) {
      try {
        await this.processCleanupBatchFromOutbox(batch.id);
      } catch {
        this.logger.warn({ event: 'attachment_cleanup_continuation_failed' });
      }
    }
  }

  private async claimItems(
    batchId: string,
    leaseToken: string,
  ): Promise<ClaimedCleanupItem[]> {
    const result = await sql<ClaimedCleanupItem>`
      with due as (
        select id
        from attachment_cleanup_items
        where batch_id = ${batchId}::uuid
          and (
            status = 'pending'
            or (
              status = 'processing'
              and lease_expires_at <= now()
            )
          )
        order by created_at, id
        limit ${CLEANUP_CHUNK_SIZE}
        for update skip locked
      )
      update attachment_cleanup_items as item
      set
        status = 'processing',
        attempt_count = item.attempt_count + 1,
        lease_token = ${leaseToken}::uuid,
        lease_expires_at = now() + (${ITEM_LEASE_MS} * interval '1 millisecond'),
        updated_at = now()
      from due
      where item.id = due.id
      returning item.id, item.file_path as "filePath"
    `.execute(this.db);
    return result.rows;
  }

  @Interval('attachment-cleanup-retention', 60 * 60 * 1000)
  async purgeCompletedBatches(): Promise<number> {
    const result = await sql<{ id: string }>`
      with expired as (
        select id
        from attachment_cleanup_batches
        where status = 'completed'
          and completed_at < ${new Date(Date.now() - COMPLETED_RETENTION_MS)}
        order by completed_at, id
        limit 1000
      )
      delete from attachment_cleanup_batches as batch
      using expired
      where batch.id = expired.id
      returning batch.id
    `.execute(this.db);
    return result.rows.length;
  }
}
