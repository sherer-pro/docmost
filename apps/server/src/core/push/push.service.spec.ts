import * as webpush from 'web-push';
import { PushService } from './push.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

describe('PushService', () => {
  const endpoint = 'https://push.example.test/send/push-endpoint-secret-canary';

  const createService = () => {
    const environmentService = {
      getWebPushSubject: jest.fn(() => 'mailto:test@example.test'),
      getWebPushVapidPublicKey: jest.fn(() => 'public-key'),
      getWebPushVapidPrivateKey: jest.fn(() => 'private-key'),
    } as any;
    const pushSubscriptionRepo = {
      findActiveByUserId: jest.fn().mockResolvedValue([
        {
          id: 'subscription-1',
          endpoint,
          p256dh: 'p256dh-secret-canary',
          auth: 'auth-secret-canary',
        },
      ]),
      revokeByEndpoint: jest.fn(),
    } as any;
    const service = new PushService(environmentService, pushSubscriptionRepo);

    return { service, pushSubscriptionRepo };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redacts the endpoint and raw provider failure from logs', async () => {
    const error = Object.assign(
      new Error('provider-error-secret-canary recipient@example.test'),
      { statusCode: 503 },
    );
    jest.mocked(webpush.sendNotification).mockRejectedValue(error);
    const { service } = createService();
    const logger = { warn: jest.fn(), error: jest.fn() };
    (service as any).logger = logger;

    await service.sendToUser('user-1', {
      title: 'Title',
      body: 'Body',
    });

    const serialized = JSON.stringify([
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(serialized).not.toContain('push-endpoint-secret-canary');
    expect(serialized).not.toContain('provider-error-secret-canary');
    expect(serialized).not.toContain('recipient@example.test');
    expect(serialized).toContain('push_delivery_transient_failure');
  });

  it('returns only transiently failed subscription ids for retry', async () => {
    const { service, pushSubscriptionRepo } = createService();
    pushSubscriptionRepo.findActiveByUserId.mockResolvedValue([
      {
        id: 'subscription-1',
        endpoint: 'https://push.example.test/send/one',
        p256dh: 'p256dh-one',
        auth: 'auth-one',
      },
      {
        id: 'subscription-2',
        endpoint: 'https://push.example.test/send/two',
        p256dh: 'p256dh-two',
        auth: 'auth-two',
      },
    ]);
    jest
      .mocked(webpush.sendNotification)
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(
        Object.assign(new Error('temporary'), { statusCode: 503 }),
      );

    await expect(
      service.sendToUser('user-1', { title: 'Title', body: 'Body' }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: 'transient-failure',
        retrySubscriptionIds: ['subscription-2'],
      }),
    );
  });

  it('disables delivery without VAPID configuration', async () => {
    const environmentService = {
      getWebPushSubject: jest.fn(() => undefined),
      getWebPushVapidPublicKey: jest.fn(() => undefined),
      getWebPushVapidPrivateKey: jest.fn(() => undefined),
    } as any;
    const pushSubscriptionRepo = {
      findActiveByUserId: jest.fn(),
      revokeByEndpoint: jest.fn(),
    } as any;
    const service = new PushService(
      environmentService,
      pushSubscriptionRepo,
    );

    await expect(
      service.sendToUser('user-1', { title: 'Title', body: 'Body' }),
    ).resolves.toEqual({
      sent: 0,
      failed: 0,
      revoked: 0,
      outcome: 'disabled',
      retrySubscriptionIds: [],
    });
    expect(pushSubscriptionRepo.findActiveByUserId).not.toHaveBeenCalled();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it.each([404, 410])(
    'revokes an expired subscription after provider status %s',
    async (statusCode) => {
      jest
        .mocked(webpush.sendNotification)
        .mockRejectedValue(Object.assign(new Error('expired'), { statusCode }));
      const { service, pushSubscriptionRepo } = createService();

      await expect(
        service.sendToUser('user-1', { title: 'Title', body: 'Body' }),
      ).resolves.toEqual({
        sent: 0,
        failed: 0,
        revoked: 1,
        outcome: 'unrecoverable-failure',
        retrySubscriptionIds: [],
      });
      expect(pushSubscriptionRepo.revokeByEndpoint).toHaveBeenCalledWith(
        endpoint,
      );
    },
  );
});
