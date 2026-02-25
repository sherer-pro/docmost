import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  PUSH_NOTIFICATION_JOB_STATUS,
  PushNotificationJobRepo,
} from '@docmost/db/repos/push-notification-job/push-notification-job.repo';
import { NotificationRepo } from '@docmost/db/repos/notification/notification.repo';
import { Notification } from '@docmost/db/types/entity.types';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { PushSendResult, PushService } from '../../push/push.service';
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

const DEFAULT_PUSH_ENABLED = false;
const DEFAULT_PUSH_FREQUENCY = 'immediate';

@Injectable()
export class PushAggregationService {
  private readonly logger = new Logger(PushAggregationService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly pushNotificationJobRepo: PushNotificationJobRepo,
    private readonly notificationRepo: NotificationRepo,
    private readonly pushService: PushService,
  ) {}

  /**
   * Schedules a recurring BullMQ job that processes aggregated push notifications.
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
   * Called immediately after an in-app notification is created.
   * Depending on user preferences, sends push immediately
   * or places the event into the aggregation queue.
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
      const canSendImmediate = await this.canSendImmediatePush(
        notification.userId,
        payload.notificationId,
      );
      if (!canSendImmediate) {
        return;
      }

      await this.pushService.sendToUser(notification.userId, payload);
      return;
    }

    const windowMs = this.frequencyToMs(preferences.pushFrequency);
    if (!windowMs) {
      const canSendImmediate = await this.canSendImmediatePush(
        notification.userId,
        payload.notificationId,
      );
      if (!canSendImmediate) {
        return;
      }

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
      status: PUSH_NOTIFICATION_JOB_STATUS.PENDING,
      payload: {
        ...payload,
        pageTitle: payload.pageTitle ?? payload.body,
      },
    });
  }

  /**
   * Atomically claims due records into processing, sends push, and finalizes statuses.
   * With claim semantics via SKIP LOCKED, multiple workers can run in parallel without duplicates.
   */
  async processDueJobs(limit = 200): Promise<void> {
    const dueItems = await this.pushNotificationJobRepo.claimDuePending(limit);
    if (dueItems.length === 0) {
      return;
    }

    const sentIds: string[] = [];
    const cancelledIds: string[] = [];
    const retryIds: string[] = [];

    for (const item of dueItems) {
      const shouldSend = await this.hasUnreadNotificationsInWindow(item);
      if (!shouldSend) {
        cancelledIds.push(item.id);
        continue;
      }

      const payload = (item.payload ?? {}) as unknown as PushDispatchPayload;
      const pageTitle = payload.pageTitle || payload.body || 'document';
      const eventCount = item.eventsCount ?? 1;

      const pushResult = await this.pushService.sendToUser(item.userId, {
        title: `Updates in ${pageTitle}`,
        body: `${eventCount} event(s) in this period`,
        url: payload.url,
        type: payload.type,
        notificationId: payload.notificationId,
      });

      this.applyDispatchOutcome(item.id, pushResult, sentIds, cancelledIds, retryIds);
    }

    await this.pushNotificationJobRepo.finalizeClaimed({
      sentIds,
      cancelledIds,
      retryIds,
    });
    this.logger.debug(
      `Processed ${sentIds.length} aggregated push job(s), cancelled ${cancelledIds.length}, retry queued ${retryIds.length}`,
    );
  }

  private applyDispatchOutcome(
    jobId: string,
    pushResult: PushSendResult,
    sentIds: string[],
    cancelledIds: string[],
    retryIds: string[],
  ): void {
    if (pushResult.outcome === 'success') {
      sentIds.push(jobId);
      return;
    }

    if (pushResult.outcome === 'transient-failure') {
      retryIds.push(jobId);
      this.logger.warn(
        `Push job ${jobId} returned to pending after transient delivery failure (failed=${pushResult.failed}, revoked=${pushResult.revoked})`,
      );
      return;
    }

    cancelledIds.push(jobId);
    this.logger.warn(
      `Push job ${jobId} cancelled with outcome ${pushResult.outcome} (sent=${pushResult.sent}, failed=${pushResult.failed}, revoked=${pushResult.revoked})`,
    );
  }

  /**
   * Allows immediate delivery only when the related notification is still unread.
   */
  private async canSendImmediatePush(
    userId: string,
    notificationId?: string,
  ): Promise<boolean> {
    if (!notificationId) {
      return true;
    }

    return this.notificationRepo.isUnreadForUser(notificationId, userId);
  }

  /**
   * Checks whether unread document notifications still exist within the aggregation window.
   * If not, the aggregated push should be canceled.
   */
  private async hasUnreadNotificationsInWindow(
    item: { userId: string; pageId: string; sendAfter: Date | string; windowKey: string },
  ): Promise<boolean> {
    const windowMs = this.windowMsFromWindowKey(item.windowKey);
    if (!windowMs) {
      return true;
    }

    const sendAfterDate = new Date(item.sendAfter);
    const windowStart = new Date(sendAfterDate.getTime() - windowMs);

    const unreadCount = await this.notificationRepo.countUnreadByUserPageInWindow({
      userId: item.userId,
      pageId: item.pageId,
      windowStart,
      windowEnd: sendAfterDate,
    });

    return unreadCount > 0;
  }

  /**
   * Extracts the window size in milliseconds from a key in the "<frequency>:<iso-date>" format.
   */
  private windowMsFromWindowKey(windowKey: string): number | null {
    const [frequency] = windowKey.split(':', 1);
    if (!frequency) {
      return null;
    }

    return this.frequencyToMs(frequency);
  }

  /**
   * Reads user push preferences from the users.settings JSON field.
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
      pushEnabled: settings.preferences?.pushEnabled ?? DEFAULT_PUSH_ENABLED,
      pushFrequency: settings.preferences?.pushFrequency ?? DEFAULT_PUSH_FREQUENCY,
    };
  }

  /**
   * Converts a textual interval to milliseconds.
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
