import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { EnvironmentService } from '../environment/environment.service';

const LATENCY_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000];
const HEAP_SAMPLE_INTERVAL_MS = 30_000;
const HEAP_WARNING_RATIO = 0.85;
const HEAP_CRITICAL_RATIO = 0.95;
const HEAP_RECOVERY_RATIO = 0.75;
export const HEAP_CRITICAL_REMINDER_MS = 5 * 60_000;

interface RouteAggregate {
  count: number;
  latencyBuckets: number[];
  statusClasses: Record<string, number>;
}

export interface PerformanceDiagnosticsSnapshot {
  event: 'performance_diagnostics_summary';
  intervalMs: number;
  activeRequests: number;
  routes: Array<{
    method: string;
    route: string;
    count: number;
    statusClasses: Record<string, number>;
    latencyBuckets: Record<string, number>;
  }>;
  eventLoop: {
    p95Ms: number;
    maxMs: number;
  };
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    heapLimitBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    heapRatio: number;
    uptimeSeconds: number;
  };
}

export interface RuntimeMemorySnapshot {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapLimitBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  heapRatio: number;
  uptimeSeconds: number;
}

export type HeapPressureLevel = 'warning' | 'critical' | 'recovery';
export type HeapPressureState = 'normal' | 'warning' | 'critical';

export interface HeapPressureEvent extends RuntimeMemorySnapshot {
  event: 'runtime_heap_pressure';
  level: HeapPressureLevel;
  state: HeapPressureState;
}

export class HeapPressureStateMachine {
  private state: HeapPressureState = 'normal';
  private consecutiveWarningSamples = 0;
  private consecutiveRecoverySamples = 0;
  private lastCriticalEventAt?: number;

  observe(
    snapshot: RuntimeMemorySnapshot,
    nowMs = Date.now(),
  ): HeapPressureEvent | undefined {
    const isRecoverySample = snapshot.heapRatio < HEAP_RECOVERY_RATIO;
    this.consecutiveRecoverySamples = isRecoverySample
      ? this.consecutiveRecoverySamples + 1
      : 0;

    if (
      this.state !== 'normal' &&
      this.consecutiveRecoverySamples >= 2
    ) {
      this.state = 'normal';
      this.consecutiveWarningSamples = 0;
      this.consecutiveRecoverySamples = 0;
      this.lastCriticalEventAt = undefined;
      return this.createEvent('recovery', snapshot);
    }

    if (snapshot.heapRatio >= HEAP_CRITICAL_RATIO) {
      if (this.state !== 'critical') {
        this.state = 'critical';
        this.consecutiveWarningSamples = 0;
        this.lastCriticalEventAt = nowMs;
        return this.createEvent('critical', snapshot);
      }
    } else if (this.state === 'normal') {
      this.consecutiveWarningSamples =
        snapshot.heapRatio >= HEAP_WARNING_RATIO
          ? this.consecutiveWarningSamples + 1
          : 0;
      if (this.consecutiveWarningSamples >= 2) {
        this.state = 'warning';
        this.consecutiveWarningSamples = 0;
        return this.createEvent('warning', snapshot);
      }
    }

    if (
      this.state === 'critical' &&
      this.lastCriticalEventAt !== undefined &&
      nowMs - this.lastCriticalEventAt >= HEAP_CRITICAL_REMINDER_MS
    ) {
      this.lastCriticalEventAt = nowMs;
      return this.createEvent('critical', snapshot);
    }

    return undefined;
  }

  private createEvent(
    level: HeapPressureLevel,
    snapshot: RuntimeMemorySnapshot,
  ): HeapPressureEvent {
    return {
      event: 'runtime_heap_pressure',
      level,
      state: this.state,
      ...snapshot,
    };
  }
}

function captureRuntimeMemorySnapshot(): RuntimeMemorySnapshot {
  const memory = process.memoryUsage();
  const heapLimitBytes = getHeapStatistics().heap_size_limit;
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    heapLimitBytes,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    heapRatio: Number((memory.heapUsed / heapLimitBytes).toFixed(4)),
    uptimeSeconds: Number(process.uptime().toFixed(1)),
  };
}

