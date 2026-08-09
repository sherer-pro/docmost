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
  ): Promise<boolean> {
    return this.finalize(id, leaseToken, {
      status: QUEUE_OUTBOX_STATUS.FAILED,
      failedAt: new Date(),
      lastErrorCode: errorCode,
      secretPayload: null,
    });
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

  async purgeCompletedBefore(before: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('queueOutbox')
      .where((eb) =>
        eb.or([
          eb.and([
            eb('status', '=', QUEUE_OUTBOX_STATUS.COMPLETED),
            eb('completedAt', '<', before),
          ]),
          eb.and([
            eb('status', '=', QUEUE_OUTBOX_STATUS.CANCELLED),
            eb('cancelledAt', '<', before),
          ]),
        ]),
      )
      .executeTakeFirst();

    return Number(result.numDeletedRows);
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
