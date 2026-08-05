import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AiRun as AiRunEntity } from '@docmost/db/types/entity.types';
import { AiRunStatus } from '@docmost/api-contract';

type DurationMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
};

function durationMetric(): DurationMetric {
  return { count: 0, totalMs: 0, maxMs: 0 };
}

export type AiMcpCacheEvent =
  | 'hit'
  | 'miss'
  | 'evict'
  | 'retire'
  | 'close';

/**
 * Closed vocabulary. An error message must never be interpolated into a metric
 * key, or the summary becomes unbounded in cardinality and can leak content.
 */
export type AiMcpObservedOutcome =
  | 'ok'
  | 'remote_error'
  | 'connect_error'
  | 'protocol_error'
  | 'idle_timeout'
  | 'total_timeout'
  | 'abort'
  | 'oversize'
  | 'unsupported_content'
  | 'policy_denied'
  | 'config_changed'
  | 'access_revoked'
  | 'schema_rejected'
  | 'capacity';

export type AiAssistantProfileOutcome =
  | 'policy_updated'
  | 'created'
  | 'updated'
  | 'deleted'
  | 'selected'
  | 'test_model_ok'
  | 'test_agent_ok'
  | 'test_agent_failed'
  | 'provider_config_changed'
  | 'policy_changed'
  | 'not_allowed'
  | 'disabled';

