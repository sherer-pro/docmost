import { QueueOutboxBootstrapService } from './queue-outbox-bootstrap.service';

describe('QueueOutboxBootstrapService', () => {
  it('does not block application bootstrap while the database hook is pending', async () => {
    let markDatabaseReady!: () => void;
    const databaseReady = new Promise<void>((resolve) => {
      markDatabaseReady = resolve;
    });
    const databaseReadiness = {
      waitUntilReady: jest.fn(() => databaseReady),
    };
    const queueOutbox = {
      ensurePeriodicSweep: jest.fn().mockResolvedValue(undefined),
      kick: jest.fn(),
    };
    const service = new QueueOutboxBootstrapService(
      databaseReadiness as any,
      queueOutbox as any,
    );

    expect(service.onApplicationBootstrap()).toBeUndefined();
    expect(queueOutbox.ensurePeriodicSweep).not.toHaveBeenCalled();

    markDatabaseReady();
    await databaseReady;
    await Promise.resolve();
    await Promise.resolve();

    expect(queueOutbox.ensurePeriodicSweep).toHaveBeenCalledTimes(1);
    expect(queueOutbox.kick).toHaveBeenCalledTimes(1);
  });
});
