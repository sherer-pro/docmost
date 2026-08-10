import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { PushSubscriptionRepo } from '@docmost/db/repos/push-subscription/push-subscription.repo';

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  type?: string;
  notificationId?: string;
}

export type PushSendOutcome =
  | 'success'
  | 'transient-failure'
  | 'fatal-failure'
  | 'unrecoverable-failure'
  | 'disabled'
  | 'no-subscriptions';

export interface PushSendResult {
  sent: number;
  failed: number;
  revoked: number;
  outcome: PushSendOutcome;
  retrySubscriptionIds: string[];
}

interface PushSendOptions {
  subscriptionIds?: string[];
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly isConfigured: boolean;

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly pushSubscriptionRepo: PushSubscriptionRepo,
  ) {
    const vapidSubject = this.environmentService.getWebPushSubject();
    const vapidPublicKey = this.environmentService.getWebPushVapidPublicKey();
    const vapidPrivateKey = this.environmentService.getWebPushVapidPrivateKey();

    this.isConfigured = !!(vapidSubject && vapidPublicKey && vapidPrivateKey);

    if (!this.isConfigured) {
      this.logger.warn(
        'Web push is disabled because VAPID environment variables are missing',
      );
      return;
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  }

  async sendToUser(
    userId: string,
    payload: PushPayload,
    options?: PushSendOptions,
  ): Promise<PushSendResult> {
    if (!this.isConfigured) {
      return {
        sent: 0,
        failed: 0,
        revoked: 0,
        outcome: 'disabled',
        retrySubscriptionIds: [],
      };
    }

    const subscriptions = await this.pushSubscriptionRepo.findActiveByUserId(
      userId,
      options?.subscriptionIds,
    );

    if (subscriptions.length === 0) {
      return {
        sent: 0,
        failed: 0,
        revoked: 0,
        outcome: 'no-subscriptions',
        retrySubscriptionIds: [],
      };
    }

    let sent = 0;
    let failed = 0;
    let revoked = 0;
    let hasTransientFailures = false;
    let hasFatalFailures = false;
    const retrySubscriptionIds: string[] = [];

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify(payload),
          );
          sent += 1;
        } catch (error: unknown) {
          const statusCode =
            typeof error === 'object' && error && 'statusCode' in error
              ? Number(error.statusCode)
              : undefined;

          if (statusCode === 404 || statusCode === 410) {
            await this.pushSubscriptionRepo.revokeByEndpoint(
              subscription.endpoint,
            );
            revoked += 1;
            return;
          }

          failed += 1;

          const isTransientError =
            statusCode === 408 ||
            statusCode === 425 ||
            statusCode === 429 ||
            (typeof statusCode === 'number' && statusCode >= 500) ||
            this.isTransientNetworkError(error);

          if (isTransientError) {
            hasTransientFailures = true;
            retrySubscriptionIds.push(subscription.id);
          } else {
            hasFatalFailures = true;
          }

          if (isTransientError) {
            this.logger.warn({
              event: 'push_delivery_transient_failure',
              statusCode: statusCode ?? null,
            });
            return;
          }

          this.logger.error({
            event: 'push_delivery_fatal_failure',
            statusCode: statusCode ?? null,
          });
        }
      }),
    );

    if (failed === 0 && sent > 0) {
      return {
        sent,
        failed,
        revoked,
        outcome: 'success',
        retrySubscriptionIds,
      };
    }

    if (sent === 0 && failed === 0 && revoked > 0) {
      return {
        sent,
        failed,
        revoked,
        outcome: 'unrecoverable-failure',
        retrySubscriptionIds,
      };
    }

    if (hasTransientFailures) {
      return {
        sent,
        failed,
        revoked,
        outcome: 'transient-failure',
        retrySubscriptionIds,
      };
    }

    if (hasFatalFailures) {
      return {
        sent,
        failed,
        revoked,
        outcome: 'fatal-failure',
        retrySubscriptionIds,
      };
    }

    return {
      sent,
      failed,
      revoked,
      outcome: 'unrecoverable-failure',
      retrySubscriptionIds,
    };
  }

  private isTransientNetworkError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) {
      return false;
    }

    const networkCode = String(error.code);
    const transientCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ECONNREFUSED',
    ];

    return transientCodes.includes(networkCode);
  }
}
