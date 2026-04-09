import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '../../types/kysely.types';
import {
  InsertableNotification,
  Notification,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder } from 'kysely';
import { DB } from '@docmost/db/types/db';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';

@Injectable()
export class NotificationRepo {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async findById(notificationId: string): Promise<Notification | undefined> {
    return this.db
      .selectFrom('notifications')
      .selectAll('notifications')
      .where('id', '=', notificationId)
      .executeTakeFirst();
  }

  async findByUserId(userId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('notifications')
      .selectAll('notifications')
      .select((eb) => this.withActor(eb))
      .select((eb) => this.withPage(eb))
      .select((eb) => this.withSpace(eb))
      .where('userId', '=', userId)
      .where((eb) =>
        eb.or([
          eb('spaceId', 'is', null),
          eb('spaceId', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(userId)),
        ]),
      );

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'desc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    const result = await this.db
      .selectFrom('notifications')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('userId', '=', userId)
      .where('readAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('spaceId', 'is', null),
          eb('spaceId', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(userId)),
        ]),
      )
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  /**
   * Returns users that currently have unread and unsent notifications.
   * The list is ordered by earliest pending event to preserve fair processing.
   */
  async findPendingEmailDigestUsers(
    limit = 200,
  ): Promise<Array<{ userId: string; workspaceId: string; firstPendingAt: Date | string }>> {
    return this.db
      .selectFrom('notifications')
      .select('userId')
      .select('workspaceId')
      .select((eb) => eb.fn.min('createdAt').as('firstPendingAt'))
      .where('readAt', 'is', null)
      .where('emailedAt', 'is', null)
      .groupBy(['userId', 'workspaceId'])
      .orderBy('firstPendingAt', 'asc')
      .limit(limit)
      .execute() as Promise<
      Array<{ userId: string; workspaceId: string; firstPendingAt: Date | string }>
    >;
  }

  /**
   * Returns unread notifications that have not been emailed yet up to the provided time boundary.
   */
  async findUnreadUnemailedForUserBefore(params: {
    userId: string;
    windowEnd: Date;
  }): Promise<Notification[]> {
    return this.db
      .selectFrom('notifications')
      .selectAll('notifications')
      .select((eb) => this.withActor(eb))
      .select((eb) => this.withPage(eb))
      .select((eb) => this.withSpace(eb))
      .where('userId', '=', params.userId)
      .where('readAt', 'is', null)
      .where('emailedAt', 'is', null)
      .where('createdAt', '<', params.windowEnd)
      .where((eb) =>
        eb.or([
          eb('spaceId', 'is', null),
          eb(
            'spaceId',
            'in',
            this.spaceMemberRepo.getUserSpaceIdsQuery(params.userId),
          ),
        ]),
      )
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * Returns the number of unread notifications for a user
   * within a specific document and time window.
   */
  async countUnreadByUserPageInWindow(params: {
    userId: string;
    pageId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<number> {
    const result = await this.db
      .selectFrom('notifications')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('userId', '=', params.userId)
      .where('pageId', '=', params.pageId)
      .where('readAt', 'is', null)
      .where('createdAt', '>=', params.windowStart)
      .where('createdAt', '<', params.windowEnd)
      .where((eb) =>
        eb.or([
          eb('spaceId', 'is', null),
          eb(
            'spaceId',
            'in',
            this.spaceMemberRepo.getUserSpaceIdsQuery(params.userId),
          ),
        ]),
      )
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  /**
   * Checks that the notification is still unread and belongs to the user.
   */
  async isUnreadForUser(notificationId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('notifications')
      .select('id')
      .where('id', '=', notificationId)
      .where('userId', '=', userId)
      .where('readAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('spaceId', 'is', null),
          eb('spaceId', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(userId)),
        ]),
      )
      .executeTakeFirst();

    return Boolean(result);
  }

  async insert(notification: InsertableNotification): Promise<Notification> {
    return this.db
      .insertInto('notifications')
      .values(notification)
      .returningAll()
      .executeTakeFirst();
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ readAt: new Date() })
      .where('id', '=', notificationId)
      .where('userId', '=', userId)
      .where('readAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('spaceId', 'is', null),
          eb('spaceId', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(userId)),
        ]),
      )
      .execute();
  }

  async markMultipleAsRead(
    notificationIds: string[],
    userId: string,
  ): Promise<void> {
    if (notificationIds.length === 0) {
      return;
    }
    await this.db
      .updateTable('notifications')
      .set({ readAt: new Date() })
      .where('id', 'in', notificationIds)
      .where('userId', '=', userId)
      .where('readAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('spaceId', 'is', null),
          eb('spaceId', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(userId)),
        ]),
      )
      .execute();
  }

  async markAsEmailed(notificationId: string): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ emailedAt: new Date() })
      .where('id', '=', notificationId)
      .where('emailedAt', 'is', null)
      .execute();
  }

  async markMultipleAsEmailed(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) {
      return;
    }

    await this.db
      .updateTable('notifications')
      .set({ emailedAt: new Date() })
      .where('id', 'in', notificationIds)
      .where('emailedAt', 'is', null)
      .execute();
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ readAt: new Date() })
      .where('userId', '=', userId)
      .where('readAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('spaceId', 'is', null),
          eb('spaceId', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(userId)),
        ]),
      )
      .execute();
  }

  withActor(eb: ExpressionBuilder<DB, 'notifications'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'notifications.actorId'),
    ).as('actor');
  }

  withPage(eb: ExpressionBuilder<DB, 'notifications'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('pages')
        .select(['pages.id', 'pages.title', 'pages.slugId', 'pages.icon'])
        .whereRef('pages.id', '=', 'notifications.pageId'),
    ).as('page');
  }

  withSpace(eb: ExpressionBuilder<DB, 'notifications'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('spaces')
        .select(['spaces.id', 'spaces.name', 'spaces.slug'])
        .whereRef('spaces.id', '=', 'notifications.spaceId'),
    ).as('space');
  }
}
