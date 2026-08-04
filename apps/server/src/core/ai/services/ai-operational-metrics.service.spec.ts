import { AiOperationalMetricsService } from './ai-operational-metrics.service';
import { Logger } from '@nestjs/common';

describe('AiOperationalMetricsService', () => {
  // Logger.prototype is shared, so an unrestored spy would accumulate calls
  // from earlier tests and break call-count assertions later in the file.
  afterEach(() => {
    jest.restoreAllMocks();
  });

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
    metrics.observeMcpCache('miss');
    metrics.observeMcpProbe('discover', 'ok', 40);
    metrics.observeMcpCall('remote_error', 30, 2_048, 512);
    metrics.observeMcpLeases(3, 1);

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
      externalMcp: {
        cache: { miss: 1 },
        probe: {
          outcomes: { 'discover.ok': 1 },
          latency: { count: 1, totalMs: 40, maxMs: 40 },
        },
        calls: {
          outcomes: { remote_error: 1 },
          latency: { count: 1, totalMs: 30, maxMs: 30 },
          wireBytes: 2_048,
          resultBytes: 512,
        },
        leases: { activeMax: 3, retiringMax: 1 },
      },
    });
  });

  it('resets every external MCP counter on flush', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const metrics = new AiOperationalMetricsService();

    metrics.observeMcpCache('hit');
    metrics.observeMcpProbe('test', 'connect_error', 5);
    metrics.observeMcpCall('ok', 10, 100, 20);
    metrics.observeMcpLeases(2, 2);
    metrics.flushSummary();

    expect(metrics.getSnapshot().externalMcp).toEqual({
      cache: {},
      probe: { outcomes: {}, latency: { count: 0, totalMs: 0, maxMs: 0 } },
      calls: {
        outcomes: {},
        latency: { count: 0, totalMs: 0, maxMs: 0 },
        wireBytes: 0,
        resultBytes: 0,
      },
      leases: { activeMax: 0, retiringMax: 0 },
    });
  });

  it('emits a summary for external MCP activity alone', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const metrics = new AiOperationalMetricsService();

    metrics.observeMcpCall('idle_timeout', 15_000, 0, 0);
    metrics.flushSummary();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"idle_timeout":1'),
    );
    // No identifier, URL, namespace, argument, or output may appear.
    const line = log.mock.calls[0][0] as string;
    expect(line).not.toMatch(/https?:\/\//);
    expect(line).not.toContain('serverId');
    expect(line).not.toContain('workspaceId');
    expect(line).not.toContain('namespace');
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
