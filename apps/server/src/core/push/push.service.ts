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

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.isConfigured) return;

    const subscriptions = await this.pushSubscriptionRepo.findActiveByUserId(
      userId,
    );

    if (subscriptions.length === 0) return;

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
        } catch (error: unknown) {
          const statusCode =
            typeof error === 'object' && error && 'statusCode' in error
              ? Number(error.statusCode)
              : undefined;

          if (statusCode === 404 || statusCode === 410) {
            await this.pushSubscriptionRepo.revokeByEndpoint(
              subscription.endpoint,
            );
            return;
          }

          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to send push notification to endpoint ${subscription.endpoint}: ${message}`,
          );
        }
      }),
    );
  }
}
