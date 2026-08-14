import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RagSyncRuntimeConfigService } from './rag-sync-runtime.config';
import { RagSyncStateStore } from './rag-sync-state-store.service';
import {
  RAG_SYNC_QUANTUM_PROCESSOR,
  RagSyncDiagnosticError,
  RagSyncLease,
  RagSyncLeaseLostError,
  RagSyncOperationalStatus,
  RagSyncQuantumProcessor,
  RagSyncQuantumResult,
  RagSyncRuntimeBinding,
  RagSyncRuntimeError,
} from './rag-sync-runtime.types';

export type RagSyncBindingRunResult =
  | { ran: false }
  | { ran: true; result: RagSyncQuantumResult };

@Injectable()
export class RagSyncBindingRuntime {
  private readonly logger = new Logger(RagSyncBindingRuntime.name);

  constructor(
    private readonly state: RagSyncStateStore,
    private readonly config: RagSyncRuntimeConfigService,
    @Inject(RAG_SYNC_QUANTUM_PROCESSOR)
    private readonly processor: RagSyncQuantumProcessor,
  ) {}

  async run(
    binding: RagSyncRuntimeBinding,
    parentSignal: AbortSignal,
  ): Promise<RagSyncBindingRunResult> {
    const slotToken = randomUUID();
    if (
      !(await this.state.acquireGlobalSlot(
        slotToken,
        this.config.maxConcurrentBindings,
        this.config.leaseTtlMs,
      ))
    ) {
      return { ran: false };
    }

    let lease: RagSyncLease | null = null;
    try {
      lease = await this.state.acquireLease(
        binding.id,
        binding.targetVersion,
        this.config.leaseTtlMs,
      );
      if (!lease) return { ran: false };
      return await this.runWithLease(binding, lease, slotToken, parentSignal);
    } finally {
      if (lease) {
        await this.state.releaseLease(lease).catch(() => {
          this.logger.warn('Failed to release a RAG sync binding lease');
        });
      }
      await this.state.releaseGlobalSlot(slotToken).catch(() => {
        this.logger.warn('Failed to release a RAG sync concurrency slot');
      });
    }
  }

  private async runWithLease(
    binding: RagSyncRuntimeBinding,
    lease: RagSyncLease,
    slotToken: string,
    parentSignal: AbortSignal,
  ): Promise<RagSyncBindingRunResult> {
    const controller = new AbortController();
    const onParentAbort = () =>
      controller.abort(
        parentSignal.reason ?? new DOMException('Aborted', 'AbortError'),
      );
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
    if (parentSignal.aborted) onParentAbort();

    const previousStatus = await this.state.getStatus(binding.id);
    const lastAttemptAt = new Date().toISOString();
    await this.state.setStatus(lease, {
      health: 'syncing',
      lastAttemptAt,
      lastSuccessAt: previousStatus?.lastSuccessAt ?? null,
      lagMs: previousStatus?.lagMs ?? null,
      errorCode: null,
    });

    const renewalController = new AbortController();
    const renewal = this.renewSequentially(
      lease,
      slotToken,
      controller,
      renewalController.signal,
    );
    try {
      const result = await this.processor.processQuantum(binding, {
        lease,
        signal: controller.signal,
        maxItems: 100,
        maxConcurrentDocuments: this.config.maxConcurrentDocuments,
        maxAttachmentBytes: this.config.maxAttachmentBytes,
        pollIntervalMs: this.config.pollIntervalMs,
        requestTimeoutMs: this.config.requestTimeoutMs,
        processingTimeoutMs: this.config.processingTimeoutMs,
        reconcileIntervalMs: this.config.reconcileIntervalMs,
      });
      if (controller.signal.aborted) {
        throw controller.signal.reason ?? new RagSyncLeaseLostError();
      }
      const status: RagSyncOperationalStatus = {
        health: result.hasMore ? 'syncing' : 'healthy',
        lastAttemptAt,
        lastSuccessAt: new Date().toISOString(),
        lagMs: result.lagMs ?? null,
        errorCode: null,
        processedCount: result.processedCount ?? 0,
      };
      await this.state.setStatus(lease, status);
      return { ran: true, result };
    } catch (error) {
      if (!parentSignal.aborted) {
        const runtimeError = normalizeRuntimeError(error);
        await this.state
          .setStatus(lease, {
            health: runtimeError.retryable ? 'degraded' : 'error',
            lastAttemptAt,
            lastSuccessAt: previousStatus?.lastSuccessAt ?? null,
            lagMs: previousStatus?.lagMs ?? null,
            errorCode: runtimeError.code,
          })
          .catch(() => undefined);
      }
      throw error;
    } finally {
      renewalController.abort();
      await renewal;
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }

  private async renewSequentially(
    lease: RagSyncLease,
    slotToken: string,
    operationController: AbortController,
    stopSignal: AbortSignal,
  ): Promise<void> {
    const intervalMs = Math.max(1_000, Math.floor(this.config.leaseTtlMs / 3));
    while (!stopSignal.aborted) {
      try {
        await delay(intervalMs, stopSignal);
      } catch {
        return;
      }
      if (stopSignal.aborted) return;
      try {
        const [leaseRenewed, slotRenewed] = await Promise.all([
          this.state.renewLease(lease, this.config.leaseTtlMs),
          this.state.renewGlobalSlot(slotToken, this.config.leaseTtlMs),
        ]);
        if (!leaseRenewed || !slotRenewed) {
          operationController.abort(new RagSyncLeaseLostError());
          return;
        }
      } catch {
        operationController.abort(new RagSyncLeaseLostError());
        return;
      }
    }
  }
}

export function normalizeRuntimeError(error: unknown): RagSyncRuntimeError {
  if (error instanceof RagSyncDiagnosticError) {
    return normalizeRuntimeError(error.originalError);
  }
  if (error instanceof RagSyncRuntimeError) return error;
  if ((error as Error)?.name === 'AbortError') {
    return new RagSyncRuntimeError('rag_sync_aborted', true);
  }
  return new RagSyncRuntimeError('rag_sync_internal_error', true);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
