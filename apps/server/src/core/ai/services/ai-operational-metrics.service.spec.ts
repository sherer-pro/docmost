import { AiOperationalMetricsService } from './ai-operational-metrics.service';

describe('AiOperationalMetricsService', () => {
  it('records safe aggregate run, retrieval, reconciliation, and file metrics', () => {
    const metrics = new AiOperationalMetricsService();
    const run = {
      id: 'run-id',
      createdAt: new Date(1_000),
      startedAt: new Date(1_100),
      cancelRequestedAt: new Date(1_300),
      attemptNo: 2,
    } as any;

    metrics.observeStatus(run, 'running', 1_100);
    metrics.observeDelta(run, 1_250);
    metrics.observeDelta(run, 1_275);
    metrics.observeStatus(run, 'cancelled', 1_500);
    metrics.observeRetrieval('empty');
    metrics.observeReconciledJob();
    metrics.observeFileLifecycle('storage_deleted');

    expect(metrics.getSnapshot()).toEqual({
      durations: {
        queueWait: { count: 1, totalMs: 100, maxMs: 100 },
        firstToken: { count: 1, totalMs: 150, maxMs: 150 },
        total: { count: 1, totalMs: 500, maxMs: 500 },
        cancel: { count: 1, totalMs: 200, maxMs: 200 },
      },
      terminalStatuses: { cancelled: 1 },
      attempts: { count: 1, average: 2, max: 2 },
      reconciledJobs: 1,
      retrievalOutcomes: { empty: 1 },
      fileLifecycle: { storage_deleted: 1 },
    });
  });
});
