import { Injectable } from '@nestjs/common';
import type React from 'react';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  IPageMentionNotificationJob,
  IPageRecipientNotificationJob,
} from '../../../integrations/queue/constants/queue.interface';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../notification.constants';
import { WatcherRepo } from '@docmost/db/repos/watcher/watcher.repo';
import { PageMentionEmail } from '@docmost/transactional/emails/page-mention-email';
import { PageRecipientEmail } from '@docmost/transactional/emails/page-recipient-email';
import { getPageTitle } from '../../../common/helpers';
import { RecipientResolverService } from './recipient-resolver.service';
import { PushAggregationService } from './push-aggregation.service';
import { PageAccessService } from '../../page-access/page-access.service';
import {
  getNotificationActionText,
  getNotificationTitle,
} from '../../../common/helpers/notification-copy';

@Injectable()
export class PageNotificationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly notificationService: NotificationService,
    private readonly watcherRepo: WatcherRepo,
    private readonly recipientResolverService: RecipientResolverService,
    private readonly pushAggregationService: PushAggregationService,
    private readonly pageAccessService: PageAccessService,
  ) {}

  async processPageMention(data: IPageMentionNotificationJob, appUrl: string) {
    const { userMentions, oldMentionedUserIds, pageId, spaceId, workspaceId } =
      data;

    const oldIds = new Set(oldMentionedUserIds);
    const newMentions = userMentions.filter(
      (m) => !oldIds.has(m.userId) && m.creatorId !== m.userId,
    );

    if (newMentions.length === 0) return;

    const candidateUserIds = newMentions.map((m) => m.userId);
    const usersWithAccess = new Set(
      await this.pageAccessService.filterUsersWithPageReadAccess(
        pageId,
        candidateUserIds,
      ),
    );

    const accessibleMentions = newMentions.filter((m) =>
      usersWithAccess.has(m.userId),
    );
    if (accessibleMentions.length === 0) return;

    const mentionsByCreator = new Map<
      string,
      { userId: string; mentionId: string }[]
    >();
    for (const m of accessibleMentions) {
      const list = mentionsByCreator.get(m.creatorId) || [];
      list.push({ userId: m.userId, mentionId: m.mentionId });
      mentionsByCreator.set(m.creatorId, list);
    }

    for (const [actorId, mentions] of mentionsByCreator) {
      await this.notifyMentionedUsers(
        mentions,
        actorId,
        pageId,
        spaceId,
        workspaceId,
        appUrl,
      );
    }
  }

  /**
   * Creates notifications for page roles (assignee/stakeholders)
   * based on the event type.
   */
  async processPageRecipientNotification(
    data: IPageRecipientNotificationJob,
    appUrl: string,
  ) {
    const { actorId, eventId, pageId, spaceId, workspaceId, reason } = data;

    const recipientIds = await this.resolveRecipientIds(data);

    if (recipientIds.length === 0) return;

    const context = await this.getPageContext(actorId, pageId, spaceId, appUrl);
    if (!context) return;

    const { actor, pageTitle, basePageUrl } = context;

    for (const recipientId of recipientIds) {
      const locale = await this.notificationService.getUserLocale(recipientId);
      const config = this.getRecipientNotificationConfig(
        reason,
        actor.name,
        pageTitle,
        locale,
      );
      const notification =
        await this.notificationService.createWithImmediateEmail(
          {
            userId: recipientId,
            workspaceId,
            type: config.notificationType,
            actorId,
            pageId,
            spaceId,
          },
          `page-recipient:${eventId}:${config.notificationType}:${recipientId}`,
          {
            subject: config.title,
            template: config.createEmail({
              actorName: actor.name,
              pageTitle,
              pageUrl: basePageUrl,
              locale,
            }),
          },
        );
      if (!notification) continue;

      await this.pushAggregationService.dispatchOrAggregate(notification, {
        title: config.title,
        body: pageTitle,
        url: basePageUrl,
        type: config.notificationType,
        notificationId: notification.id,
        pageTitle,
      });
    }
  }

  private async resolveRecipientIds(
    data: IPageRecipientNotificationJob,
  ): Promise<string[]> {
    const { actorId, pageId, spaceId, reason } = data;

    if (reason === 'document-changed') {
      const [roleRecipients, watcherIds] = await Promise.all([
        this.recipientResolverService.resolvePageRoleRecipients(
          pageId,
          spaceId,
          actorId,
        ),
        this.watcherRepo.getPageWatcherIds(pageId),
      ]);

      return this.recipientResolverService.filterUsersWithPageAccess(
        [...new Set([...roleRecipients, ...watcherIds])],
        pageId,
        actorId,
      );
    }

    return this.recipientResolverService.filterUsersWithPageAccess(
      data.candidateUserIds ?? [],
      pageId,
      actorId,
    );
  }

  private getRecipientNotificationConfig(
    reason: IPageRecipientNotificationJob['reason'],
    actorName: string,
    pageTitle: string,
    locale: string,
  ): {
    notificationType: NotificationType;
    title: string;
    createEmail: (props: {
      actorName: string;
      pageTitle: string;
      pageUrl: string;
      locale: string;
    }) => React.JSX.Element;
  } {
    /**
     * Unified text configuration for push and email.
     * We use a single title source so wording stays consistent across channels.
     */
    switch (reason) {
      case 'page-assigned':
        return {
          notificationType: NotificationType.PAGE_ASSIGNED,
          title: getNotificationTitle(
            NotificationType.PAGE_ASSIGNED,
            actorName,
            pageTitle,
            locale,
          ),
          createEmail: ({ actorName, pageTitle, pageUrl, locale }) =>
            PageRecipientEmail({
              actorName,
              pageTitle,
              pageUrl,
              locale,
              actionText: getNotificationActionText(
                NotificationType.PAGE_ASSIGNED,
                locale,
              ),
            }),
        };
      case 'page-stakeholder-added':
        return {
          notificationType: NotificationType.PAGE_STAKEHOLDER_ADDED,
          title: getNotificationTitle(
            NotificationType.PAGE_STAKEHOLDER_ADDED,
            actorName,
            pageTitle,
            locale,
          ),
          createEmail: ({ actorName, pageTitle, pageUrl, locale }) =>
            PageRecipientEmail({
              actorName,
              pageTitle,
              pageUrl,
              locale,
              actionText: getNotificationActionText(
                NotificationType.PAGE_STAKEHOLDER_ADDED,
                locale,
              ),
            }),
        };
      case 'database-user-assigned':
        return {
          notificationType: NotificationType.PAGE_USER_MENTION,
          title: getNotificationTitle(
            NotificationType.PAGE_USER_MENTION,
            actorName,
            pageTitle,
            locale,
          ),
          createEmail: ({ actorName, pageTitle, pageUrl, locale }) =>
            PageMentionEmail({ actorName, pageTitle, pageUrl, locale }),
        };
      default:
        return {
          notificationType:
            NotificationType.PAGE_UPDATED_FOR_ASSIGNEE_OR_STAKEHOLDER,
          title: getNotificationTitle(
            NotificationType.PAGE_UPDATED_FOR_ASSIGNEE_OR_STAKEHOLDER,
            actorName,
            pageTitle,
            locale,
          ),
          createEmail: ({ actorName, pageTitle, pageUrl, locale }) =>
            PageRecipientEmail({
              actorName,
              pageTitle,
              pageUrl,
              locale,
              actionText: getNotificationActionText(
                NotificationType.PAGE_UPDATED_FOR_ASSIGNEE_OR_STAKEHOLDER,
                locale,
              ),
            }),
        };
    }
  }

  private async notifyMentionedUsers(
    mentions: { userId: string; mentionId: string }[],
    actorId: string,
    pageId: string,
    spaceId: string,
    workspaceId: string,
    appUrl: string,
  ) {
    const context = await this.getPageContext(actorId, pageId, spaceId, appUrl);
    if (!context) return;

    const { actor, pageTitle, basePageUrl } = context;

    for (const { userId, mentionId } of mentions) {
      const locale = await this.notificationService.getUserLocale(userId);
      const pageUrl = `${basePageUrl}`;
      const subject = getNotificationTitle(
        NotificationType.PAGE_USER_MENTION,
        actor.name,
        pageTitle,
        locale,
      );
      const notification =
        await this.notificationService.createWithImmediateEmail(
          {
            userId,
            workspaceId,
            type: NotificationType.PAGE_USER_MENTION,
            actorId,
            pageId,
            spaceId,
            data: { mentionId },
          },
          `page-mention:${mentionId}:${userId}`,
          {
            subject,
            template: PageMentionEmail({
              actorName: actor.name,
              pageTitle,
              pageUrl,
              locale,
            }),
          },
        );
      if (!notification) continue;

      await this.pushAggregationService.dispatchOrAggregate(notification, {
        title: subject,
        body: pageTitle,
        url: pageUrl,
        type: NotificationType.PAGE_USER_MENTION,
        notificationId: notification.id,
        pageTitle,
      });
    }
  }

  private async getPageContext(
    actorId: string,
    pageId: string,
    spaceId: string,
    appUrl: string,
  ) {
    const [actor, page, space] = await Promise.all([
      this.db
        .selectFrom('users')
        .select(['id', 'name'])
        .where('id', '=', actorId)
        .executeTakeFirst(),
      this.db
        .selectFrom('pages')
        .select(['id', 'title', 'slugId'])
        .where('id', '=', pageId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst(),
      this.db
        .selectFrom('spaces')
        .select(['id', 'slug'])
        .where('id', '=', spaceId)
        .executeTakeFirst(),
    ]);

    if (!actor || !page || !space) {
      return null;
    }

    const basePageUrl = `${appUrl}/s/${space.slug}/p/${page.slugId}`;

    return { actor, pageTitle: getPageTitle(page.title), basePageUrl };
  }
}
