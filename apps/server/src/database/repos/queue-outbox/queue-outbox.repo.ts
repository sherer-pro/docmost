import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import type { JsonValue } from '@docmost/db/types/db';
import {
  QueueOutboxEntry,
  InsertableQueueOutboxEntry,
} from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';

export const QUEUE_OUTBOX_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
} as const;

const DUPLICATE_ATTACHMENT_PIN_INSERT_CHUNK_SIZE = 1_000;

@Injectable()
export class QueueOutboxRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async enqueue(
    entry: {
      kind: string;
      payload: JsonValue;
      secretPayload?: string | null;
      dedupeKey: string;
      availableAt?: Date;
    },
    trx?: KyselyTransaction,
  ): Promise<string | undefined> {
    const db = dbOrTx(this.db, trx);
    const inserted = await db
      .insertInto('queueOutbox')
      .values({
        kind: entry.kind,
        payload: entry.payload,
        secretPayload: entry.secretPayload ?? null,
        dedupeKey: entry.dedupeKey,
        availableAt: entry.availableAt ?? new Date(),
        status: QUEUE_OUTBOX_STATUS.PENDING,
      } satisfies InsertableQueueOutboxEntry)
      .onConflict((oc) => oc.column('dedupeKey').doNothing())
      .returning('id')
      .executeTakeFirst();

    return inserted?.id;
  }

  async pinDuplicatePageAttachments(
    outboxId: string,
    sourceAttachmentIds: string[],
    trx: KyselyTransaction,
  ): Promise<void> {
    const uniqueAttachmentIds = [...new Set(sourceAttachmentIds)];
    if (uniqueAttachmentIds.length === 0) return;

    for (
      let offset = 0;
      offset < uniqueAttachmentIds.length;
      offset += DUPLICATE_ATTACHMENT_PIN_INSERT_CHUNK_SIZE
    ) {
      await trx
        .insertInto('pageDuplicateAttachmentPins')
        .values(
          uniqueAttachmentIds
            .slice(offset, offset + DUPLICATE_ATTACHMENT_PIN_INSERT_CHUNK_SIZE)
            .map((sourceAttachmentId) => ({
              outboxId,
              sourceAttachmentId,
            })),
        )
        .execute();
    }
  }

  async hasDuplicatePageAttachmentPins(
    attachmentIds: string[],
    trx: KyselyTransaction,
  ): Promise<boolean> {
    if (attachmentIds.length === 0) return false;
    const pin = await trx
      .selectFrom('pageDuplicateAttachmentPins')
      .select('sourceAttachmentId')
      .where(
        sql<boolean>`${sql.ref('sourceAttachmentId')} = any(${attachmentIds}::uuid[])`,
      )
      .limit(1)
      .executeTakeFirst();
    return Boolean(pin);
  }

  async claimNext(
    leaseToken: string,
    leaseMs: number,
  ): Promise<QueueOutboxEntry | undefined> {
    const result = await sql<QueueOutboxEntry>`
      with due as (
        select id
        from queue_outbox
        where (
          status = ${QUEUE_OUTBOX_STATUS.PENDING}
          and available_at <= now()
        ) or (
          status = ${QUEUE_OUTBOX_STATUS.PROCESSING}
          and lease_expires_at <= now()
        )
        order by available_at asc, created_at asc
        limit 1
        for update skip locked
      )
      update queue_outbox as entry
      set
        status = ${QUEUE_OUTBOX_STATUS.PROCESSING},
        lease_token = ${leaseToken}::uuid,
        lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
        attempt_count = entry.attempt_count + 1,
        updated_at = now()
      from due
      where entry.id = due.id
      returning entry.*
    `.execute(this.db);

    return result.rows[0];
  }

  async renewLease(
    id: string,
    leaseToken: string,
    leaseMs: number,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('queueOutbox')
      .set({
        leaseExpiresAt: sql`now() + (${leaseMs} * interval '1 millisecond')`,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('status', '=', QUEUE_OUTBOX_STATUS.PROCESSING)
      .where('leaseToken', '=', leaseToken)
      .where('leaseExpiresAt', '>', sql<Date>`now()`)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) === 1;
  }

  async markCompleted(id: string, leaseToken: string): Promise<boolean> {
    return this.finalize(id, leaseToken, {
      status: QUEUE_OUTBOX_STATUS.COMPLETED,
      completedAt: new Date(),
      secretPayload: null,
    });
  }

  async markDuplicatePageAttachmentsCompleted(
    id: string,
    leaseToken: string,
  ): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const finalized = await trx
        .updateTable('queueOutbox')
        .set({
          status: QUEUE_OUTBOX_STATUS.COMPLETED,
          completedAt: new Date(),
          secretPayload: null,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .where('status', '=', QUEUE_OUTBOX_STATUS.PROCESSING)
        .where('leaseToken', '=', leaseToken)
        .returning('id')
        .executeTakeFirst();
      if (!finalized) return false;

      await trx
        .deleteFrom('pageDuplicateAttachmentPins')
        .where('outboxId', '=', id)
        .execute();
      return true;
    });
  }

  async markNotificationEmailCompleted(
    id: string,
    leaseToken: string,
    notificationId: string,
  ): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const finalized = await trx
        .updateTable('queueOutbox')
        .set({
          status: QUEUE_OUTBOX_STATUS.COMPLETED,
          completedAt: new Date(),
          secretPayload: null,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .where('status', '=', QUEUE_OUTBOX_STATUS.PROCESSING)
        .where('leaseToken', '=', leaseToken)
        .returning('id')
        .executeTakeFirst();

      if (!finalized) {
        return false;
      }

      await trx
        .updateTable('notifications')
        .set({ emailedAt: new Date() })
        .where('id', '=', notificationId)
        .where('emailedAt', 'is', null)
        .execute();
      return true;
    });
  }

  async markCancelled(id: string, leaseToken: string): Promise<boolean> {
    return this.finalize(id, leaseToken, {
      status: QUEUE_OUTBOX_STATUS.CANCELLED,
      cancelledAt: new Date(),
      secretPayload: null,
    });
  }

  async markFailed(
    id: string,
    leaseToken: string,
    errorCode: string,
    redactedPayload?: JsonValue,
  ): Promise<boolean> {
    const update: Partial<InsertableQueueOutboxEntry> = {
      status: QUEUE_OUTBOX_STATUS.FAILED,
      failedAt: new Date(),
      lastErrorCode: errorCode,
      secretPayload: null,
    };
    if (redactedPayload !== undefined) {
      update.payload = redactedPayload;
      update.dedupeKey = `failed:${id}`;
    }
    return this.finalize(id, leaseToken, update);
  }

  async markForRetry(
    id: string,
    leaseToken: string,
    availableAt: Date,
    errorCode: string,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('queueOutbox')
      .set({
        status: QUEUE_OUTBOX_STATUS.PENDING,
        availableAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('status', '=', QUEUE_OUTBOX_STATUS.PROCESSING)
      .where('leaseToken', '=', leaseToken)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) === 1;
  }

  async purgeCompletedOrCancelledBefore(
    before: Date,
    limit = 1_000,
  ): Promise<number> {
    const safeLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const result = await sql<{ id: string }>`
      with expired as (
        select id
        from queue_outbox
        where (
          status = 'completed'
          and completed_at < ${before}
        ) or (
          status = 'cancelled'
          and cancelled_at < ${before}
        )
        order by coalesce(completed_at, cancelled_at) asc, id asc
        limit ${safeLimit}
        for update skip locked
      )
      delete from queue_outbox as entry
      using expired
      where entry.id = expired.id
      returning entry.id
    `.execute(this.db);

    return result.rows.length;
  }

  async purgeFailedKindsBefore(
    before: Date,
    kinds: readonly string[],
    limit = 1_000,
  ): Promise<number> {
    if (kinds.length === 0) return 0;
    const safeLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const result = await sql<{ id: string }>`
      with expired as (
        select id
        from queue_outbox
        where status = 'failed'
          and failed_at < ${before}
          and kind::text = any(${kinds}::text[])
        order by failed_at asc, id asc
        limit ${safeLimit}
        for update skip locked
      )
      delete from queue_outbox as entry
      using expired
      where entry.id = expired.id
      returning entry.id
    `.execute(this.db);

    return result.rows.length;
  }

  private async finalize(
    id: string,
    leaseToken: string,
    update: Partial<InsertableQueueOutboxEntry>,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('queueOutbox')
      .set({
        ...update,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('status', '=', QUEUE_OUTBOX_STATUS.PROCESSING)
      .where('leaseToken', '=', leaseToken)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) === 1;
  }
}
