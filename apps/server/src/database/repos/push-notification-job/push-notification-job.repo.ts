import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '../../types/kysely.types';
import {
  InsertablePushNotificationJob,
  PushNotificationJob,
} from '@docmost/db/types/entity.types';

export const PUSH_NOTIFICATION_JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  CANCELLED: 'cancelled',
} as const;

type PushNotificationJobStatus =
  (typeof PUSH_NOTIFICATION_JOB_STATUS)[keyof typeof PUSH_NOTIFICATION_JOB_STATUS];

@Injectable()
export class PushNotificationJobRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * Atomically creates or updates an aggregated record.
   * If the window already exists, increment event count and update payload.
   */
  async upsertPending(job: InsertablePushNotificationJob): Promise<void> {
    await this.db
      .insertInto('pushNotificationJobs')
      .values(job)
      .onConflict((oc) =>
        oc.columns(['userId', 'pageId', 'windowKey']).doUpdateSet({
          workspaceId: job.workspaceId,
          sendAfter: job.sendAfter,
          status: PUSH_NOTIFICATION_JOB_STATUS.PENDING,
          payload: job.payload ?? null,
          idempotencyKey: job.idempotencyKey,
          eventsCount: sql`push_notification_jobs.events_count + 1`,
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  /**
   * Atomically claims due records for processing and sets them to processing.
   */
  async claimDuePending(limit: number): Promise<PushNotificationJob[]> {
    if (limit <= 0) {
      return [];
    }

    return this.db.transaction().execute(async (trx) => {
      const result = await sql<PushNotificationJob>`
        with due as (
          select id
          from push_notification_jobs
          where status = ${PUSH_NOTIFICATION_JOB_STATUS.PENDING}
            and send_after <= now()
          order by send_after asc
          limit ${limit}
          for update skip locked
        )
        update push_notification_jobs as jobs
        set
          status = ${PUSH_NOTIFICATION_JOB_STATUS.PROCESSING},
          updated_at = now()
        from due
        where jobs.id = due.id
        returning jobs.*
      `.execute(trx);

      return result.rows;
    });
  }

  /**
   * Marks records as sent after successful push delivery.
   */
  async finalizeClaimed(params: {
    sentIds: string[];
    cancelledIds: string[];
    retryIds: string[];
  }): Promise<void> {
    const { sentIds, cancelledIds, retryIds } = params;

    await this.db.transaction().execute(async (trx) => {
      await this.updateStatus(trx, sentIds, PUSH_NOTIFICATION_JOB_STATUS.SENT, {
        setSentAt: true,
      });

      await this.updateStatus(
        trx,
        cancelledIds,
        PUSH_NOTIFICATION_JOB_STATUS.CANCELLED,
      );

      if (retryIds.length > 0) {
        await trx
          .updateTable('pushNotificationJobs')
          .set({
            status: PUSH_NOTIFICATION_JOB_STATUS.PENDING,
            updatedAt: new Date(),
            payload: sql`
              coalesce(payload, '{}'::jsonb) || jsonb_build_object(
                'retryMeta',
                jsonb_build_object(
                  'attempts', coalesce((payload->'retryMeta'->>'attempts')::integer, 0) + 1,
                  'lastTransientFailureAt', now()
                )
              )
            `,
          })
          .where('id', 'in', retryIds)
          .where('status', '=', PUSH_NOTIFICATION_JOB_STATUS.PROCESSING)
          .execute();
      }
    });
  }

  /**
   * Centralized status update only for jobs already claimed in processing.
   * This filter adds protection against accidental status overwrite by a competing worker.
   */
  private async updateStatus(
    trx: KyselyDB,
    ids: string[],
    status: PushNotificationJobStatus,
    options?: { setSentAt?: boolean },
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const updateQuery = trx
      .updateTable('pushNotificationJobs')
      .set({
        status,
        updatedAt: new Date(),
        ...(options?.setSentAt ? { sentAt: new Date() } : {}),
      })
      .where('id', 'in', ids)
      .where('status', '=', PUSH_NOTIFICATION_JOB_STATUS.PROCESSING);

    await updateQuery.execute();
  }
}
