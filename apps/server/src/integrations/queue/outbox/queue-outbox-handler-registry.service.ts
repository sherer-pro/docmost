import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  NotificationEmailDeliveryPolicyHandler,
  PageTemplateSyncOutboxHandler,
} from './queue-outbox.types';

@Injectable()
export class QueueOutboxHandlerRegistryService
  implements OnApplicationBootstrap
{
  private pageTemplateSync?: PageTemplateSyncOutboxHandler;
  private notificationEmailDelivery?: NotificationEmailDeliveryPolicyHandler;

  registerPageTemplateSync(handler: PageTemplateSyncOutboxHandler): void {
    this.assertNotReplaced(this.pageTemplateSync, handler);
    this.pageTemplateSync = handler;
  }

  registerNotificationEmailDelivery(
    handler: NotificationEmailDeliveryPolicyHandler,
  ): void {
    this.assertNotReplaced(this.notificationEmailDelivery, handler);
    this.notificationEmailDelivery = handler;
  }

  getPageTemplateSync(): PageTemplateSyncOutboxHandler {
    if (!this.pageTemplateSync) {
      throw new Error('queue_outbox_page_template_handler_missing');
    }
    return this.pageTemplateSync;
  }

  getNotificationEmailDelivery(): NotificationEmailDeliveryPolicyHandler {
    if (!this.notificationEmailDelivery) {
      throw new Error('queue_outbox_notification_email_handler_missing');
    }
    return this.notificationEmailDelivery;
  }

  onApplicationBootstrap(): void {
    this.getPageTemplateSync();
    this.getNotificationEmailDelivery();
  }

  private assertNotReplaced<T>(current: T | undefined, next: T): void {
    if (current && current !== next) {
      throw new Error('queue_outbox_handler_registered_twice');
    }
  }
}
