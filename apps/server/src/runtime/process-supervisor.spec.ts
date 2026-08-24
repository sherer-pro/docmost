import { EventEmitter } from 'node:events';
import { ProcessSupervisor } from './process-supervisor';

class FakeChild extends EventEmitter {
  pid = 42;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

describe('ProcessSupervisor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createHarness(
    probe: jest.Mock<Promise<boolean>, [string, number]> = jest
      .fn<Promise<boolean>, [string, number]>()
      .mockResolvedValue(true),
  ) {
    const child = new FakeChild();
    const exit = jest.fn<void, [number]>();
    const log = jest.fn<void, [Record<string, unknown>]>();
    const supervisor = new ProcessSupervisor(
      {
        childEntrypoint: '/app/server.js',
        healthUrl: 'http://127.0.0.1:3000/api/health/live',
        role: 'api',
        probeIntervalMs: 5_000,
        probeTimeoutMs: 2_000,
        startupGraceMs: 60_000,
        failureThreshold: 3,
        forceKillMs: 5_000,
      },
      {
        spawnChild: () => child as any,
        probe,
        now: () => Date.now(),
        exit,
        log,
      },
    );
    return { child, exit, log, probe, supervisor };
  }

  it('starts the child and performs a successful liveness probe', async () => {
    const harness = createHarness();

    harness.supervisor.start();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(harness.probe).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/health/live',
      2_000,
    );
    expect(harness.child.signals).toEqual([]);
    expect(harness.exit).not.toHaveBeenCalled();
  });

  it('allows failed probes throughout startup grace', async () => {
    const harness = createHarness(jest.fn().mockResolvedValue(false));

    harness.supervisor.start();
    await jest.advanceTimersByTimeAsync(55_000);

    expect(harness.child.signals).toEqual([]);
    expect(harness.exit).not.toHaveBeenCalled();
  });

  it('terminates the child after three consecutive failures', async () => {
    const probe = jest
      .fn<Promise<boolean>, [string, number]>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const harness = createHarness(probe);

    harness.supervisor.start();
    await jest.advanceTimersByTimeAsync(20_000);

    expect(harness.child.signals).toEqual(['SIGTERM']);
    expect(harness.exit).not.toHaveBeenCalled();

    harness.child.exit(null, 'SIGTERM');
    expect(harness.exit).toHaveBeenCalledWith(1);
  });

  it('force kills an unresponsive unhealthy child after five seconds', async () => {
    const probe = jest
      .fn<Promise<boolean>, [string, number]>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const harness = createHarness(probe);

    harness.supervisor.start();
    await jest.advanceTimersByTimeAsync(20_000);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(harness.child.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('exits with an unexpected child exit code', () => {
    const harness = createHarness();

    harness.supervisor.start();
    harness.child.exit(17);

    expect(harness.exit).toHaveBeenCalledWith(17);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'forwards %s without adding a forced shutdown deadline',
    (signal) => {
      const harness = createHarness();

      harness.supervisor.start();
      harness.supervisor.handleExternalSignal(signal);
      jest.advanceTimersByTime(60_000);

      expect(harness.child.signals).toEqual([signal]);
      expect(harness.exit).not.toHaveBeenCalled();

      harness.child.exit(null, signal);
      expect(harness.exit).toHaveBeenCalledWith(0);
    },
  );
});
