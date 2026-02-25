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
    const vapidPrivateKey =
      this.environmentService.getWebPushVapidPrivateKey();

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
  ): Promise<PushSendResult> {
    if (!this.isConfigured) {
      return {
        sent: 0,
        failed: 0,
        revoked: 0,
        outcome: 'disabled',
      };
    }

    const subscriptions = await this.pushSubscriptionRepo.findActiveByUserId(
      userId,
    );

    if (subscriptions.length === 0) {
      return {
        sent: 0,
        failed: 0,
        revoked: 0,
        outcome: 'no-subscriptions',
      };
    }

    let sent = 0;
    let failed = 0;
    let revoked = 0;
    let hasTransientFailures = false;
    let hasFatalFailures = false;

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
          } else {
            hasFatalFailures = true;
          }

          const message = error instanceof Error ? error.message : String(error);

          if (isTransientError) {
            this.logger.warn(
              `Transient push error for endpoint ${subscription.endpoint}: ${message}`,
            );
            return;
          }

          this.logger.error(
            `Fatal push error for endpoint ${subscription.endpoint}: ${message}`,
          );
        }
      }),
    );

    if (failed === 0 && sent > 0) {
      return { sent, failed, revoked, outcome: 'success' };
    }

    if (sent === 0 && failed === 0 && revoked > 0) {
      return { sent, failed, revoked, outcome: 'unrecoverable-failure' };
    }

    if (hasTransientFailures) {
      return { sent, failed, revoked, outcome: 'transient-failure' };
    }

    if (hasFatalFailures) {
      return { sent, failed, revoked, outcome: 'fatal-failure' };
    }

    return { sent, failed, revoked, outcome: 'unrecoverable-failure' };
  }

  private isTransientNetworkError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) {
      return false;
    }

    const networkCode = String(error.code);
    const transientCodes = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'];

    return transientCodes.includes(networkCode);
  }
}
