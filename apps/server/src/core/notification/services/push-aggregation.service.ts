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
import { NotificationDeliveryPolicyService } from './notification-delivery-policy.service';
import { normalizeUserSettings } from '../../user/utils/user-preferences.util';
import { getAggregatedPushCopy } from '../../../common/helpers/notification-copy';

interface PushDispatchPayload {
  title: string;
  body: string;
  url: string;
  type: string;
  notificationId?: string;
  pageTitle?: string;
}

interface UserPushPreference {
  pushFrequency: string;
  locale: string;
}

const DEFAULT_PUSH_FREQUENCY = 'immediate';
const MAX_AGGREGATED_PUSH_ATTEMPTS = 3;

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
    private readonly notificationDeliveryPolicyService: NotificationDeliveryPolicyService,
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

    if (preferences.pushFrequency === 'immediate' || !notification.pageId) {
      const shouldSend =
        await this.notificationDeliveryPolicyService.shouldSend({
          channel: 'push',
          userId: notification.userId,
          notificationId: payload.notificationId,
          pageId: notification.pageId ?? undefined,
          actorId: notification.actorId,
          spaceId: notification.spaceId,
        });
      if (!shouldSend) {
        return;
      }

      await this.pushService.sendToUser(notification.userId, payload);
      return;
    }

    const windowMs = this.frequencyToMs(preferences.pushFrequency);
    if (!windowMs) {
      const shouldSend =
        await this.notificationDeliveryPolicyService.shouldSend({
          channel: 'push',
          userId: notification.userId,
          notificationId: payload.notificationId,
          pageId: notification.pageId ?? undefined,
          actorId: notification.actorId,
          spaceId: notification.spaceId,
        });
      if (!shouldSend) {
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
      const isPushStillEnabled =
        await this.notificationDeliveryPolicyService.shouldSend({
          channel: 'push',
          userId: item.userId,
          pageId: item.pageId,
        });
      if (!isPushStillEnabled) {
        cancelledIds.push(item.id);
        continue;
      }

      const hasUnreadNotifications =
        await this.hasUnreadNotificationsInWindow(item);
      if (!hasUnreadNotifications) {
        cancelledIds.push(item.id);
        continue;
      }

      const payload = (item.payload ?? {}) as unknown as PushDispatchPayload;
      const pageTitle = payload.pageTitle || payload.body || 'document';
      const eventCount = item.eventsCount ?? 1;
      const preferences = await this.getUserPushPreference(item.userId);
      const copy = getAggregatedPushCopy(
        pageTitle,
        eventCount,
        preferences.locale,
      );

      const pushResult = await this.pushService.sendToUser(item.userId, {
        title: copy.title,
        body: copy.body,
        url: payload.url,
        type: payload.type,
        notificationId: payload.notificationId,
      });

      this.applyDispatchOutcome(
        item,
        pushResult,
        sentIds,
        cancelledIds,
        retryIds,
      );
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
    job: { id: string; payload?: unknown },
    pushResult: PushSendResult,
    sentIds: string[],
    cancelledIds: string[],
    retryIds: string[],
  ): void {
    const jobId = job.id;
    if (pushResult.outcome === 'success') {
      sentIds.push(jobId);
      return;
    }

    if (pushResult.outcome === 'transient-failure') {
      if (
        this.getRetryAttempts(job.payload) + 1 >=
        MAX_AGGREGATED_PUSH_ATTEMPTS
      ) {
        cancelledIds.push(jobId);
        this.logger.warn(
          `Push job ${jobId} cancelled after ${MAX_AGGREGATED_PUSH_ATTEMPTS} transient delivery attempts`,
        );
        return;
      }

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

  private getRetryAttempts(payload: unknown): number {
    if (!payload || typeof payload !== 'object') {
      return 0;
    }

    const retryMeta = (payload as { retryMeta?: unknown }).retryMeta;
    if (!retryMeta || typeof retryMeta !== 'object') {
      return 0;
    }

    const attempts = (retryMeta as { attempts?: unknown }).attempts;
    return typeof attempts === 'number' && Number.isFinite(attempts)
      ? attempts
      : 0;
  }

  /**
   * Checks whether unread document notifications still exist within the aggregation window.
   * If not, the aggregated push should be canceled.
   */
  private async hasUnreadNotificationsInWindow(item: {
    userId: string;
    pageId: string;
    sendAfter: Date | string;
    windowKey: string;
  }): Promise<boolean> {
    const windowMs = this.windowMsFromWindowKey(item.windowKey);
    if (!windowMs) {
      return true;
    }

    const sendAfterDate = new Date(item.sendAfter);
    const windowStart = new Date(sendAfterDate.getTime() - windowMs);

    const unreadCount =
      await this.notificationRepo.countUnreadByUserPageInWindow({
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
  private async getUserPushPreference(
    userId: string,
  ): Promise<UserPushPreference> {
    const user = await this.db
      .selectFrom('users')
      .select(['settings', 'locale'])
      .where('id', '=', userId)
      .executeTakeFirst();

    const settings = normalizeUserSettings(user?.settings);

    return {
      pushFrequency:
        settings.preferences.pushFrequency ?? DEFAULT_PUSH_FREQUENCY,
      locale: user?.locale ?? 'en-US',
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
