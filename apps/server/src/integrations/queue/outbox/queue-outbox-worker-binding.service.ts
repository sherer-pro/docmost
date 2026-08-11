import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QueueOutboxHandlerRegistryService } from './queue-outbox-handler-registry.service';
import {
  NOTIFICATION_EMAIL_DELIVERY_POLICY_HANDLER,
  NotificationEmailDeliveryPolicyHandler,
  PAGE_TEMPLATE_SYNC_HANDLER,
  PageTemplateSyncOutboxHandler,
} from './queue-outbox.types';

@Injectable()
export class QueueOutboxWorkerBindingService implements OnModuleInit {
  constructor(
    private readonly registry: QueueOutboxHandlerRegistryService,
    @Inject(PAGE_TEMPLATE_SYNC_HANDLER)
    private readonly pageTemplateSync: PageTemplateSyncOutboxHandler,
    @Inject(NOTIFICATION_EMAIL_DELIVERY_POLICY_HANDLER)
    private readonly notificationEmailDelivery: NotificationEmailDeliveryPolicyHandler,
  ) {}

  onModuleInit(): void {
    this.registry.registerPageTemplateSync(this.pageTemplateSync);
    this.registry.registerNotificationEmailDelivery(
      this.notificationEmailDelivery,
    );
  }
}
