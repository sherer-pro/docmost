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
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { WatcherRepo } from '@docmost/db/repos/watcher/watcher.repo';
import { PageMentionEmail } from '@docmost/transactional/emails/page-mention-email';
import { PageRecipientEmail } from '@docmost/transactional/emails/page-recipient-email';
import { getPageTitle } from '../../../common/helpers';
import { RecipientResolverService } from './recipient-resolver.service';
import { PushAggregationService } from './push-aggregation.service';

@Injectable()
export class PageNotificationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly notificationService: NotificationService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly watcherRepo: WatcherRepo,
    private readonly recipientResolverService: RecipientResolverService,
    private readonly pushAggregationService: PushAggregationService,
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
    const usersWithAccess =
      await this.spaceMemberRepo.getUserIdsWithSpaceAccess(
        candidateUserIds,
        spaceId,
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
    const { actorId, pageId, spaceId, workspaceId, reason } = data;

    const recipientIds = await this.resolveRecipientIds(data);

    if (recipientIds.length === 0) return;

    const context = await this.getPageContext(actorId, pageId, spaceId, appUrl);
    if (!context) return;

    const { actor, pageTitle, basePageUrl } = context;

    const config = this.getRecipientNotificationConfig(reason, actor.name, pageTitle);

    for (const recipientId of recipientIds) {
      const notification = await this.notificationService.create({
        userId: recipientId,
        workspaceId,
        type: config.notificationType,
        actorId,
        pageId,
        spaceId,
      });

      await this.notificationService.queueEmail(
        recipientId,
        notification.id,
        pageId,
        actorId,
        spaceId,
        config.title,
        config.createEmail({
          actorName: actor.name,
          pageTitle,
          pageUrl: basePageUrl,
        }),
      );

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

    if (reason === 'document-changed' || reason === 'comment-added') {
      const [roleRecipients, watcherIds] = await Promise.all([
        this.recipientResolverService.resolvePageRoleRecipients(
          pageId,
          spaceId,
          actorId,
        ),
        this.watcherRepo.getPageWatcherIds(pageId),
      ]);

      return this.recipientResolverService.filterUsersWithSpaceAccess(
        [...new Set([...roleRecipients, ...watcherIds])],
        spaceId,
        actorId,
      );
    }

    return this.recipientResolverService.filterUsersWithSpaceAccess(
      data.candidateUserIds ?? [],
      spaceId,
      actorId,
    );
  }

  private getRecipientNotificationConfig(
    reason: IPageRecipientNotificationJob['reason'],
    actorName: string,
    pageTitle: string,
  ): {
    notificationType: NotificationType;
    title: string;
    createEmail: (props: {
      actorName: string;
      pageTitle: string;
      pageUrl: string;
    }) => React.JSX.Element;
  } {
    /**
     * Единая конфигурация текста для push и email.
     * Мы используем один источник строки `title`, чтобы формулировки не расходились.
     */
    switch (reason) {
      case 'page-assigned':
        return {
          notificationType: NotificationType.PAGE_ASSIGNED,
          title: `${actorName} assigned you to ${pageTitle}`,
          createEmail: ({ actorName, pageTitle, pageUrl }) =>
            PageRecipientEmail({
              actorName,
              pageTitle,
              pageUrl,
              actionText: 'assigned you to',
            }),
        };
      case 'page-stakeholder-added':
        return {
          notificationType: NotificationType.PAGE_STAKEHOLDER_ADDED,
          title: `${actorName} added you as stakeholder to ${pageTitle}`,
          createEmail: ({ actorName, pageTitle, pageUrl }) =>
            PageRecipientEmail({
              actorName,
              pageTitle,
              pageUrl,
              actionText: 'added you as stakeholder to',
            }),
        };
      case 'comment-added':
        return {
          notificationType: NotificationType.PAGE_UPDATED_FOR_ASSIGNEE_OR_STAKEHOLDER,
          title: `${actorName} added a comment on ${pageTitle}`,
          createEmail: ({ actorName, pageTitle, pageUrl }) =>
            PageRecipientEmail({
              actorName,
              pageTitle,
              pageUrl,
              actionText: 'added a comment on',
            }),
        };
      default:
        return {
          notificationType: NotificationType.PAGE_UPDATED_FOR_ASSIGNEE_OR_STAKEHOLDER,
          title: `${actorName} updated ${pageTitle}`,
          createEmail: ({ actorName, pageTitle, pageUrl }) =>
            PageRecipientEmail({
              actorName,
              pageTitle,
              pageUrl,
              actionText: 'updated',
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
      const notification = await this.notificationService.create({
        userId,
        workspaceId,
        type: NotificationType.PAGE_USER_MENTION,
        actorId,
        pageId,
        spaceId,
        data: { mentionId },
      });

      const pageUrl = `${basePageUrl}`;
      const subject = `${actor.name} mentioned you in ${pageTitle}`;

      await this.notificationService.queueEmail(
        userId,
        notification.id,
        pageId,
        actorId,
        spaceId,
        subject,
        PageMentionEmail({ actorName: actor.name, pageTitle, pageUrl }),
      );

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
