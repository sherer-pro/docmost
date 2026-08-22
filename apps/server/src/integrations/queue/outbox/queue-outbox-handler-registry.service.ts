import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  AttachmentCleanupOutboxHandler,
  FileImportOutboxHandler,
  NotificationEmailDeliveryPolicyHandler,
  PageTemplateSyncOutboxHandler,
} from './queue-outbox.types';

@Injectable()
export class QueueOutboxHandlerRegistryService
  implements OnApplicationBootstrap
{
  private pageTemplateSync?: PageTemplateSyncOutboxHandler;
  private notificationEmailDelivery?: NotificationEmailDeliveryPolicyHandler;
  private attachmentCleanup?: AttachmentCleanupOutboxHandler;
  private fileImport?: FileImportOutboxHandler;

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

  registerAttachmentCleanup(handler: AttachmentCleanupOutboxHandler): void {
    this.assertNotReplaced(this.attachmentCleanup, handler);
    this.attachmentCleanup = handler;
  }

  registerFileImport(handler: FileImportOutboxHandler): void {
    this.assertNotReplaced(this.fileImport, handler);
    this.fileImport = handler;
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

  getAttachmentCleanup(): AttachmentCleanupOutboxHandler {
    if (!this.attachmentCleanup) {
      throw new Error('queue_outbox_attachment_cleanup_handler_missing');
    }
    return this.attachmentCleanup;
  }

  getFileImport(): FileImportOutboxHandler {
    if (!this.fileImport) {
      throw new Error('queue_outbox_file_import_handler_missing');
    }
    return this.fileImport;
  }

  onApplicationBootstrap(): void {
    this.getPageTemplateSync();
    this.getNotificationEmailDelivery();
    this.getAttachmentCleanup();
    this.getFileImport();
  }

  private assertNotReplaced<T>(current: T | undefined, next: T): void {
    if (current && current !== next) {
      throw new Error('queue_outbox_handler_registered_twice');
    }
  }
}
