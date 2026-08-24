import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const SUPERVISOR_PROBE_INTERVAL_MS = 5_000;
const SUPERVISOR_PROBE_TIMEOUT_MS = 2_000;
const SUPERVISOR_STARTUP_GRACE_MS = 60_000;
const SUPERVISOR_FAILURE_THRESHOLD = 3;
const SUPERVISOR_FORCE_KILL_MS = 5_000;

type SupervisorSignal = 'SIGINT' | 'SIGTERM';

interface SupervisedChild {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export interface ProcessSupervisorOptions {
  childEntrypoint: string;
  healthUrl: string;
  role: string;
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
  startupGraceMs?: number;
  failureThreshold?: number;
  forceKillMs?: number;
}

interface SupervisorDependencies {
  spawnChild(entrypoint: string): SupervisedChild;
  probe(url: string, timeoutMs: number): Promise<boolean>;
  now(): number;
  setTimer(callback: () => void, delayMs: number): NodeJS.Timeout;
  clearTimer(timer: NodeJS.Timeout): void;
  exit(code: number): void;
  log(event: Record<string, unknown>): void;
}

const defaultDependencies: SupervisorDependencies = {
  spawnChild: (entrypoint) =>
    spawn(process.execPath, [entrypoint], {
      env: process.env,
      stdio: 'inherit',
    }),
  probe: async (url, timeoutMs) => {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/plain, application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const healthy = response.ok;
      await response.body?.cancel();
      return healthy;
    } catch {
      return false;
    }
  },
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
  exit: (code) => {
    process.exitCode = code;
  },
  log: (event) => console.log(JSON.stringify(event)),
};

export class ProcessSupervisor {
  private readonly dependencies: SupervisorDependencies;
  private readonly probeIntervalMs: number;
  private readonly probeTimeoutMs: number;
  private readonly startupGraceMs: number;
  private readonly failureThreshold: number;
  private readonly forceKillMs: number;
  private child?: SupervisedChild;
  private startedAt = 0;
  private consecutiveFailures = 0;
  private hasBeenHealthy = false;
  private shuttingDown = false;
  private terminatingUnhealthyChild = false;
  private finished = false;
  private probeTimer?: NodeJS.Timeout;
  private forceKillTimer?: NodeJS.Timeout;

  constructor(
    private readonly options: ProcessSupervisorOptions,
    dependencies: Partial<SupervisorDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
    this.probeIntervalMs =
      options.probeIntervalMs ?? SUPERVISOR_PROBE_INTERVAL_MS;
    this.probeTimeoutMs =
      options.probeTimeoutMs ?? SUPERVISOR_PROBE_TIMEOUT_MS;
    this.startupGraceMs =
      options.startupGraceMs ?? SUPERVISOR_STARTUP_GRACE_MS;
    this.failureThreshold =
      options.failureThreshold ?? SUPERVISOR_FAILURE_THRESHOLD;
    this.forceKillMs = options.forceKillMs ?? SUPERVISOR_FORCE_KILL_MS;
  }

  start(): void {
    this.startedAt = this.dependencies.now();
    this.child = this.dependencies.spawnChild(this.options.childEntrypoint);
    this.child.once('exit', (code, signal) => this.handleChildExit(code, signal));
    this.dependencies.log({
      event: 'process_supervisor_started',
      role: this.options.role,
      childPid: this.child.pid ?? null,
      healthUrl: this.options.healthUrl,
    });
    this.scheduleProbe();
  }