@Injectable()
export class PerformanceDiagnosticsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PerformanceDiagnosticsService.name);
  private readonly intervalMs = 60_000;
  private readonly routes = new Map<string, RouteAggregate>();
  private readonly eventLoop: IntervalHistogram = monitorEventLoopDelay({
    resolution: 20,
  });
  private readonly heapPressure = new HeapPressureStateMachine();
  private activeRequests = 0;
  private diagnosticsTimer?: NodeJS.Timeout;
  private heapTimer?: NodeJS.Timeout;

  constructor(private readonly environmentService: EnvironmentService) {}

  get enabled(): boolean {
    return this.environmentService.isPerformanceDiagnosticsEnabled();
  }

  onModuleInit(): void {
    this.heapTimer = setInterval(
      () => this.sampleHeapPressure(),
      HEAP_SAMPLE_INTERVAL_MS,
    );
    this.heapTimer.unref();

    if (this.enabled) {
      this.eventLoop.enable();
      this.diagnosticsTimer = setInterval(() => this.flush(), this.intervalMs);
      this.diagnosticsTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.diagnosticsTimer) {
      clearInterval(this.diagnosticsTimer);
    }
    if (this.heapTimer) {
      clearInterval(this.heapTimer);
    }
    this.eventLoop.disable();
  }

  beginRequest(): void {
    this.activeRequests += 1;
  }

  recordRequest(input: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);

    const key = `${input.method} ${input.route}`;
    const aggregate = this.routes.get(key) ?? {
      count: 0,
      latencyBuckets: Array.from(
        { length: LATENCY_BUCKETS_MS.length + 1 },
        () => 0,
      ),
      statusClasses: {},
    };
    aggregate.count += 1;
    const statusClass = `${Math.floor(input.statusCode / 100)}xx`;
    aggregate.statusClasses[statusClass] =
      (aggregate.statusClasses[statusClass] ?? 0) + 1;
    const bucketIndex = LATENCY_BUCKETS_MS.findIndex(
      (limit) => input.durationMs <= limit,
    );
    aggregate.latencyBuckets[
      bucketIndex === -1 ? LATENCY_BUCKETS_MS.length : bucketIndex
    ] += 1;
    this.routes.set(key, aggregate);
  }

  buildSnapshot(): PerformanceDiagnosticsSnapshot {
    const memory = captureRuntimeMemorySnapshot();
    const toMs = (nanoseconds: number) =>
      Number.isFinite(nanoseconds)
        ? Number((nanoseconds / 1_000_000).toFixed(2))
        : 0;

    return {
      event: 'performance_diagnostics_summary',
      intervalMs: this.intervalMs,
      activeRequests: this.activeRequests,
      routes: [...this.routes.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, aggregate]) => {
          const separator = key.indexOf(' ');
          const latencyBuckets = Object.fromEntries([
            ...LATENCY_BUCKETS_MS.map((limit, index) => [
              `le_${limit}_ms`,
              aggregate.latencyBuckets[index],
            ]),
            ['gt_5000_ms', aggregate.latencyBuckets.at(-1) ?? 0],
          ]);

          return {
            method: key.slice(0, separator),
            route: key.slice(separator + 1),
            count: aggregate.count,
            statusClasses: { ...aggregate.statusClasses },
            latencyBuckets,
          };
        }),
      eventLoop: {
        p95Ms: toMs(this.eventLoop.percentile(95)),
        maxMs: toMs(this.eventLoop.max),
      },
      memory: {
        ...memory,
      },
    };
  }

  private sampleHeapPressure(): void {
    const event = this.heapPressure.observe(captureRuntimeMemorySnapshot());
    if (!event) {
      return;
    }

    const payload = JSON.stringify(event);
    if (event.level === 'critical') {
      this.logger.error(payload);
    } else if (event.level === 'warning') {
      this.logger.warn(payload);
    } else {
      this.logger.log(payload);
    }
  }

  private flush(): void {
    this.logger.log(JSON.stringify(this.buildSnapshot()));
    this.routes.clear();
    this.eventLoop.reset();
  }
}
