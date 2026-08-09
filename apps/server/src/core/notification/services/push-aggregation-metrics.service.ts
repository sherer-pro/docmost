import { Injectable } from '@nestjs/common';
import { PushNotificationFinalizeResult } from '@docmost/db/repos/push-notification-job/push-notification-job.repo';

export interface PushAggregationOperationalSnapshot {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  leaseLost: number;
  reconciled: number;
  superseded: number;
  batches: number;
  durationMs: {
    average: number;
    maximum: number;
  };
}

@Injectable()
export class PushAggregationMetricsService {
  private claimed = 0;
  private completed = 0;
  private retried = 0;
  private failed = 0;
  private leaseLost = 0;
  private reconciled = 0;
  private superseded = 0;
  private batches = 0;
  private durationMsTotal = 0;
  private durationMsMaximum = 0;

  recordClaim(claimed: number, reconciled: number): void {
    this.claimed += claimed;
    this.reconciled += reconciled;
  }

  recordDeliveryFailure(): void {
    this.failed += 1;
  }

  recordLeaseLost(): void {
    this.leaseLost += 1;
  }

  recordFinalized(
    result: PushNotificationFinalizeResult,
    durationMs: number,
  ): void {
    this.completed += result.sent + result.cancelled;
    this.retried += result.retried;
    this.superseded += result.superseded;
    this.batches += 1;
    this.durationMsTotal += durationMs;
    this.durationMsMaximum = Math.max(this.durationMsMaximum, durationMs);
  }

  getSnapshot(): PushAggregationOperationalSnapshot {
    return {
      claimed: this.claimed,
      completed: this.completed,
      retried: this.retried,
      failed: this.failed,
      leaseLost: this.leaseLost,
      reconciled: this.reconciled,
      superseded: this.superseded,
      batches: this.batches,
      durationMs: {
        average:
          this.batches === 0
            ? 0
            : Math.round(this.durationMsTotal / this.batches),
        maximum: this.durationMsMaximum,
      },
    };
  }
}
