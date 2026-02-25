import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '../../types/kysely.types';
import {
  InsertablePushSubscription,
  PushSubscription,
} from '@docmost/db/types/entity.types';

@Injectable()
export class PushSubscriptionRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async upsert(
    subscription: InsertablePushSubscription,
  ): Promise<PushSubscription> {
    return this.db
      .insertInto('pushSubscriptions')
      .values(subscription)
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({
          userId: subscription.userId,
          workspaceId: subscription.workspaceId,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          userAgent: subscription.userAgent ?? null,
          lastSeenAt: new Date(),
          revokedAt: null,
          updatedAt: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findActiveByUserId(userId: string): Promise<PushSubscription[]> {
    return this.db
      .selectFrom('pushSubscriptions')
      .selectAll()
      .where('userId', '=', userId)
      .where('revokedAt', 'is', null)
      .execute();
  }

  async revokeByEndpoint(endpoint: string): Promise<void> {
    await this.db
      .updateTable('pushSubscriptions')
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where('endpoint', '=', endpoint)
      .where('revokedAt', 'is', null)
      .execute();
  }

  async revokeByEndpointForUser(endpoint: string, userId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('pushSubscriptions')
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where('endpoint', '=', endpoint)
      .where('userId', '=', userId)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async revokeByIdForUser(id: string, userId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('pushSubscriptions')
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('userId', '=', userId)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }
}
