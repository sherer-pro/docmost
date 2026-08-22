import { QueueOutboxHandlerRegistryService } from './queue-outbox-handler-registry.service';
import { QueueOutboxWorkerBindingService } from './queue-outbox-worker-binding.service';
import {
  AttachmentCleanupOutboxHandler,
  FileImportOutboxHandler,
  NotificationEmailDeliveryPolicyHandler,
  PageTemplateSyncOutboxHandler,
} from './queue-outbox.types';

describe('QueueOutboxWorkerBindingService', () => {
  it('binds the API worker handlers to the outbox registry', () => {
    const registry = new QueueOutboxHandlerRegistryService();
    const pageTemplateSync: PageTemplateSyncOutboxHandler = {
      processSyncRunFromOutbox: jest.fn(),
    };
    const notificationEmailDelivery: NotificationEmailDeliveryPolicyHandler = {
      isNotificationEmailStillDeliverable: jest.fn(),
    };
    const attachmentCleanup: AttachmentCleanupOutboxHandler = {
      processCleanupBatchFromOutbox: jest.fn(),
    };
    const fileImport: FileImportOutboxHandler = {
      processImportFromOutbox: jest.fn(),
    };
    const binding = new QueueOutboxWorkerBindingService(
      registry,
      pageTemplateSync,
      notificationEmailDelivery,
      attachmentCleanup,
      fileImport,
    );

    binding.onModuleInit();

    expect(registry.getPageTemplateSync()).toBe(pageTemplateSync);
    expect(registry.getNotificationEmailDelivery()).toBe(
      notificationEmailDelivery,
    );
    expect(registry.getAttachmentCleanup()).toBe(attachmentCleanup);
    expect(registry.getFileImport()).toBe(fileImport);
  });
});
