import { Injectable } from '@nestjs/common';
import { RagSyncRuntimeConfigService } from './rag-sync-runtime.config';

type Waiter = {
  bytes: number;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

/**
 * Bounds in-memory document payloads across every binding in this process.
 * Redis admission bounds bindings across replicas; memory is process-local.
 */
@Injectable()
export class RagSyncMemoryBudgetService {
  private readonly capacity: number;
  private available: number;
  private readonly waiters: Waiter[] = [];

  constructor(config: RagSyncRuntimeConfigService) {
    this.capacity = config.maxAttachmentBytes;
    this.available = this.capacity;
  }

  async run<T>(
    requestedBytes: number,
    signal: AbortSignal,
    callback: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(requestedBytes, signal);
    try {
      return await callback();
    } finally {
      release();
    }
  }

  private acquire(
    requestedBytes: number,
    signal: AbortSignal,
  ): Promise<() => void> {
    if (signal.aborted) return Promise.reject(abortReason(signal));
    const bytes = Math.max(
      1,
      Math.min(
        this.capacity,
        Number.isSafeInteger(requestedBytes) ? requestedBytes : this.capacity,
      ),
    );
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        bytes,
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(abortReason(signal));
        },
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      if (waiter.signal.aborted) {
        this.waiters.shift();
        continue;
      }
      if (waiter.bytes > this.available) return;
      this.waiters.shift();
      this.available -= waiter.bytes;
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.available += waiter.bytes;
        this.dispatch();
      });
    }
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}
