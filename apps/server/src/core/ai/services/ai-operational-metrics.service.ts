import { Injectable } from '@nestjs/common';
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

@Injectable()
export class AiOperationalMetricsService {
  private readonly firstTokenRuns = new Set<string>();
  private readonly durations = {
    queueWait: durationMetric(),
    firstToken: durationMetric(),
    total: durationMetric(),
    cancel: durationMetric(),
  };
  private readonly terminalStatuses = new Map<string, number>();
  private readonly retrievalOutcomes = new Map<string, number>();
  private readonly fileLifecycle = new Map<string, number>();
  private attemptCount = 0;
  private attemptTotal = 0;
  private attemptMax = 0;
  private reconciledJobs = 0;

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

  observeFileLifecycle(state: string): void {
    this.increment(this.fileLifecycle, state);
  }

  observeReconciledJob(): void {
    this.reconciledJobs += 1;
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
      fileLifecycle: Object.fromEntries(this.fileLifecycle),
    };
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
}
