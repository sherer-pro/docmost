import * as https from 'node:https';
import { EventEmitter } from 'node:events';
import * as webpush from 'web-push';
import { createECDH, randomBytes } from 'node:crypto';
import {
  PushTransportService,
  PUSH_DEADLINE_MS,
  PUSH_MAX_RESPONSE_BYTES,
} from './push-transport.service';

jest.mock('node:https', () => ({ request: jest.fn() }));

describe('Bounded push transport', () => {
  const endpoint = 'https://push.example.test/send/private-capability';
  const ecdh = createECDH('prime256v1');
  const subscription = {
    endpoint,
    keys: {
      p256dh: ecdh.generateKeys().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
  const policy = { assertAllowed: jest.fn() };
  let responses: any[];
  let requests: any[];
  beforeEach(() => {
    jest.clearAllMocks();
    responses = [];
    requests = [];
    const vapid = webpush.generateVAPIDKeys();
    webpush.setVapidDetails(
      'mailto:audit@example.test',
      vapid.publicKey,
      vapid.privateKey,
    );
    policy.assertAllowed.mockResolvedValue({
      url: new URL(endpoint),
      address: '8.8.8.8',
      family: 4,
    });
    jest.mocked(https.request).mockImplementation(((
      _url,
      options,
      callback,
    ) => {
      const response: any = new EventEmitter();
      response.statusCode = 201;
      response.destroy = (error) => {
        response.emit('aborted');
        response.emit('error', error);
      };
      const request: any = new EventEmitter();
      request.destroy = (error) => request.emit('error', error);
      request.end = jest.fn(() => callback(response));
      options.signal.addEventListener(
        'abort',
        () => request.destroy(options.signal.reason),
        { once: true },
      );
      responses.push(response);
      requests.push(request);
      return request;
    }) as any);
  });
  afterEach(() => jest.useRealTimers());
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };

  it('uses a pinned address with original TLS hostname and real encrypted VAPID payload', async () => {
    const send = new PushTransportService(policy as any).send(
      subscription,
      'private-message',
    );
    await flush();
    const [url, options] = (https.request as jest.Mock).mock.calls[0];
    expect(url.hostname).toBe('push.example.test');
    expect(options.agent).toBe(false);
    expect(options.rejectUnauthorized).not.toBe(false);
    const callback = jest.fn();
    options.lookup(url.hostname, { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '8.8.8.8', family: 4 },
    ]);
    expect(options.headers.Authorization).toContain('vapid');
    expect(
      requests[0].end.mock.calls[0][0].includes(Buffer.from('private-message')),
    ).toBe(false);
    responses[0].emit('end');
    await expect(send).resolves.toBeUndefined();
  });
  it.each([302, 404, 410, 429, 503])(
    'returns provider status %s without following redirects',
    async (statusCode) => {
      const send = new PushTransportService(policy as any).send(
        subscription,
        'message',
      );
      const outcome = expect(send).rejects.toMatchObject({ statusCode });
      await flush();
      responses[0].statusCode = statusCode;
      responses[0].emit('end');
      await outcome;
      expect(https.request).toHaveBeenCalledTimes(1);
    },
  );
  it('aborts an oversized response without buffering it', async () => {
    const send = new PushTransportService(policy as any).send(
      subscription,
      'message',
    );
    const outcome = expect(send).rejects.toThrow('byte limit');
    await flush();
    responses[0].emit('data', Buffer.alloc(PUSH_MAX_RESPONSE_BYTES + 1));
    await outcome;
  });
  it('bounds DNS time and never sends after the deadline', async () => {
    jest.useFakeTimers();
    let finishLookup: (value: any) => void;
    policy.assertAllowed.mockReturnValue(
      new Promise((resolve) => {
        finishLookup = resolve;
      }),
    );
    const send = new PushTransportService(policy as any).send(
      subscription,
      'message',
    );
    const outcome = expect(send).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await jest.advanceTimersByTimeAsync(PUSH_DEADLINE_MS);
    await outcome;
    finishLookup!({ url: new URL(endpoint), address: '8.8.8.8', family: 4 });
    await flush();
    expect(https.request).not.toHaveBeenCalled();
  });
  it('bounds concurrent sends across callers', async () => {
    const transport = new PushTransportService(policy as any);
    const pending = Array.from({ length: 6 }, () =>
      transport.send(subscription, 'message'),
    );
    await flush();
    expect(https.request).toHaveBeenCalledTimes(4);
    responses[0].emit('end');
    responses[1].emit('end');
    await flush();
    expect(https.request).toHaveBeenCalledTimes(6);
    for (const response of responses.slice(2)) response.emit('end');
    await Promise.all(pending);
  });
  it('aborts an already connected but stalled provider', async () => {
    jest.useFakeTimers();
    const send = new PushTransportService(policy as any).send(
      subscription,
      'message',
    );
    const outcome = expect(send).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await flush();
    const [, options] = (https.request as jest.Mock).mock.calls[0];
    expect(options.signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(PUSH_DEADLINE_MS);
    await outcome;
    expect(options.signal.aborted).toBe(true);
  });
});
