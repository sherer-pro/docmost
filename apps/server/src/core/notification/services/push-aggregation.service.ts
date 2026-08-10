import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  PUSH_NOTIFICATION_JOB_STATUS,
  ClaimedPushNotificationJobRef,
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
import { PushAggregationMetricsService } from './push-aggregation-metrics.service';

interface PushDispatchPayload {
  title: string;
  body: string;
  url: string;
  type: string;
  notificationId?: string;
  pageTitle?: string;
  actorId?: string | null;
  retryMeta?: {
    attempts?: number;
    subscriptionIds?: string[];
  };
}

interface UserPushPreference {
  pushFrequency: string;
  locale: string;
}

const DEFAULT_PUSH_FREQUENCY = 'immediate';
const MAX_AGGREGATED_PUSH_ATTEMPTS = 3;
const PUSH_PROCESSING_LEASE_MS = 2 * 60_000;
const PUSH_LEASE_RENEW_INTERVAL_MS = 30_000;

@Injectable()
export class PushAggregationService implements OnModuleDestroy {
  private readonly logger = new Logger(PushAggregationService.name);
  private shuttingDown = false;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly pushNotificationJobRepo: PushNotificationJobRepo,
    private readonly notificationRepo: NotificationRepo,
    private readonly pushService: PushService,
    private readonly notificationDeliveryPolicyService: NotificationDeliveryPolicyService,
    private readonly metrics: PushAggregationMetricsService,
  ) {}

  onModuleDestroy(): void {
    this.shuttingDown = true;
  }

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

      const pushResult = await this.pushService.sendToUser(
        notification.userId,
        payload,
      );
      await this.scheduleImmediateRetry(notification, payload, pushResult);
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

      const pushResult = await this.pushService.sendToUser(
        notification.userId,
        payload,
      );
      await this.scheduleImmediateRetry(notification, payload, pushResult);
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
    const startedAt = Date.now();
    const claim = await this.pushNotificationJobRepo.claimDuePending(
      limit,
      PUSH_PROCESSING_LEASE_MS,
    );
    this.metrics.recordClaim(claim.jobs.length, claim.reclaimed);
    if (claim.jobs.length === 0) {
      return;
    }

    const renewal = this.startLeaseRenewal(
      claim.jobs.map((item) => item.id),
      claim.leaseToken,
    );
    const sent: ClaimedPushNotificationJobRef[] = [];
    const cancelled: ClaimedPushNotificationJobRef[] = [];
    const retry: ClaimedPushNotificationJobRef[] = [];

    for (const item of claim.jobs) {
      if (this.shuttingDown || renewal.lost) {
        break;
      }
      const payload = (item.payload ?? {}) as unknown as PushDispatchPayload;
      const isImmediateRetry = item.windowKey.startsWith('immediate:');
      const isPushStillEnabled =
        await this.notificationDeliveryPolicyService.shouldSend({
          channel: 'push',
          userId: item.userId,
          pageId: item.pageId,
          notificationId: isImmediateRetry ? payload.notificationId : undefined,
          actorId: isImmediateRetry
            ? (payload.actorId ?? undefined)
            : undefined,
        });
      if (!isPushStillEnabled) {
        cancelled.push(this.claimedRef(item));
        continue;
      }

      if (!isImmediateRetry) {
        const hasUnreadNotifications =
          await this.hasUnreadNotificationsInWindow(item);
        if (!hasUnreadNotifications) {
          cancelled.push(this.claimedRef(item));
          continue;
        }
      }

      let dispatchPayload: PushDispatchPayload;
      if (isImmediateRetry) {
        dispatchPayload = {
          title: payload.title,
          body: payload.body,
          url: payload.url,
          type: payload.type,
          notificationId: payload.notificationId,
        };
      } else {
        const pageTitle = payload.pageTitle || payload.body || 'document';
        const eventCount = item.eventsCount ?? 1;
        const preferences = await this.getUserPushPreference(item.userId);
        const copy = getAggregatedPushCopy(
          pageTitle,
          eventCount,
          preferences.locale,
        );
        dispatchPayload = {
          title: copy.title,
          body: copy.body,
          url: payload.url,
          type: payload.type,
          notificationId: payload.notificationId,
        };
      }

      const retrySubscriptionIds = this.getRetrySubscriptionIds(item.payload);
      const pushResult = retrySubscriptionIds.length
        ? await this.pushService.sendToUser(item.userId, dispatchPayload, {
            subscriptionIds: retrySubscriptionIds,
          })
        : await this.pushService.sendToUser(item.userId, dispatchPayload);

      this.applyDispatchOutcome(item, pushResult, sent, cancelled, retry);
    }

    await renewal.stop();
    if (this.shuttingDown || renewal.lost) {
      this.metrics.recordLeaseLost();
      this.logger.warn({
        event: 'push_aggregation_lease_lost',
        claimed: claim.jobs.length,
      });
      return;
    }

    const finalized = await this.pushNotificationJobRepo.finalizeClaimed({
      leaseToken: claim.leaseToken,
      sent,
      cancelled,
      retry,
    });
    const durationMs = Date.now() - startedAt;
    this.metrics.recordFinalized(finalized, durationMs);
    this.logger.log({
      event: 'push_aggregation_batch',
      claimed: claim.jobs.length,
      reconciled: claim.reclaimed,
      durationMs,
      ...finalized,
    });
  }

  private async scheduleImmediateRetry(
    notification: Notification,
    payload: PushDispatchPayload,
    pushResult: PushSendResult,
  ): Promise<void> {
    if (
      pushResult.outcome !== 'transient-failure' ||
      pushResult.retrySubscriptionIds.length === 0 ||
      !notification.pageId
    ) {
      return;
    }

    await this.pushNotificationJobRepo.upsertPending({
      userId: notification.userId,
      workspaceId: notification.workspaceId,
      pageId: notification.pageId,
      windowKey: `immediate:${notification.id}`,
      idempotencyKey: `push-immediate:${notification.id}`,
      sendAfter: new Date(),
      status: PUSH_NOTIFICATION_JOB_STATUS.PENDING,
      payload: {
        title: payload.title,
        body: payload.body,
        url: payload.url,
        type: payload.type,
        notificationId: payload.notificationId,
        pageTitle: payload.pageTitle,
        actorId: notification.actorId,
        retryMeta: {
          attempts: 0,
          subscriptionIds: pushResult.retrySubscriptionIds,
        },
      },
    });
  }

  private applyDispatchOutcome(
    job: { id: string; revision: number; payload?: unknown },
    pushResult: PushSendResult,
    sent: ClaimedPushNotificationJobRef[],
    cancelled: ClaimedPushNotificationJobRef[],
    retry: ClaimedPushNotificationJobRef[],
  ): void {
    const ref = this.claimedRef(job);
    if (pushResult.outcome === 'success') {
      sent.push(ref);
      return;
    }

    this.metrics.recordDeliveryFailure();

    if (pushResult.outcome === 'transient-failure') {
      if (
        this.getRetryAttempts(job.payload) + 1 >=
        MAX_AGGREGATED_PUSH_ATTEMPTS
      ) {
        cancelled.push(ref);
        this.logger.warn({
          event: 'push_aggregation_retry_exhausted',
          maxAttempts: MAX_AGGREGATED_PUSH_ATTEMPTS,
        });
        return;
      }

      retry.push(this.claimedRef(job, pushResult.retrySubscriptionIds));
      this.logger.warn({
        event: 'push_aggregation_retry_scheduled',
        failed: pushResult.failed,
        revoked: pushResult.revoked,
      });
      return;
    }

    cancelled.push(ref);
    this.logger.warn({
      event: 'push_aggregation_cancelled',
      outcome: pushResult.outcome,
      sent: pushResult.sent,
      failed: pushResult.failed,
      revoked: pushResult.revoked,
    });
  }

  private claimedRef(
    job: {
      id: string;
      revision: number;
    },
    retrySubscriptionIds?: string[],
  ): ClaimedPushNotificationJobRef {
    return retrySubscriptionIds?.length
      ? { id: job.id, revision: job.revision, retrySubscriptionIds }
      : { id: job.id, revision: job.revision };
  }

  private startLeaseRenewal(
    ids: string[],
    leaseToken: string,
  ): {
    readonly lost: boolean;
    stop: () => Promise<void>;
  } {
    let lost = false;
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let inFlight = Promise.resolve();

    const schedule = () => {
      if (stopped || lost || this.shuttingDown) {
        return;
      }
      timer = setTimeout(() => {
        inFlight = (async () => {
          try {
            const renewed = await this.pushNotificationJobRepo.renewLease(
              ids,
              leaseToken,
              PUSH_PROCESSING_LEASE_MS,
            );
            if (!renewed) {
              lost = true;
              return;
            }
          } catch {
            lost = true;
            return;
          }
          schedule();
        })();
      }, PUSH_LEASE_RENEW_INTERVAL_MS);
      timer.unref?.();
    };

    schedule();

    return {
      get lost() {
        return lost;
      },
      stop: async () => {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
        }
        await inFlight;
      },
    };
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

  private getRetrySubscriptionIds(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const retryMeta = (payload as { retryMeta?: unknown }).retryMeta;
    if (!retryMeta || typeof retryMeta !== 'object') {
      return [];
    }

    const subscriptionIds = (retryMeta as { subscriptionIds?: unknown })
      .subscriptionIds;
    if (!Array.isArray(subscriptionIds)) {
      return [];
    }

    return subscriptionIds.filter(
      (subscriptionId): subscriptionId is string =>
        typeof subscriptionId === 'string' && subscriptionId.length > 0,
    );
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
