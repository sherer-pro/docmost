import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '../../types/kysely.types';
import {
  InsertablePushNotificationJob,
  PushNotificationJob,
} from '@docmost/db/types/entity.types';

@Injectable()
export class PushNotificationJobRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * Атомарно создаёт или обновляет агрегированную запись.
   * Если окно уже существует, увеличиваем счётчик событий и обновляем payload.
   */
  async upsertPending(job: InsertablePushNotificationJob): Promise<void> {
    await this.db
      .insertInto('pushNotificationJobs')
      .values(job)
      .onConflict((oc) =>
        oc.columns(['userId', 'pageId', 'windowKey']).doUpdateSet({
          workspaceId: job.workspaceId,
          sendAfter: job.sendAfter,
          status: 'pending',
          payload: job.payload ?? null,
          idempotencyKey: job.idempotencyKey,
          eventsCount: sql`push_notification_jobs.events_count + 1`,
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  /**
   * Возвращает записи, готовые к отправке.
   */
  async findDuePending(limit: number): Promise<PushNotificationJob[]> {
    return this.db
      .selectFrom('pushNotificationJobs')
      .selectAll()
      .where('status', '=', 'pending')
      .where('sendAfter', '<=', new Date())
      .orderBy('sendAfter', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * Помечает записи отправленными после успешной доставки push.
   */
  async markAsSent(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db
      .updateTable('pushNotificationJobs')
      .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
      .where('id', 'in', ids)
      .execute();
  }

  /**
   * Помечает записи отменёнными, если к моменту отправки не осталось непрочитанных событий.
   */
  async markAsCancelled(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db
      .updateTable('pushNotificationJobs')
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where('id', 'in', ids)
      .execute();
  }
}
