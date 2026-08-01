import { AiOperationalMetricsService } from './ai-operational-metrics.service';
import { Logger } from '@nestjs/common';

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
    metrics.observeRetrievalQuery(12, 5, 3);
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
      retrievalQuery: {
        latency: { count: 1, totalMs: 12, maxMs: 12 },
        candidateCount: 5,
        validCandidateCount: 3,
        invalidCandidateCount: 2,
      },
      fileLifecycle: { storage_deleted: 1 },
    });
  });

  it('logs and resets a low-cardinality periodic summary', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const metrics = new AiOperationalMetricsService();
    const run = {
      id: 'long-running-run',
      createdAt: new Date(0),
      startedAt: new Date(10),
    } as any;
    metrics.observeDelta(run, 20);
    metrics.observeRetrieval('success');
    metrics.observeRetrievalQuery(25, 4, 4);

    metrics.flushSummary();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"operational.summary"'),
    );
    expect(log.mock.calls[0][0]).not.toContain('userId');
    expect(metrics.getSnapshot().retrievalQuery.latency.count).toBe(0);
    metrics.observeDelta(run, 30);
    expect(metrics.getSnapshot().durations.firstToken.count).toBe(0);
    metrics.flushSummary();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
