import { PerformanceDiagnosticsService } from './performance-diagnostics.service';

describe('PerformanceDiagnosticsService', () => {
  it('stores only aggregate route-template diagnostics', () => {
    const service = new PerformanceDiagnosticsService({
      isPerformanceDiagnosticsEnabled: () => true,
    } as any);

    service.beginRequest();
    service.recordRequest({
      method: 'GET',
      route: '/api/pages/:pageId',
      statusCode: 200,
      durationMs: 42,
    });

    const snapshot = service.buildSnapshot();
    expect(snapshot.activeRequests).toBe(0);
    expect(snapshot.routes).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/api/pages/:pageId',
        count: 1,
        statusClasses: { '2xx': 1 },
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('userId');
    expect(JSON.stringify(snapshot)).not.toContain('query');

    service.onModuleDestroy();
  });
});
