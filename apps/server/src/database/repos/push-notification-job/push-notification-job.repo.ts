import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
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

const PUSH_RETRY_BASE_SECONDS = 20;

export interface PushNotificationJobClaim {
  leaseToken: string;
  jobs: PushNotificationJob[];
  reclaimed: number;
}

export interface ClaimedPushNotificationJobRef {
  id: string;
  revision: number;
  retrySubscriptionIds?: string[];
}

export interface PushNotificationFinalizeResult {
  sent: number;
  cancelled: number;
  retried: number;
  superseded: number;
}

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
          status: sql`
            case
              when push_notification_jobs.status = ${PUSH_NOTIFICATION_JOB_STATUS.PROCESSING}
                then push_notification_jobs.status
              else ${PUSH_NOTIFICATION_JOB_STATUS.PENDING}
            end
          `,
          payload: job.payload ?? null,
          idempotencyKey: job.idempotencyKey,
          eventsCount: sql`push_notification_jobs.events_count + 1`,
          revision: sql`push_notification_jobs.revision + 1`,
          leaseToken: sql`
            case
              when push_notification_jobs.status = ${PUSH_NOTIFICATION_JOB_STATUS.PROCESSING}
                then push_notification_jobs.lease_token
              else null
            end
          `,
          leaseExpiresAt: sql`
            case
              when push_notification_jobs.status = ${PUSH_NOTIFICATION_JOB_STATUS.PROCESSING}
                then push_notification_jobs.lease_expires_at
              else null
            end
          `,
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  /**
   * Atomically claims due records for processing and sets them to processing.
   */
  async claimDuePending(
    limit: number,
    leaseMs: number,
  ): Promise<PushNotificationJobClaim> {
    const leaseToken = randomUUID();
    if (limit <= 0) {
      return { leaseToken, jobs: [], reclaimed: 0 };
    }

    const claimed = await this.db.transaction().execute(async (trx) => {
      const result = await sql<
        PushNotificationJob & { wasProcessing: boolean }
      >`
        with due as (
          select id, status = ${PUSH_NOTIFICATION_JOB_STATUS.PROCESSING} as "wasProcessing"
          from push_notification_jobs
          where (
            status = ${PUSH_NOTIFICATION_JOB_STATUS.PENDING}
            and send_after <= now()
          ) or (
            status = ${PUSH_NOTIFICATION_JOB_STATUS.PROCESSING}
            and lease_expires_at <= now()
          )
          order by send_after asc
          limit ${limit}
          for update skip locked
        )
        update push_notification_jobs as jobs
        set
          status = ${PUSH_NOTIFICATION_JOB_STATUS.PROCESSING},
          lease_token = ${leaseToken}::uuid,
          lease_expires_at = now() + (${leaseMs} * interval '1 millisecond'),
          updated_at = now()
        from due
        where jobs.id = due.id
        returning jobs.*, due."wasProcessing"
      `.execute(trx);

      return result.rows;
    });

    return {
      leaseToken,
      jobs: claimed.map(({ wasProcessing: _wasProcessing, ...job }) => job),
      reclaimed: claimed.filter((job) => job.wasProcessing).length,
    };
  }

  async renewLease(
    ids: string[],
    leaseToken: string,
    leaseMs: number,
  ): Promise<boolean> {
    if (ids.length === 0) {
      return true;
    }

    const result = await this.db
      .updateTable('pushNotificationJobs')
      .set({
        leaseExpiresAt: sql`now() + (${leaseMs} * interval '1 millisecond')`,
        updatedAt: new Date(),
      })
      .where('id', 'in', ids)
      .where('status', '=', PUSH_NOTIFICATION_JOB_STATUS.PROCESSING)
      .where('leaseToken', '=', leaseToken)
      .where('leaseExpiresAt', '>', sql<Date>`now()`)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) === ids.length;
  }

  /**
   * Marks records as sent after successful push delivery.
   */
  async finalizeClaimed(params: {
    leaseToken: string;
    sent: ClaimedPushNotificationJobRef[];
    cancelled: ClaimedPushNotificationJobRef[];
    retry: ClaimedPushNotificationJobRef[];
  }): Promise<PushNotificationFinalizeResult> {
    const { leaseToken, sent, cancelled, retry } = params;

    return this.db.transaction().execute(async (trx) => {
      const result: PushNotificationFinalizeResult = {
        sent: 0,
        cancelled: 0,
        retried: 0,
        superseded: 0,
      };

      const all = [...sent, ...cancelled, ...retry];
      for (const item of all) {
        const superseded = await trx
          .updateTable('pushNotificationJobs')
          .set({
            status: PUSH_NOTIFICATION_JOB_STATUS.PENDING,
            leaseToken: null,
            leaseExpiresAt: null,
            sendAfter: sql`least(send_after, now())`,
            updatedAt: new Date(),
          })
          .where('id', '=', item.id)
          .where('status', '=', PUSH_NOTIFICATION_JOB_STATUS.PROCESSING)
          .where('leaseToken', '=', leaseToken)
          .where('revision', '!=', item.revision)
          .executeTakeFirst();

        if (Number(superseded.numUpdatedRows) === 1) {
          result.superseded += 1;
          continue;
        }

        if (sent.some((candidate) => candidate.id === item.id)) {
          result.sent += await this.updateStatus(
            trx,
            item,
            leaseToken,
            PUSH_NOTIFICATION_JOB_STATUS.SENT,
            { setSentAt: true },
          );
          continue;
        }

        if (cancelled.some((candidate) => candidate.id === item.id)) {
          result.cancelled += await this.updateStatus(
            trx,
            item,
            leaseToken,
            PUSH_NOTIFICATION_JOB_STATUS.CANCELLED,
          );
          continue;
        }

        const retried = await trx
          .updateTable('pushNotificationJobs')
          .set({
            status: PUSH_NOTIFICATION_JOB_STATUS.PENDING,
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
            sendAfter: sql`
              now() + (
                ${PUSH_RETRY_BASE_SECONDS} * power(
                  2,
                  coalesce((payload->'retryMeta'->>'attempts')::integer, 0)
                )
              ) * interval '1 second'
            `,
            payload: sql`
              coalesce(payload, '{}'::jsonb) || jsonb_build_object(
                'retryMeta',
                jsonb_build_object(
                  'attempts', coalesce((payload->'retryMeta'->>'attempts')::integer, 0) + 1,
                  'lastTransientFailureAt', now(),
                  'subscriptionIds', ${JSON.stringify(
                    item.retrySubscriptionIds ?? [],
                  )}::jsonb
                )
              )
            `,
          })
          .where('id', '=', item.id)
          .where('status', '=', PUSH_NOTIFICATION_JOB_STATUS.PROCESSING)
          .where('leaseToken', '=', leaseToken)
          .where('revision', '=', item.revision)
          .executeTakeFirst();
        result.retried += Number(retried.numUpdatedRows);
      }

      return result;
    });
  }

  /**
   * Centralized status update only for jobs already claimed in processing.
   * This filter adds protection against accidental status overwrite by a competing worker.
   */
  private async updateStatus(
    trx: KyselyDB,
    item: ClaimedPushNotificationJobRef,
    leaseToken: string,
    status: PushNotificationJobStatus,
    options?: { setSentAt?: boolean },
  ): Promise<number> {
    const updateQuery = trx
      .updateTable('pushNotificationJobs')
      .set({
        status,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
        ...(options?.setSentAt ? { sentAt: new Date() } : {}),
      })
      .where('id', '=', item.id)
      .where('status', '=', PUSH_NOTIFICATION_JOB_STATUS.PROCESSING)
      .where('leaseToken', '=', leaseToken)
      .where('revision', '=', item.revision);

    const result = await updateQuery.executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
