import { QueueOutboxHandlerRegistryService } from './queue-outbox-handler-registry.service';

describe('QueueOutboxHandlerRegistryService', () => {
  it('fails bootstrap when a required handler is missing', () => {
    const registry = new QueueOutboxHandlerRegistryService();
    registry.registerPageTemplateSync({
      processSyncRunFromOutbox: jest.fn(),
    });

    expect(() => registry.onApplicationBootstrap()).toThrow(
      'queue_outbox_notification_email_handler_missing',
    );
  });

  it('accepts the complete handler registry', () => {
    const registry = new QueueOutboxHandlerRegistryService();
    registry.registerPageTemplateSync({
      processSyncRunFromOutbox: jest.fn(),
    });
    registry.registerNotificationEmailDelivery({
      isNotificationEmailStillDeliverable: jest.fn(),
    });

    expect(() => registry.onApplicationBootstrap()).not.toThrow();
  });

  it('rejects replacement of an already registered handler', () => {
    const registry = new QueueOutboxHandlerRegistryService();
    registry.registerPageTemplateSync({
      processSyncRunFromOutbox: jest.fn(),
    });

    expect(() =>
      registry.registerPageTemplateSync({
        processSyncRunFromOutbox: jest.fn(),
      }),
    ).toThrow('queue_outbox_handler_registered_twice');
  });
});
