import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { EnvironmentService } from '../environment/environment.service';

const LATENCY_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000];

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
  private activeRequests = 0;
  private timer?: NodeJS.Timeout;

  constructor(private readonly environmentService: EnvironmentService) {}

  get enabled(): boolean {
    return this.environmentService.isPerformanceDiagnosticsEnabled();
  }

  onModuleInit(): void {
    if (!this.enabled) {
      return;
    }

    this.eventLoop.enable();
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
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
    const memory = process.memoryUsage();
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
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
      },
    };
  }

  private flush(): void {
    this.logger.log(JSON.stringify(this.buildSnapshot()));
    this.routes.clear();
    this.eventLoop.reset();
  }
}
