import {
  closeRedisConnection,
  RagSyncSupervisorService,
  retryDelay,
} from './rag-sync-supervisor.service';
import { RagSyncRuntimeError } from './rag-sync-runtime.types';

function runtimeBinding(id: string) {
  return {
    id,
    workspaceId: 'workspace-id',
    spaceId: `space-${id}`,
    state: 'enabled' as const,
    adapter: 'open-webui-knowledge-v1' as const,
    baseUrl: 'https://open-webui.example.test',
    knowledgeId: `knowledge-${id}`,
    writerApiKey: 'secret',
    configVersion: 1,
    targetVersion: 1,
    updatedAtMs: Date.now() - 60_000,
  };
}

describe('RagSyncSupervisorService', () => {
  it('bounds Redis shutdown and disconnects a stuck duplicate connection', async () => {
    jest.useFakeTimers();
    const connection = {
      status: 'ready',
      quit: jest.fn(() => new Promise(() => undefined)),
      disconnect: jest.fn(),
    };

    const closing = closeRedisConnection(connection as any, 1_000);
    await jest.advanceTimersByTimeAsync(1_000);
    await closing;

    expect(connection.disconnect).toHaveBeenCalledWith(false);
    jest.useRealTimers();
  });

  it('uses full jitter with an exponential cap', () => {
    expect(retryDelay(1, () => 0)).toBe(0);
    expect(retryDelay(1, () => 0.5)).toBe(2_500);
    expect(retryDelay(2, () => 0.5)).toBe(5_000);
    expect(retryDelay(20, () => 1)).toBe(15 * 60_000);
  });

  it('gives another due binding a turn between feed quanta', async () => {
    jest.useFakeTimers();
    const calls: string[] = [];
    const attempts = new Map<string, number>();
    const runtime = {
      run: jest.fn(async (binding: { id: string }) => {
        calls.push(binding.id);
        const attempt = (attempts.get(binding.id) ?? 0) + 1;
        attempts.set(binding.id, attempt);
        return {
          ran: true as const,
          result: { hasMore: binding.id === 'first' && attempt === 1 },
        };
      }),
    };
    const registry = {
      listRunnableBindings: jest
        .fn()
        .mockResolvedValue([runtimeBinding('first'), runtimeBinding('second')]),
      completeDrain: jest.fn(),
      stopForRuntimeError: jest.fn(),
    };
    const supervisor = new RagSyncSupervisorService(
      {
        enabled: true,
        maxConcurrentBindings: 1,
        pollIntervalMs: 60_000,
        discoveryIntervalMs: 30_000,
        shutdownTimeoutMs: 1_000,
      } as any,
      runtime as any,
      registry,
    );

    await supervisor.refreshNow();
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(1);

    expect(calls.slice(0, 3)).toEqual(['first', 'second', 'first']);
    await supervisor.onModuleDestroy();
    jest.useRealTimers();
  });

  it('stops a target-unavailable binding without scheduling another retry', async () => {
    jest.useFakeTimers();
    const runtime = {
      run: jest
        .fn()
        .mockRejectedValue(
          new RagSyncRuntimeError('rag_sync_target_unavailable', false),
        ),
    };
    const registry = {
      listRunnableBindings: jest
        .fn()
        .mockResolvedValueOnce([runtimeBinding('first')])
        .mockResolvedValue([]),
      completeDrain: jest.fn(),
      stopForRuntimeError: jest.fn().mockResolvedValue(true),
    };
    const supervisor = new RagSyncSupervisorService(
      {
        enabled: true,
        maxConcurrentBindings: 1,
        pollIntervalMs: 60_000,
        discoveryIntervalMs: 30_000,
        shutdownTimeoutMs: 1_000,
      } as any,
      runtime as any,
      registry,
    );

    await supervisor.refreshNow();
    await jest.advanceTimersByTimeAsync(1);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(registry.stopForRuntimeError).toHaveBeenCalledWith(
      'first',
      1,
      1,
      true,
    );
    expect(runtime.run).toHaveBeenCalledTimes(1);
    await supervisor.onModuleDestroy();
    jest.useRealTimers();
  });

  it('aborts an active binding during shutdown', async () => {
    jest.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    let resolveRun: ((value: unknown) => void) | undefined;
    const runtime = {
      run: jest.fn(
        (_binding: unknown, signal: AbortSignal) =>
          new Promise((resolve) => {
            observedSignal = signal;
            resolveRun = resolve;
          }),
      ),
    };
    const supervisor = new RagSyncSupervisorService(
      {
        enabled: true,
        maxConcurrentBindings: 1,
        pollIntervalMs: 60_000,
        discoveryIntervalMs: 30_000,
        shutdownTimeoutMs: 1_000,
      } as any,
      runtime as any,
      {
        listRunnableBindings: jest
          .fn()
          .mockResolvedValue([runtimeBinding('first')]),
        completeDrain: jest.fn(),
        stopForRuntimeError: jest.fn(),
      },
    );

    await supervisor.refreshNow();
    await jest.advanceTimersByTimeAsync(0);
    const shutdown = supervisor.onModuleDestroy();

    expect(observedSignal?.aborted).toBe(true);
    resolveRun?.({ ran: false });
    await shutdown;
    jest.useRealTimers();
  });

  it('aborts the active quantum immediately when its space scope changes', async () => {
    jest.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    let resolveRun: ((value: unknown) => void) | undefined;
    const runtime = {
      run: jest.fn(
        (_binding: unknown, signal: AbortSignal) =>
          new Promise((resolve) => {
            observedSignal = signal;
            resolveRun = resolve;
          }),
      ),
    };
    const registry = {
      listRunnableBindings: jest
        .fn()
        .mockResolvedValue([runtimeBinding('first')]),
      completeDrain: jest.fn(),
      stopForRuntimeError: jest.fn(),
    };
    const supervisor = new RagSyncSupervisorService(
      {
        enabled: true,
        maxConcurrentBindings: 1,
        pollIntervalMs: 60_000,
        discoveryIntervalMs: 30_000,
        shutdownTimeoutMs: 1_000,
      } as any,
      runtime as any,
      registry,
    );

    await supervisor.refreshNow();
    await jest.advanceTimersByTimeAsync(0);
    supervisor.scopeChanged({ spaceId: 'space-first' });

    expect(observedSignal?.aborted).toBe(true);
    resolveRun?.({ ran: false });
    await jest.advanceTimersByTimeAsync(0);
    await supervisor.onModuleDestroy();
    jest.useRealTimers();
  });
});
