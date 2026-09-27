import { Injectable } from '@nestjs/common';
import * as https from 'node:https';
import * as webpush from 'web-push';
import { PushEndpointPolicyService } from './push-endpoint-policy.service';

export const PUSH_DEADLINE_MS = 10_000;
export const PUSH_MAX_RESPONSE_BYTES = 64 * 1024;
const PUSH_CONCURRENCY = 4;

@Injectable()
export class PushTransportService {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly policy: PushEndpointPolicyService) {}

  async send(
    subscription: webpush.PushSubscription,
    payload: string,
  ): Promise<void> {
    if (this.active < PUSH_CONCURRENCY) this.active += 1;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    const controller = new AbortController();
    const timeoutError = Object.assign(new Error('Push delivery timed out'), {
      code: 'ETIMEDOUT',
    });
    const timer = setTimeout(
      () => controller.abort(timeoutError),
      PUSH_DEADLINE_MS,
    );
    let removeAbortListener = () => undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () =>
          controller.signal.removeEventListener('abort', onAbort);
      });
      await Promise.race([
        this.deliver(subscription, payload, controller.signal),
        aborted,
      ]);
    } finally {
      clearTimeout(timer);
      removeAbortListener();
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  private async deliver(
    subscription: webpush.PushSubscription,
    payload: string,
    signal: AbortSignal,
  ) {
    const resolved = await this.policy.assertAllowed(subscription.endpoint);
    signal.throwIfAborted();
    const details = webpush.generateRequestDetails(subscription, payload);
    await new Promise<void>((resolve, reject) => {
      const request = https.request(
        resolved.url,
        {
          method: details.method,
          headers: details.headers,
          agent: false,
          family: resolved.family,
          signal,
          lookup: (_hostname, options, callback) => {
            if (typeof options === 'object' && options.all) {
              (callback as any)(null, [
                { address: resolved.address, family: resolved.family },
              ]);
            } else callback(null, resolved.address, resolved.family);
          },
        },
        (response) => {
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > PUSH_MAX_RESPONSE_BYTES) {
              const error = new Error('Push response exceeds the byte limit');
              reject(error);
              response.destroy(error);
              request.destroy(error);
            }
          });
          response.on('error', reject);
          response.on('aborted', () =>
            reject(
              Object.assign(new Error('Push response aborted'), {
                code: 'ECONNRESET',
              }),
            ),
          );
          response.on('end', () => {
            const statusCode = response.statusCode ?? 0;
            if (statusCode >= 200 && statusCode < 300) resolve();
            else
              reject(
                Object.assign(new Error('Push provider rejected delivery'), {
                  statusCode,
                }),
              );
          });
        },
      );
      request.on('error', (error) =>
        reject(signal.aborted ? signal.reason : error),
      );
      request.end(details.body);
    });
  }
}
