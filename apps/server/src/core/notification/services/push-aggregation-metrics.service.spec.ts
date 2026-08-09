import { PushAggregationMetricsService } from './push-aggregation-metrics.service';

describe('PushAggregationMetricsService', () => {
  it('exposes only low-cardinality aggregate counters and durations', () => {
    const metrics = new PushAggregationMetricsService();

    metrics.recordClaim(3, 1);
    metrics.recordDeliveryFailure();
    metrics.recordLeaseLost();
    metrics.recordFinalized(
      { sent: 1, cancelled: 1, retried: 1, superseded: 1 },
      40,
    );
    metrics.recordFinalized(
      { sent: 1, cancelled: 0, retried: 0, superseded: 0 },
      20,
    );

    expect(metrics.getSnapshot()).toEqual({
      claimed: 3,
      completed: 3,
      retried: 1,
      failed: 1,
      leaseLost: 1,
      reconciled: 1,
      superseded: 1,
      batches: 2,
      durationMs: { average: 30, maximum: 40 },
    });
  });
});
