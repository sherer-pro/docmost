import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { Notification } from '@docmost/db/types/entity.types';
import { NotificationRepo } from '@docmost/db/repos/notification/notification.repo';
import { MailService } from '../../../integrations/mail/mail.service';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { DomainService } from '../../../integrations/environment/domain.service';
import {
  NotificationDigestEmail,
  NotificationDigestItem,
} from '@docmost/transactional/emails/notification-digest-email';
import { normalizeUserSettings } from '../../user/utils/user-preferences.util';
import { NotificationService } from '../notification.service';
import {
  getDigestIntervalLabel,
  getDigestSubject,
  getNotificationActionText,
} from '../../../common/helpers/notification-copy';

interface UserEmailPreferences {
  email: string | null;
  emailEnabled: boolean;
  emailFrequency: string;
  locale: string;
}

interface NotificationWithContext extends Notification {
  actor?: { name?: string | null };
  page?: { title?: string | null; slugId?: string | null };
  space?: { slug?: string | null };
}

const DEFAULT_EMAIL_FREQUENCY = 'immediate';

@Injectable()
export class EmailAggregationService {
  private readonly logger = new Logger(EmailAggregationService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly notificationRepo: NotificationRepo,
    private readonly mailService: MailService,
    private readonly domainService: DomainService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Schedules periodic processing for aggregated email digests.
   */
  async ensureProcessJobScheduled(): Promise<void> {
    await this.notificationQueue.add(
      QueueJob.EMAIL_AGGREGATION_PROCESS,
      { limit: 200 },
      {
        jobId: QueueJob.EMAIL_AGGREGATION_PROCESS,
        repeat: { every: 60_000 },
        removeOnComplete: true,
        removeOnFail: 10,
      },
    );
  }

  /**
   * Sends digest emails for users with non-immediate email frequency.
   */
  async processDueDigests(limit = 200): Promise<void> {
    const pendingUsers =
      await this.notificationRepo.findPendingEmailDigestUsers(limit);
    if (pendingUsers.length === 0) {
      return;
    }

    for (const pendingUser of pendingUsers) {
      try {
        const preferences = await this.getUserEmailPreferences(
          pendingUser.userId,
        );
        if (!preferences?.email || !preferences.emailEnabled) {
          continue;
        }

        if (preferences.emailFrequency === DEFAULT_EMAIL_FREQUENCY) {
          continue;
        }

        const windowMs = this.frequencyToMs(preferences.emailFrequency);
        if (!windowMs) {
          continue;
        }

        const firstPendingAt = new Date(pendingUser.firstPendingAt).getTime();
        if (Number.isNaN(firstPendingAt)) {
          continue;
        }

        const windowStart = Math.floor(firstPendingAt / windowMs) * windowMs;
        const windowEnd = windowStart + windowMs;

        if (Date.now() < windowEnd) {
          continue;
        }

        const pendingNotifications =
          await this.notificationRepo.findUnreadUnemailedForUserBefore({
            userId: pendingUser.userId,
            windowEnd: new Date(windowEnd),
          });
        const notifications =
          await this.notificationService.filterAccessibleNotifications(
            pendingUser.userId,
            pendingNotifications,
          );

        if (notifications.length === 0) {
          continue;
        }

        const workspaceUrl = await this.getWorkspaceUrl(
          pendingUser.workspaceId,
        );
        const entries = this.buildDigestEntries(
          notifications as NotificationWithContext[],
          workspaceUrl,
          preferences.locale,
        );

        await this.mailService.sendToQueue({
          to: preferences.email,
          subject: getDigestSubject(entries.length, preferences.locale),
          template: NotificationDigestEmail({
            entries,
            totalCount: entries.length,
            intervalLabel: getDigestIntervalLabel(
              preferences.emailFrequency,
              preferences.locale,
            ),
            workspaceUrl,
            locale: preferences.locale,
          }),
          notificationIds: notifications.map((notification) => notification.id),
          notificationUserId: pendingUser.userId,
          notificationDeliveryMode: 'digest',
          notificationFrequency: preferences.emailFrequency,
        });
      } catch {
        this.logger.error({ event: 'email_digest_queue_failed' });
      }
    }

    this.logger.debug('Processed aggregated email digest notifications');
  }

  private async getWorkspaceUrl(workspaceId: string): Promise<string> {
    const workspace = await this.db
      .selectFrom('workspaces')
      .select('hostname')
      .where('id', '=', workspaceId)
      .executeTakeFirst();

    return this.domainService.getUrl(workspace?.hostname ?? undefined);
  }

  private async getUserEmailPreferences(
    userId: string,
  ): Promise<UserEmailPreferences | null> {
    const user = await this.db
      .selectFrom('users')
      .select(['email', 'settings', 'locale'])
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .executeTakeFirst();

    if (!user) {
      return null;
    }

    const settings = normalizeUserSettings(user.settings);

    return {
      email: user.email,
      emailEnabled: settings.preferences.emailEnabled,
      emailFrequency: settings.preferences.emailFrequency,
      locale: user.locale ?? 'en-US',
    };
  }

  private buildDigestEntries(
    notifications: NotificationWithContext[],
    workspaceUrl: string,
    locale: string,
  ): NotificationDigestItem[] {
    return notifications.map((notification) => {
      const actorName = notification.actor?.name ?? 'Someone';
      const pageTitle = notification.page?.title ?? 'Untitled';

      const pageUrl =
        notification.space?.slug && notification.page?.slugId
          ? `${workspaceUrl}/s/${notification.space.slug}/p/${notification.page.slugId}`
          : workspaceUrl;

      return {
        actorName,
        actionText: getNotificationActionText(notification.type, locale),
        pageTitle,
        pageUrl,
      };
    });
  }

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
