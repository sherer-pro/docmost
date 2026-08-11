import { QueueOutboxHandlerRegistryService } from './queue-outbox-handler-registry.service';
import { QueueOutboxWorkerBindingService } from './queue-outbox-worker-binding.service';
import {
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
    const binding = new QueueOutboxWorkerBindingService(
      registry,
      pageTemplateSync,
      notificationEmailDelivery,
    );

    binding.onModuleInit();

    expect(registry.getPageTemplateSync()).toBe(pageTemplateSync);
    expect(registry.getNotificationEmailDelivery()).toBe(
      notificationEmailDelivery,
    );
  });
});