@Injectable()
export class AiOperationalMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiOperationalMetricsService.name);
  private summaryTimer?: NodeJS.Timeout;
  private readonly firstTokenRuns = new Set<string>();
  private readonly durations = {
    queueWait: durationMetric(),
    firstToken: durationMetric(),
    total: durationMetric(),
    cancel: durationMetric(),
  };
  private readonly terminalStatuses = new Map<string, number>();
  private readonly retrievalOutcomes = new Map<string, number>();
  private readonly retrievalLatency = durationMetric();
  private retrievalCandidateCount = 0;
  private retrievalValidCandidateCount = 0;
  private readonly fileLifecycle = new Map<string, number>();
  // Outbound external MCP. Deliberately identifier-free: no workspace, server,
  // tool, or user id, no URL, no namespace, no argument, and no output.
  private readonly mcpCacheEvents = new Map<string, number>();
  private readonly mcpCallOutcomes = new Map<string, number>();
  private readonly mcpCallLatency = durationMetric();
  private readonly mcpProbeOutcomes = new Map<string, number>();
  private readonly mcpProbeLatency = durationMetric();
  private readonly assistantProfileOutcomes = new Map<string, number>();
  private mcpWireBytes = 0;
  private mcpResultBytes = 0;
  private mcpActiveLeasesMax = 0;
  private mcpRetiringLeasesMax = 0;
  private attemptCount = 0;
  private attemptTotal = 0;
  private attemptMax = 0;
  private reconciledJobs = 0;

  onModuleInit(): void {
    this.summaryTimer = setInterval(() => this.flushSummary(), 60_000);
    this.summaryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.summaryTimer) clearInterval(this.summaryTimer);
  }

  observeDelta(run: AiRunEntity, observedAt = Date.now()): void {
    if (this.firstTokenRuns.has(run.id)) return;
    this.firstTokenRuns.add(run.id);
    this.observeDuration(
      this.durations.firstToken,
      observedAt - (run.startedAt ?? run.createdAt).getTime(),
    );
  }

  observeStatus(
    run: AiRunEntity,
    status: AiRunStatus,
    observedAt = Date.now(),
  ): void {
    if (status === 'running') {
      this.observeDuration(
        this.durations.queueWait,
        observedAt - run.createdAt.getTime(),
      );
      return;
    }
    if (!['completed', 'failed', 'cancelled'].includes(status)) return;

    this.increment(this.terminalStatuses, status);
    this.observeDuration(
      this.durations.total,
      observedAt - run.createdAt.getTime(),
    );
    if (run.cancelRequestedAt) {
      this.observeDuration(
        this.durations.cancel,
        observedAt - run.cancelRequestedAt.getTime(),
      );
    }
    this.attemptCount += 1;
    this.attemptTotal += run.attemptNo;
    this.attemptMax = Math.max(this.attemptMax, run.attemptNo);
    this.firstTokenRuns.delete(run.id);
  }

  observeRetrieval(outcome: string): void {
    this.increment(this.retrievalOutcomes, outcome);
  }

  observeRetrievalQuery(
    durationMs: number,
    candidateCount: number,
    validCandidateCount: number,
  ): void {
    this.observeDuration(this.retrievalLatency, durationMs);
    this.retrievalCandidateCount += Math.max(0, candidateCount);
    this.retrievalValidCandidateCount += Math.max(
      0,
      validCandidateCount,
    );
  }

  observeFileLifecycle(state: string): void {
    this.increment(this.fileLifecycle, state);
  }

  observeReconciledJob(): void {
    this.reconciledJobs += 1;
  }

  observeMcpCache(event: AiMcpCacheEvent): void {
    this.increment(this.mcpCacheEvents, event);
  }

  observeMcpProbe(
    mode: 'test' | 'discover',
    outcome: AiMcpObservedOutcome,
    durationMs: number,
  ): void {
    this.increment(this.mcpProbeOutcomes, `${mode}.${outcome}`);
    this.observeDuration(this.mcpProbeLatency, durationMs);
  }

  observeMcpCall(
    outcome: AiMcpObservedOutcome,
    durationMs: number,
    wireBytes: number,
    resultBytes: number,
  ): void {
    this.increment(this.mcpCallOutcomes, outcome);
    this.observeDuration(this.mcpCallLatency, durationMs);
    this.mcpWireBytes += Math.max(0, wireBytes);
    this.mcpResultBytes += Math.max(0, resultBytes);
  }

  observeMcpLeases(active: number, retiring: number): void {
    this.mcpActiveLeasesMax = Math.max(this.mcpActiveLeasesMax, active);
    this.mcpRetiringLeasesMax = Math.max(this.mcpRetiringLeasesMax, retiring);
  }

  observeProfileOutcome(outcome: AiAssistantProfileOutcome): void {
    this.increment(this.assistantProfileOutcomes, outcome);
  }

  getSnapshot() {
    return {
      durations: structuredClone(this.durations),
      terminalStatuses: Object.fromEntries(this.terminalStatuses),
      attempts: {
        count: this.attemptCount,
        average:
          this.attemptCount === 0 ? 0 : this.attemptTotal / this.attemptCount,
        max: this.attemptMax,
      },
      reconciledJobs: this.reconciledJobs,
      retrievalOutcomes: Object.fromEntries(this.retrievalOutcomes),
      retrievalQuery: {
        latency: structuredClone(this.retrievalLatency),
        candidateCount: this.retrievalCandidateCount,
        validCandidateCount: this.retrievalValidCandidateCount,
        invalidCandidateCount: Math.max(
          0,
          this.retrievalCandidateCount -
            this.retrievalValidCandidateCount,
        ),
      },
      fileLifecycle: Object.fromEntries(this.fileLifecycle),
      externalMcp: {
        cache: Object.fromEntries(this.mcpCacheEvents),
        probe: {
          outcomes: Object.fromEntries(this.mcpProbeOutcomes),
          latency: structuredClone(this.mcpProbeLatency),
        },
        calls: {
          outcomes: Object.fromEntries(this.mcpCallOutcomes),
          latency: structuredClone(this.mcpCallLatency),
          wireBytes: this.mcpWireBytes,
          resultBytes: this.mcpResultBytes,
        },
        leases: {
          activeMax: this.mcpActiveLeasesMax,
          retiringMax: this.mcpRetiringLeasesMax,
        },
      },
      assistantProfiles: {
        outcomes: Object.fromEntries(this.assistantProfileOutcomes),
      },
    };
  }

  flushSummary(): void {
    const snapshot = this.getSnapshot();
    if (!this.hasActivity(snapshot)) return;
    this.logger.log(
      JSON.stringify({
        component: 'ai',
        event: 'operational.summary',
        intervalSeconds: 60,
        ...snapshot,
      }),
    );
    this.reset();
  }

  private observeDuration(metric: DurationMetric, value: number): void {
    const duration = Math.max(0, Math.round(value));
    metric.count += 1;
    metric.totalMs += duration;
    metric.maxMs = Math.max(metric.maxMs, duration);
  }

  private increment(target: Map<string, number>, key: string): void {
    target.set(key, (target.get(key) ?? 0) + 1);
  }

  private hasActivity(snapshot: ReturnType<typeof this.getSnapshot>): boolean {
    return (
      Object.values(snapshot.durations).some((metric) => metric.count > 0) ||
      Object.keys(snapshot.terminalStatuses).length > 0 ||
      snapshot.reconciledJobs > 0 ||
      Object.keys(snapshot.retrievalOutcomes).length > 0 ||
      snapshot.retrievalQuery.latency.count > 0 ||
      Object.keys(snapshot.fileLifecycle).length > 0 ||
      Object.keys(snapshot.externalMcp.cache).length > 0 ||
      Object.keys(snapshot.externalMcp.probe.outcomes).length > 0 ||
      Object.keys(snapshot.externalMcp.calls.outcomes).length > 0 ||
      snapshot.externalMcp.leases.activeMax > 0 ||
      Object.keys(snapshot.assistantProfiles.outcomes).length > 0
    );
  }

  private reset(): void {
    for (const metric of Object.values(this.durations)) {
      Object.assign(metric, durationMetric());
    }
    this.terminalStatuses.clear();
    this.retrievalOutcomes.clear();
    Object.assign(this.retrievalLatency, durationMetric());
    this.retrievalCandidateCount = 0;
    this.retrievalValidCandidateCount = 0;
    this.fileLifecycle.clear();
    this.mcpCacheEvents.clear();
    this.mcpCallOutcomes.clear();
    Object.assign(this.mcpCallLatency, durationMetric());
    this.mcpProbeOutcomes.clear();
    this.assistantProfileOutcomes.clear();
    Object.assign(this.mcpProbeLatency, durationMetric());
    this.mcpWireBytes = 0;
    this.mcpResultBytes = 0;
    this.mcpActiveLeasesMax = 0;
    this.mcpRetiringLeasesMax = 0;
    this.attemptCount = 0;
    this.attemptTotal = 0;
    this.attemptMax = 0;
    this.reconciledJobs = 0;
  }
}
