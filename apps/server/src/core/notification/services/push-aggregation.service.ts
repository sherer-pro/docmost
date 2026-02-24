import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PushNotificationJobRepo } from '@docmost/db/repos/push-notification-job/push-notification-job.repo';
import { Notification } from '@docmost/db/types/entity.types';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { PushService } from '../../push/push.service';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';

interface PushDispatchPayload {
  title: string;
  body: string;
  url: string;
  type: string;
  notificationId?: string;
  pageTitle?: string;
}

interface UserPushPreference {
  pushEnabled: boolean;
  pushFrequency: string;
}

@Injectable()
export class PushAggregationService {
  private readonly logger = new Logger(PushAggregationService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly pushNotificationJobRepo: PushNotificationJobRepo,
    private readonly pushService: PushService,
  ) {}

  /**
   * Планирует периодический BullMQ job, который будет обрабатывать агрегированные push-уведомления.
   */
  async ensureProcessJobScheduled(): Promise<void> {
    await this.notificationQueue.add(
      QueueJob.PUSH_AGGREGATION_PROCESS,
      { limit: 200 },
      {
        jobId: QueueJob.PUSH_AGGREGATION_PROCESS,
        repeat: { every: 60_000 },
        removeOnComplete: true,
        removeOnFail: 10,
      },
    );
  }

  /**
   * Вызывается сразу после создания in-app notification.
   * В зависимости от пользовательских настроек отправляет push сразу
   * или складывает событие в агрегированную очередь.
   */
  async dispatchOrAggregate(
    notification: Notification,
    payload: PushDispatchPayload,
  ): Promise<void> {
    const preferences = await this.getUserPushPreference(notification.userId);
    if (!preferences.pushEnabled) {
      return;
    }

    if (preferences.pushFrequency === 'immediate' || !notification.pageId) {
      await this.pushService.sendToUser(notification.userId, payload);
      return;
    }

    const windowMs = this.frequencyToMs(preferences.pushFrequency);
    if (!windowMs) {
      await this.pushService.sendToUser(notification.userId, payload);
      return;
    }

    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;
    const windowKey = `${preferences.pushFrequency}:${new Date(windowStart).toISOString()}`;

    await this.pushNotificationJobRepo.upsertPending({
      userId: notification.userId,
      workspaceId: notification.workspaceId,
      pageId: notification.pageId,
      windowKey,
      idempotencyKey: `${notification.userId}:${notification.pageId}:${windowKey}`,
      sendAfter: new Date(windowEnd),
      status: 'pending',
      payload: {
        ...payload,
        pageTitle: payload.pageTitle ?? payload.body,
      },
    });
  }

  /**
   * Забирает due-записи, формирует один push на документ и помечает записи отправленными.
   */
  async processDueJobs(limit = 200): Promise<void> {
    const dueItems = await this.pushNotificationJobRepo.findDuePending(limit);
    if (dueItems.length === 0) {
      return;
    }

    const sentIds: string[] = [];

    for (const item of dueItems) {
      const payload = (item.payload ?? {}) as unknown as PushDispatchPayload;
      const pageTitle = payload.pageTitle || payload.body || 'document';
      const eventCount = item.eventsCount ?? 1;

      await this.pushService.sendToUser(item.userId, {
        title: `Updates in ${pageTitle}`,
        body: `${eventCount} event(s) in this period`,
        url: payload.url,
        type: payload.type,
        notificationId: payload.notificationId,
      });

      sentIds.push(item.id);
    }

    await this.pushNotificationJobRepo.markAsSent(sentIds);
    this.logger.debug(`Processed ${sentIds.length} aggregated push job(s)`);
  }

  /**
   * Достаёт пользовательские настройки push из JSON поля users.settings.
   */
  private async getUserPushPreference(userId: string): Promise<UserPushPreference> {
    const user = await this.db
      .selectFrom('users')
      .select('settings')
      .where('id', '=', userId)
      .executeTakeFirst();

    const settings = (user?.settings ?? {}) as {
      preferences?: { pushEnabled?: boolean; pushFrequency?: string };
    };

    return {
      pushEnabled: settings.preferences?.pushEnabled ?? true,
      pushFrequency: settings.preferences?.pushFrequency ?? 'immediate',
    };
  }

  /**
   * Конвертирует строковый интервал в миллисекунды.
   */
  private frequencyToMs(frequency: string): number | null {
    const mapping: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '3h': 3 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };

    return mapping[frequency] ?? null;
  }
}
