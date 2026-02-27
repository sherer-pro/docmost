import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { NotificationRepo } from '@docmost/db/repos/notification/notification.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { KyselyDB } from '@docmost/db/types/kysely.types';

export type NotificationDeliveryChannel = 'push' | 'email';

interface NotificationDeliveryPolicyInput {
  channel: NotificationDeliveryChannel;
  userId: string;
  notificationId?: string;
  pageId?: string;
  actorId?: string;
  spaceId?: string;
}

/**
 * Централизованная policy доставки уведомлений.
 *
 * Для immediate-каналов (email/push immediate) действует единый критерий:
 * не отправляем, если уведомление уже прочитано.
 *
 * Для агрегированного push окна/частота по-прежнему рассчитываются в
 * PushAggregationService, но эта policy остается общей точкой для
 * базовых проверок (предпочтения пользователя, actor self-case,
 * наличие доступа к пространству и unread-критерий immediate).
 */
@Injectable()
export class NotificationDeliveryPolicyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly notificationRepo: NotificationRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  /**
   * Проверяет, нужно ли отправлять уведомление в выбранный канал.
   */
  async shouldSend(input: NotificationDeliveryPolicyInput): Promise<boolean> {
    const { channel, userId, notificationId, actorId, spaceId } = input;

    if (actorId && actorId === userId) {
      return false;
    }

    if (spaceId) {
      const hasAccess = await this.hasSpaceAccess(userId, spaceId);
      if (!hasAccess) {
        return false;
      }
    }

    const preferences = await this.getUserNotificationPreferences(userId);
    const isEnabled =
      channel === 'push' ? preferences.pushEnabled : preferences.emailEnabled;
    if (!isEnabled) {
      return false;
    }

    if (!notificationId) {
      return true;
    }

    return this.notificationRepo.isUnreadForUser(notificationId, userId);
  }

  private async hasSpaceAccess(userId: string, spaceId: string): Promise<boolean> {
    const usersWithAccess = await this.spaceMemberRepo.getUserIdsWithSpaceAccess(
      [userId],
      spaceId,
    );

    return usersWithAccess.has(userId);
  }

  private async getUserNotificationPreferences(userId: string): Promise<{
    pushEnabled: boolean;
    emailEnabled: boolean;
  }> {
    const user = await this.db
      .selectFrom('users')
      .select('settings')
      .where('id', '=', userId)
      .executeTakeFirst();

    const settings = (user?.settings ?? {}) as {
      preferences?: { pushEnabled?: boolean; emailEnabled?: boolean };
    };

    return {
      pushEnabled: settings.preferences?.pushEnabled ?? false,
      emailEnabled: settings.preferences?.emailEnabled ?? true,
    };
  }
}
