import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import { OnEvent } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import { RagSyncBindingRuntime } from './rag-sync-binding-runtime.service';
import { RagSyncRuntimeConfigService } from './rag-sync-runtime.config';
import {
  RAG_SYNC_BINDING_REGISTRY,
  RagSyncBindingRegistry,
  RagSyncRuntimeBinding,
} from './rag-sync-runtime.types';

type ScheduledBinding = {
  binding: RagSyncRuntimeBinding;
  nextRunAt: number;
  order: number;
  failures: number;
  active?: {
    controller: AbortController;
    promise: Promise<void>;
  };
  removed?: boolean;
};

@Injectable()
export class RagSyncSupervisorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagSyncSupervisorService.name);
  private readonly bindings = new Map<string, ScheduledBinding>();
  private discoveryTimer?: NodeJS.Timeout;
  private schedulerTimer?: NodeJS.Timeout;
  private discoveryRunning = false;
  private order = 0;
  private destroyed = false;
  private publisher?: Redis;
  private subscriber?: Redis;

  constructor(
    private readonly config: RagSyncRuntimeConfigService,
    private readonly runtime: RagSyncBindingRuntime,
    @Inject(RAG_SYNC_BINDING_REGISTRY)
    private readonly registry: RagSyncBindingRegistry,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Embedded RAG synchronization is disabled');
      return;
    }
    void this.startInvalidationSubscriber();
    void this.discover();
  }

  async onModuleDestroy(): Promise<void> {
    const shutdownDeadline = Date.now() + this.config.shutdownTimeoutMs;
    this.destroyed = true;
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    if (this.schedulerTimer) clearTimeout(this.schedulerTimer);
    const active = [...this.bindings.values()]
      .map((entry) => entry.active)
      .filter((value): value is NonNullable<ScheduledBinding['active']> =>
        Boolean(value),
      );
    for (const entry of active) {
      entry.controller.abort(
        new DOMException('Server is shutting down', 'AbortError'),
      );
    }
    if (active.length > 0) {
      await Promise.race([
        Promise.allSettled(active.map((entry) => entry.promise)),
        new Promise<void>((resolve) => {
          const timer = setTimeout(
            resolve,
            Math.max(0, shutdownDeadline - Date.now()),
          );
          timer.unref();
        }),
      ]);
    }
    await this.closeInvalidationConnections(
      Math.max(0, shutdownDeadline - Date.now()),
    );
  }

  wake(bindingId?: string): void {
    if (!this.config.enabled || this.destroyed) return;
    if (bindingId) {
      const entry = this.bindings.get(bindingId);
      if (entry) entry.nextRunAt = Date.now();
    } else {
      for (const entry of this.bindings.values()) entry.nextRunAt = Date.now();
    }
    this.schedule(0);
    void this.discover();
  }

  bindingChanged(bindingId: string): void {
    this.wake(bindingId);
    void this.publisher
      ?.publish(this.invalidationChannel(), bindingId)
      .catch(() => {
        // Discovery polling remains authoritative when Redis pub/sub is down.
      });
  }

  @OnEvent(EventName.RAG_SYNC_SCOPE_CHANGED)
  scopeChanged(event: { spaceId: string }): void {
    this.wakeSpace(event.spaceId);
    void this.publisher
      ?.publish(this.invalidationChannel(), `space:${event.spaceId}`)
      .catch(() => {
        // Discovery polling remains authoritative when Redis pub/sub is down.
      });
  }

  async refreshNow(): Promise<void> {
    await this.discover();
  }

  private async discover(): Promise<void> {
    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
    if (this.destroyed || !this.config.enabled || this.discoveryRunning) return;
    this.discoveryRunning = true;
    try {
      const discovered = await this.registry.listRunnableBindings();
      const currentIds = new Set(discovered.map((binding) => binding.id));
      for (const binding of discovered) {
        const existing = this.bindings.get(binding.id);
        if (!existing) {
          this.bindings.set(binding.id, {
            binding,
            nextRunAt: Date.now(),
            order: this.order++,
            failures: 0,
          });
          continue;
        }
        const revisionChanged =
          existing.binding.configVersion !== binding.configVersion ||
          existing.binding.targetVersion !== binding.targetVersion ||
          existing.binding.state !== binding.state;
        existing.binding = binding;
        existing.removed = false;
        if (revisionChanged) {
          existing.failures = 0;
          existing.nextRunAt = Date.now();
          existing.active?.controller.abort(
            new DOMException('RAG sync configuration changed', 'AbortError'),
          );
        }
      }
      for (const [bindingId, entry] of this.bindings) {
        if (currentIds.has(bindingId)) continue;
        entry.removed = true;
        entry.active?.controller.abort(
          new DOMException('RAG sync binding was disabled', 'AbortError'),
        );
        if (!entry.active) this.bindings.delete(bindingId);
      }
      this.schedule(0);
    } catch {
      this.logger.error('Failed to discover RAG sync bindings');
    } finally {
      this.discoveryRunning = false;
      if (!this.destroyed) {
        this.discoveryTimer = setTimeout(
          () => void this.discover(),
          this.config.discoveryIntervalMs,
        );
        this.discoveryTimer.unref();
      }
    }
  }

  private schedule(delayMs?: number): void {
    if (this.destroyed) return;
    if (this.schedulerTimer) clearTimeout(this.schedulerTimer);
    const next = this.nextEligible();
    if (!next) return;
    const delay = delayMs ?? Math.max(0, next.nextRunAt - Date.now());
    this.schedulerTimer = setTimeout(() => this.dispatch(), delay);
    this.schedulerTimer.unref();
  }

  private dispatch(): void {
    if (this.destroyed) return;
    let available =
      this.config.maxConcurrentBindings -
      [...this.bindings.values()].filter((entry) => entry.active).length;
    while (available > 0) {
      const entry = this.nextEligible();
      if (!entry || entry.nextRunAt > Date.now()) break;
      this.start(entry);
      available -= 1;
    }
    this.schedule();
  }

  private start(entry: ScheduledBinding): void {
    const controller = new AbortController();
    const bindingSnapshot = { ...entry.binding };
    const promise = this.runtime
      .run(bindingSnapshot, controller.signal)
      .then(async (outcome) => {
        entry.failures = 0;
        entry.order = this.order++;
        if (!outcome.ran) {
          entry.nextRunAt =
            Date.now() + Math.min(1_000, this.config.pollIntervalMs);
          return;
        }
        if (outcome.result.drained) {
          await this.registry.completeDrain(
            bindingSnapshot.id,
            bindingSnapshot.configVersion,
            bindingSnapshot.targetVersion,
          );
          entry.removed = true;
          return;
        }
        entry.nextRunAt =
          outcome.result.retryAfterMs !== undefined
            ? Date.now() + outcome.result.retryAfterMs
            : outcome.result.hasMore
              ? Date.now()
              : Date.now() + this.config.pollIntervalMs;
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          entry.nextRunAt = Date.now();
          return;
        }
        entry.failures += 1;
        entry.order = this.order++;
        entry.nextRunAt = Date.now() + retryDelay(entry.failures);
        this.logger.warn(
          JSON.stringify({
            component: 'rag-sync',
            event: 'binding.failed',
            errorType:
              error instanceof Error ? error.constructor.name : 'unknown',
            retryInMs: Math.max(0, entry.nextRunAt - Date.now()),
          }),
        );
      })
      .finally(() => {
        if (entry.active?.promise === promise) entry.active = undefined;
        if (entry.removed) this.bindings.delete(entry.binding.id);
        this.schedule(0);
      });
    entry.active = { controller, promise };
  }

  private nextEligible(): ScheduledBinding | undefined {
    return [...this.bindings.values()]
      .filter((entry) => !entry.active && !entry.removed)
      .sort(
        (left, right) =>
          left.nextRunAt - right.nextRunAt || left.order - right.order,
      )[0];
  }

  private async startInvalidationSubscriber(): Promise<void> {
    if (!this.redisService || this.destroyed) return;
    try {
      const base = this.redisService.getOrThrow();
      const commandTimeout = Math.max(
        1_000,
        Math.min(5_000, this.config.requestTimeoutMs),
      );
      const options = {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout,
        connectTimeout: commandTimeout,
      };
      this.publisher = base.duplicate(options);
      this.subscriber = base.duplicate(options);
      await withDeadline(
        Promise.all([this.publisher.connect(), this.subscriber.connect()]),
        commandTimeout,
      );
      this.subscriber.on('message', (channel, message) => {
        if (channel !== this.invalidationChannel()) return;
        if (message.startsWith('space:')) {
          this.wakeSpace(message.slice('space:'.length));
          return;
        }
        this.wake(message);
      });
      await this.subscriber.subscribe(this.invalidationChannel());
    } catch {
      this.logger.warn('RAG sync Redis invalidation is unavailable');
      await this.closeInvalidationConnections();
    }
  }

  private async closeInvalidationConnections(
    timeoutMs = this.config.shutdownTimeoutMs,
  ): Promise<void> {
    const connections = [this.subscriber, this.publisher].filter(
      (connection): connection is Redis => Boolean(connection),
    );
    this.subscriber = undefined;
    this.publisher = undefined;
    await Promise.allSettled(
      connections.map((connection) => {
        connection.removeAllListeners('message');
        return closeRedisConnection(connection, timeoutMs);
      }),
    );
  }

  private invalidationChannel(): string {
    return `${this.config.redisPrefix}:v2:invalidation`;
  }

  private wakeSpace(spaceId: string): void {
    if (!this.config.enabled || this.destroyed) return;
    for (const entry of this.bindings.values()) {
      if (entry.binding.spaceId !== spaceId) continue;
      entry.nextRunAt = Date.now();
      entry.active?.controller.abort(
        new DOMException('RAG sync source scope changed', 'AbortError'),
      );
    }
    this.schedule(0);
    void this.discover();
  }
}

export async function closeRedisConnection(
  connection: Pick<Redis, 'status' | 'quit' | 'disconnect'>,
  timeoutMs: number,
): Promise<void> {
  if (connection.status === 'wait' || connection.status === 'end') {
    connection.disconnect(false);
    return;
  }
  try {
    await withDeadline(Promise.resolve(connection.quit()), timeoutMs);
  } catch {
    connection.disconnect(false);
  }
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0) throw new Error('RAG sync shutdown deadline exceeded');
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('RAG sync Redis operation timed out')),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function retryDelay(failureCount: number, random = Math.random): number {
  const cap = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, failureCount - 1));
  return Math.floor(random() * cap);
}
