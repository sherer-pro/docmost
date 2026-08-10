import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { NotificationRepo } from '@docmost/db/repos/notification/notification.repo';
import { InsertableNotification } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { WsGateway } from '../../ws/ws.gateway';
import { MailService } from '../../integrations/mail/mail.service';
import { NotificationDeliveryPolicyService } from './services/notification-delivery-policy.service';
import { normalizeUserSettings } from '../user/utils/user-preferences.util';
import { PageAccessService } from '../page-access/page-access.service';
import { QueueOutboxService } from '../../integrations/queue/outbox/queue-outbox.service';
import { NotificationEmailSecretPayload } from '../../integrations/queue/outbox/queue-outbox.types';
import { v7 as uuid7 } from 'uuid';

const DEFAULT_EMAIL_FREQUENCY = 'immediate';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notificationRepo: NotificationRepo,
    private readonly wsGateway: WsGateway,
    private readonly mailService: MailService,
    private readonly notificationDeliveryPolicyService: NotificationDeliveryPolicyService,
    private readonly pageAccessService: PageAccessService,
    private readonly queueOutboxService: QueueOutboxService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async create(data: InsertableNotification, deduplicationKey?: string) {
    const notification = await this.notificationRepo.insert(
      deduplicationKey ? { ...data, deduplicationKey } : data,
    );
    if (!notification) {
      return null;
    }

    this.wsGateway.server
      .to(`user-${data.userId}`)
      .emit('notification', { id: notification.id, type: notification.type });

    return notification;
  }

  async createWithImmediateEmail(
    data: InsertableNotification,
    deduplicationKey: string,
    email: { subject: string; template: any },
  ) {
    const notificationId = uuid7();
    const preparedEmail = await this.prepareImmediateEmail(
      data.userId,
      notificationId,
      data.pageId ?? null,
      data.actorId ?? '',
      data.spaceId ?? '',
      email.subject,
      email.template,
    );

    const notification = await this.db.transaction().execute(async (trx) => {
      const inserted = await this.notificationRepo.insert(
        { ...data, id: notificationId, deduplicationKey },
        trx,
      );
      if (!inserted || !preparedEmail) {
        return inserted;
      }
      await this.queueOutboxService.enqueueNotificationEmail(
        inserted.id,
        preparedEmail,
        trx,
      );
      return inserted;
    });
    if (!notification) {
      return null;
    }

    this.wsGateway.server.to(`user-${data.userId}`).emit('notification', {
      id: notification.id,
      type: notification.type,
    });
    if (preparedEmail) {
      this.queueOutboxService.kick();
    }
    return notification;
  }

  async findByUserId(userId: string, pagination: PaginationOptions) {
    const result = await this.notificationRepo.findByUserId(userId, pagination);
    result.items = await this.filterAccessibleNotifications(
      userId,
      result.items,
    );
    return result;
  }

  async getUnreadCount(userId: string) {
    const unread = await this.notificationRepo.findUnreadForUser(userId);
    const accessible = await this.filterAccessibleNotifications(userId, unread);
    return accessible.length;
  }

  async markAsRead(notificationId: string, userId: string) {
    return this.notificationRepo.markAsRead(notificationId, userId);
  }

  async markMultipleAsRead(notificationIds: string[], userId: string) {
    return this.notificationRepo.markMultipleAsRead(notificationIds, userId);
  }

  async markAllAsRead(userId: string) {
    return this.notificationRepo.markAllAsRead(userId);
  }

  async archive(notificationId: string, userId: string) {
    return this.notificationRepo.archive(notificationId, userId);
  }

  async queueEmail(
    userId: string,
    notificationId: string,
    pageId: string | null,
    actorId: string,
    spaceId: string,
    subject: string,
    template: any,
  ) {
    try {
      const message = await this.prepareImmediateEmail(
        userId,
        notificationId,
        pageId,
        actorId,
        spaceId,
        subject,
        template,
      );
      if (message) await this.mailService.sendToQueue(message);
    } catch {
      this.logger.error({ event: 'notification_email_queue_failed' });
    }
  }

  private async prepareImmediateEmail(
    userId: string,
    notificationId: string,
    pageId: string | null,
    actorId: string,
    spaceId: string,
    subject: string,
    template: any,
  ): Promise<NotificationEmailSecretPayload['message'] | undefined> {
    const shouldSend = await this.notificationDeliveryPolicyService.shouldSend({
      channel: 'email',
      userId,
      pageId: pageId ?? undefined,
      actorId: actorId || undefined,
      spaceId: spaceId || undefined,
    });
    if (!shouldSend) return undefined;

    const user = await this.db
      .selectFrom('users')
      .select(['email', 'settings'])
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!user?.email) return undefined;

    const emailFrequency = normalizeUserSettings(user.settings).preferences
      .emailFrequency;
    if (emailFrequency !== DEFAULT_EMAIL_FREQUENCY) return undefined;

    const prepared = await this.mailService.prepareQueueMessage({
      to: user.email,
      subject,
      template,
      notificationId,
      notificationUserId: userId,
      notificationDeliveryMode: 'immediate',
      notificationFrequency: emailFrequency,
    });
    return {
      to: prepared.to,
      subject: prepared.subject,
      text: prepared.text,
      html: prepared.html,
      notificationId,
      notificationUserId: userId,
      notificationDeliveryMode: 'immediate',
      notificationFrequency: emailFrequency,
    };
  }

  async getUserLocale(userId: string): Promise<string> {
    const user = await this.db
      .selectFrom('users')
      .select('locale')
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return user?.locale ?? 'en-US';
  }

  async filterAccessibleNotifications<T extends { pageId?: string | null }>(
    userId: string,
    notifications: T[],
  ): Promise<T[]> {
    const pageIds = [
      ...new Set(
        notifications
          .map((notification) => notification.pageId)
          .filter((pageId): pageId is string => !!pageId),
      ),
    ];

    if (pageIds.length === 0) {
      return notifications;
    }

    const allowedPageIds = new Set<string>();
    await Promise.all(
      pageIds.map(async (pageId) => {
        const allowedUserIds =
          await this.pageAccessService.filterUsersWithPageReadAccess(pageId, [
            userId,
          ]);
        if (allowedUserIds.includes(userId)) {
          allowedPageIds.add(pageId);
        }
      }),
    );

    return notifications.filter(
      (notification) =>
        !notification.pageId || allowedPageIds.has(notification.pageId),
    );
  }
}
