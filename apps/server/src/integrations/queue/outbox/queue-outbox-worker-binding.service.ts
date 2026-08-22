import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QueueOutboxHandlerRegistryService } from './queue-outbox-handler-registry.service';
import {
  ATTACHMENT_CLEANUP_HANDLER,
  AttachmentCleanupOutboxHandler,
  FILE_IMPORT_OUTBOX_HANDLER,
  FileImportOutboxHandler,
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
    @Inject(ATTACHMENT_CLEANUP_HANDLER)
    private readonly attachmentCleanup: AttachmentCleanupOutboxHandler,
    @Inject(FILE_IMPORT_OUTBOX_HANDLER)
    private readonly fileImport: FileImportOutboxHandler,
  ) {}

  onModuleInit(): void {
    this.registry.registerPageTemplateSync(this.pageTemplateSync);
    this.registry.registerNotificationEmailDelivery(
      this.notificationEmailDelivery,
    );
    this.registry.registerAttachmentCleanup(this.attachmentCleanup);
    this.registry.registerFileImport(this.fileImport);
  }
}