  handleExternalSignal(signal: SupervisorSignal): void {
    if (this.finished || this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    this.clearProbeTimer();
    this.clearForceKillTimer();
    this.dependencies.log({
      event: 'process_supervisor_shutdown',
      role: this.options.role,
      signal,
    });

    if (!this.child || this.child.exitCode !== null || this.child.signalCode) {
      this.finish(0);
      return;
    }

    this.child.kill(signal);
  }

  private scheduleProbe(): void {
    if (this.finished || this.shuttingDown || this.terminatingUnhealthyChild) {
      return;
    }

    this.probeTimer = this.dependencies.setTimer(
      () => void this.runProbe(),
      this.probeIntervalMs,
    );
    this.probeTimer.unref?.();
  }

  private async runProbe(): Promise<void> {
    this.probeTimer = undefined;
    if (this.finished || this.shuttingDown || this.terminatingUnhealthyChild) {
      return;
    }

    const healthy = await this.dependencies.probe(
      this.options.healthUrl,
      this.probeTimeoutMs,
    );
    if (this.finished || this.shuttingDown || this.terminatingUnhealthyChild) {
      return;
    }

    if (healthy) {
      this.hasBeenHealthy = true;
      this.consecutiveFailures = 0;
      this.scheduleProbe();
      return;
    }

    const withinStartupGrace =
      !this.hasBeenHealthy &&
      this.dependencies.now() - this.startedAt < this.startupGraceMs;
    if (withinStartupGrace) {
      this.scheduleProbe();
      return;
    }

    this.consecutiveFailures += 1;
    this.dependencies.log({
      event: 'process_supervisor_probe_failed',
      role: this.options.role,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
    });

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.terminateUnhealthyChild();
      return;
    }

    this.scheduleProbe();
  }

  private terminateUnhealthyChild(): void {
    this.terminatingUnhealthyChild = true;
    this.clearProbeTimer();
    this.dependencies.log({
      event: 'process_supervisor_unhealthy',
      role: this.options.role,
      consecutiveFailures: this.consecutiveFailures,
    });

    if (!this.child || this.child.exitCode !== null || this.child.signalCode) {
      this.finish(1);
      return;
    }

    this.child.kill('SIGTERM');
    this.forceKillTimer = this.dependencies.setTimer(() => {
      this.forceKillTimer = undefined;
      if (
        this.child &&
        this.child.exitCode === null &&
        !this.child.signalCode
      ) {
        this.dependencies.log({
          event: 'process_supervisor_forced_kill',
          role: this.options.role,
        });
        this.child.kill('SIGKILL');
      }
    }, this.forceKillMs);
    this.forceKillTimer.unref?.();
  }

  private handleChildExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    this.clearProbeTimer();
    this.clearForceKillTimer();
    this.dependencies.log({
      event: 'process_supervisor_child_exit',
      role: this.options.role,
      code,
      signal,
      expected: this.shuttingDown || this.terminatingUnhealthyChild,
    });

    if (this.terminatingUnhealthyChild) {
      this.finish(1);
      return;
    }

    if (this.shuttingDown) {
      this.finish(code ?? 0);
      return;
    }

    this.finish(code ?? 1);
  }

  private clearProbeTimer(): void {
    if (this.probeTimer) {
      this.dependencies.clearTimer(this.probeTimer);
      this.probeTimer = undefined;
    }
  }

  private clearForceKillTimer(): void {
    if (this.forceKillTimer) {
      this.dependencies.clearTimer(this.forceKillTimer);
      this.forceKillTimer = undefined;
    }
  }

  private finish(code: number): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.clearProbeTimer();
    this.clearForceKillTimer();
    this.dependencies.exit(code);
  }
}

function runProcessSupervisor(): ProcessSupervisor {
  const childEntrypoint = resolve(
    process.cwd(),
    process.argv[2] ?? 'apps/server/dist/apps/server/src/main.js',
  );
  const portEnvironmentName = process.argv[3] ?? 'PORT';
  const role = process.argv[4] ?? 'api';
  const defaultPort = portEnvironmentName === 'COLLAB_PORT' ? 3001 : 3000;
  const port = Number(process.env[portEnvironmentName] ?? defaultPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid ${portEnvironmentName} value`);
  }

  const supervisor = new ProcessSupervisor({
    childEntrypoint,
    healthUrl: `http://127.0.0.1:${port}/api/health/live`,
    role,
  });
  process.once('SIGTERM', () => supervisor.handleExternalSignal('SIGTERM'));
  process.once('SIGINT', () => supervisor.handleExternalSignal('SIGINT'));
  supervisor.start();
  return supervisor;
}

if (require.main === module) {
  runProcessSupervisor();
}
