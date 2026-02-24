import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePushSubscriptionDto } from './push-subscription.dto';

/**
 * Прогоняет валидацию DTO в изоляции, чтобы быстро проверить контракт API.
 */
function getErrors(payload: unknown) {
  const instance = plainToInstance(CreatePushSubscriptionDto, payload);
  return validateSync(instance, { forbidUnknownValues: false });
}

describe('CreatePushSubscriptionDto', () => {
  it('accepts a flat payload with top-level p256dh/auth keys', () => {
    const errors = getErrors({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      p256dh: 'p256dh-value',
      auth: 'auth-value',
      userAgent: 'Chrome',
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts payload with subscriptionKeys object without top-level keys', () => {
    const errors = getErrors({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      subscriptionKeys: {
        p256dh: 'p256dh-value',
        auth: 'auth-value',
      },
      userAgent: 'Chrome',
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts payload where subscriptionKeys comes as JSON string', () => {
    const errors = getErrors({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      subscriptionKeys: JSON.stringify({
        p256dh: 'p256dh-value',
        auth: 'auth-value',
      }),
      userAgent: 'Chrome',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects payload without any push keys', () => {
    const errors = getErrors({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
    });

    expect(errors.length).toBeGreaterThan(0);
  });
});
