import { RagSyncBindingRuntime } from './rag-sync-binding-runtime.service';
import {
  RagSyncDiagnosticError,
  RagSyncRuntimeBinding,
  RagSyncRuntimeError,
} from './rag-sync-runtime.types';

const binding: RagSyncRuntimeBinding = {
  id: 'binding-id',
  workspaceId: 'workspace-id',
  spaceId: 'space-id',
  state: 'enabled',
  adapter: 'open-webui-knowledge-v1',
  baseUrl: 'https://open-webui.example.test',
  knowledgeId: 'knowledge-id',
  writerApiKey: 'secret',
  configVersion: 1,
  targetVersion: 1,
  updatedAtMs: Date.now() - 60_000,
};

function createRuntime() {
  const lease = {
    bindingId: binding.id,
    targetVersion: binding.targetVersion,
    token: 'lease-token',
  };
  const state = {
    acquireGlobalSlot: jest.fn().mockResolvedValue(true),
    releaseGlobalSlot: jest.fn().mockResolvedValue(undefined),
    renewGlobalSlot: jest.fn().mockResolvedValue(true),
    acquireLease: jest.fn().mockResolvedValue(lease),
    renewLease: jest.fn().mockResolvedValue(true),
    releaseLease: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockResolvedValue(null),
    setStatus: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    maxConcurrentBindings: 4,
    maxConcurrentDocuments: 3,
    maxAttachmentBytes: 1024,
    pollIntervalMs: 5_000,
    requestTimeoutMs: 5_000,
    processingTimeoutMs: 30_000,
    reconcileIntervalMs: 60_000,
    leaseTtlMs: 30_000,
  };
  const processor = {
    processQuantum: jest.fn().mockResolvedValue({
      hasMore: false,
      processedCount: 2,
    }),
  };
  return {
    lease,
    state,
    processor,
    runtime: new RagSyncBindingRuntime(
      state as any,
      config as any,
      processor as any,
    ),
  };
}

describe('RagSyncBindingRuntime', () => {
  it('runs one bounded quantum and releases both leases', async () => {
    const { lease, state, processor, runtime } = createRuntime();

    await expect(
      runtime.run(binding, new AbortController().signal),
    ).resolves.toEqual({
      ran: true,
      result: { hasMore: false, processedCount: 2 },
    });

    expect(processor.processQuantum).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({
        lease,
        maxItems: 100,
        maxConcurrentDocuments: 3,
      }),
    );
    expect(state.releaseLease).toHaveBeenCalledWith(lease);
    expect(state.releaseGlobalSlot).toHaveBeenCalledTimes(1);
    expect(state.setStatus).toHaveBeenLastCalledWith(
      lease,
      expect.objectContaining({
        health: 'healthy',
        processedCount: 2,
      }),
    );
  });

  it('does not process a binding owned by another replica', async () => {
    const { state, processor, runtime } = createRuntime();
    state.acquireLease.mockResolvedValue(null);

    await expect(
      runtime.run(binding, new AbortController().signal),
    ).resolves.toEqual({ ran: false });

    expect(processor.processQuantum).not.toHaveBeenCalled();
    expect(state.releaseGlobalSlot).toHaveBeenCalledTimes(1);
  });

  it('preserves a non-retryable code through safe diagnostics', async () => {
    const { lease, state, processor, runtime } = createRuntime();
    processor.processQuantum.mockRejectedValue(
      new RagSyncDiagnosticError(
        'scope',
        'binding',
        new RagSyncRuntimeError('rag_sync_scope_unavailable', false),
      ),
    );

    await expect(
      runtime.run(binding, new AbortController().signal),
    ).rejects.toBeInstanceOf(RagSyncDiagnosticError);

    expect(state.setStatus).toHaveBeenLastCalledWith(
      lease,
      expect.objectContaining({
        health: 'error',
        errorCode: 'rag_sync_scope_unavailable',
      }),
    );
  });

  it('aborts the active quantum as soon as lease renewal loses ownership', async () => {
    jest.useFakeTimers();
    const { state, processor, runtime } = createRuntime();
    state.renewLease.mockResolvedValue(false);
    let observedSignal: AbortSignal | undefined;
    processor.processQuantum.mockImplementation(
      async (_binding: unknown, context: { signal: AbortSignal }) => {
        observedSignal = context.signal;
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(context.signal.reason),
            { once: true },
          );
        });
      },
    );

    try {
      const run = runtime.run(binding, new AbortController().signal);
      const rejected = expect(run).rejects.toMatchObject({
        code: 'rag_sync_lease_lost',
      });
      await jest.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(observedSignal?.aborted).toBe(true);
      expect(state.renewGlobalSlot).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
