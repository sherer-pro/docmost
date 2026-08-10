import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { QueueName } from '../../queue/constants';
import { Job } from 'bullmq';
import { MailService } from '../mail.service';
import { MailMessage } from '../interfaces/mail.message';
import { NotificationRepo } from '@docmost/db/repos/notification/notification.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageAccessService } from '../../../core/page-access/page-access.service';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { normalizeUserSettings } from '../../../core/user/utils/user-preferences.util';
import { NotificationEmailDeliveryPolicyHandler } from '../../queue/outbox/queue-outbox.types';

@Processor(QueueName.EMAIL_QUEUE)
export class EmailProcessor
  extends WorkerHost
  implements OnModuleDestroy, NotificationEmailDeliveryPolicyHandler
{
  private readonly logger = new Logger(EmailProcessor.name);
  constructor(
    private readonly mailService: MailService,
    private readonly notificationRepo: NotificationRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {
    super();
  }

  async process(job: Job<MailMessage, void>): Promise<void> {
    if (!(await this.isNotificationEmailStillDeliverable(job.data))) {
      return;
    }

    try {
      await this.mailService.sendEmail(job.data);
    } catch (err) {
      throw err;
    }

    if (job.data.notificationIds?.length) {
      try {
        await this.notificationRepo.markMultipleAsEmailed(
          job.data.notificationIds,
        );
      } catch (err) {
        this.logger.warn('Failed to mark notification batch as emailed');
      }
    }

    if (job.data.notificationId) {
      try {
        await this.notificationRepo.markAsEmailed(job.data.notificationId);
      } catch (err) {
        this.logger.warn('Failed to mark notification as emailed');
      }
    }
  }

  async isNotificationEmailStillDeliverable(
    message: MailMessage,
  ): Promise<boolean> {
    const notificationIds = [
      ...(message.notificationIds ?? []),
      ...(message.notificationId ? [message.notificationId] : []),
    ];

    if (notificationIds.length === 0) {
      return true;
    }

    if (!message.notificationUserId || !message.notificationDeliveryMode) {
      return false;
    }

    const user = await this.db
      .selectFrom('users')
      .select(['email', 'settings'])
      .where('id', '=', message.notificationUserId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .executeTakeFirst();

    if (!user?.email || user.email !== message.to) {
      return false;
    }

    const settings = normalizeUserSettings(user.settings);
    const emailFrequency = settings.preferences.emailFrequency;
    const frequencyMatches =
      message.notificationFrequency != null
        ? emailFrequency === message.notificationFrequency
        : message.notificationDeliveryMode === 'immediate'
          ? emailFrequency === 'immediate'
          : emailFrequency !== 'immediate';
    if (!settings.preferences.emailEnabled || !frequencyMatches) {
      return false;
    }

    const uniqueIds = [...new Set(notificationIds)];
    const notifications = await Promise.all(
      uniqueIds.map((notificationId) =>
        this.notificationRepo.findById(notificationId),
      ),
    );

    if (
      notifications.some(
        (notification) =>
          !notification ||
          notification.userId !== message.notificationUserId ||
          notification.readAt ||
          notification.emailedAt ||
          notification.archivedAt ||
          notification.actorId === message.notificationUserId,
      )
    ) {
      return false;
    }

    const pageIds = [
      ...new Set(
        notifications
          .map((notification) => notification?.pageId)
          .filter((pageId): pageId is string => !!pageId),
      ),
    ];
    for (const pageId of pageIds) {
      const allowedUserIds =
        await this.pageAccessService.filterUsersWithPageReadAccess(pageId, [
          message.notificationUserId,
        ]);
      if (!allowedUserIds.includes(message.notificationUserId)) {
        return false;
      }
    }

    const spaceIdsWithoutPage = [
      ...new Set(
        notifications
          .filter((notification) => notification && !notification.pageId)
          .map((notification) => notification?.spaceId)
          .filter((spaceId): spaceId is string => !!spaceId),
      ),
    ];
    for (const spaceId of spaceIdsWithoutPage) {
      const allowedUserIds =
        await this.spaceMemberRepo.getUserIdsWithSpaceAccess(
          [message.notificationUserId],
          spaceId,
        );
      if (!allowedUserIds.has(message.notificationUserId)) {
        return false;
      }
    }

    return true;
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    this.logger.error({
      event: 'email_queue_job_failed',
      jobName: job.name,
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Completed ${job.name} job`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
