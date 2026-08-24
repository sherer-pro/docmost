import {
  HEAP_CRITICAL_REMINDER_MS,
  HeapPressureStateMachine,
  PerformanceDiagnosticsService,
  type RuntimeMemorySnapshot,
} from './performance-diagnostics.service';

function memorySnapshot(heapRatio: number): RuntimeMemorySnapshot {
  return {
    rssBytes: 256,
    heapUsedBytes: heapRatio * 100,
    heapTotalBytes: 100,
    heapLimitBytes: 100,
    externalBytes: 8,
    arrayBuffersBytes: 4,
    heapRatio,
    uptimeSeconds: 30,
  };
}

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
    expect(snapshot.memory).toEqual(
      expect.objectContaining({
        heapTotalBytes: expect.any(Number),
        heapLimitBytes: expect.any(Number),
        externalBytes: expect.any(Number),
        arrayBuffersBytes: expect.any(Number),
        heapRatio: expect.any(Number),
        uptimeSeconds: expect.any(Number),
      }),
    );

    service.onModuleDestroy();
  });

  it('keeps heap monitoring active when detailed diagnostics are disabled', () => {
    jest.useFakeTimers();
    const service = new PerformanceDiagnosticsService({
      isPerformanceDiagnosticsEnabled: () => false,
    } as any);

    service.onModuleInit();

    expect(jest.getTimerCount()).toBe(1);
    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});

describe('HeapPressureStateMachine', () => {
  it('requires two warning samples at or above 85 percent', () => {
    const machine = new HeapPressureStateMachine();

    expect(machine.observe(memorySnapshot(0.85), 0)).toBeUndefined();
    expect(machine.observe(memorySnapshot(0.86), 30_000)).toEqual(
      expect.objectContaining({ level: 'warning', state: 'warning' }),
    );
  });

  it('emits critical immediately at or above 95 percent', () => {
    const machine = new HeapPressureStateMachine();

    expect(machine.observe(memorySnapshot(0.95), 0)).toEqual(
      expect.objectContaining({ level: 'critical', state: 'critical' }),
    );
  });

  it('requires two samples below 75 percent before recovery', () => {
    const machine = new HeapPressureStateMachine();
    machine.observe(memorySnapshot(0.95), 0);

    expect(machine.observe(memorySnapshot(0.74), 30_000)).toBeUndefined();
    expect(machine.observe(memorySnapshot(0.74), 60_000)).toEqual(
      expect.objectContaining({ level: 'recovery', state: 'normal' }),
    );
  });

  it('preserves hysteresis between warning and recovery thresholds', () => {
    const machine = new HeapPressureStateMachine();
    machine.observe(memorySnapshot(0.85), 0);
    machine.observe(memorySnapshot(0.86), 30_000);

    expect(machine.observe(memorySnapshot(0.8), 60_000)).toBeUndefined();
    expect(machine.observe(memorySnapshot(0.74), 90_000)).toBeUndefined();
    expect(machine.observe(memorySnapshot(0.8), 120_000)).toBeUndefined();
  });

  it('repeats critical events every five minutes while pressure persists', () => {
    const machine = new HeapPressureStateMachine();
    machine.observe(memorySnapshot(0.95), 0);

    expect(
      machine.observe(memorySnapshot(0.9), HEAP_CRITICAL_REMINDER_MS - 1),
    ).toBeUndefined();
    expect(
      machine.observe(memorySnapshot(0.9), HEAP_CRITICAL_REMINDER_MS),
    ).toEqual(expect.objectContaining({ level: 'critical', state: 'critical' }));
  });

  it('emits only privacy-safe memory fields', () => {
    const machine = new HeapPressureStateMachine();
    const event = machine.observe(memorySnapshot(0.95), 0);
    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('query');
    expect(serialized).not.toContain('cookie');
    expect(serialized).not.toContain('url');
    expect(Object.keys(event ?? {}).sort()).toEqual(
      [
        'arrayBuffersBytes',
        'event',
        'externalBytes',
        'heapLimitBytes',
        'heapRatio',
        'heapTotalBytes',
        'heapUsedBytes',
        'level',
        'rssBytes',
        'state',
        'uptimeSeconds',
      ].sort(),
    );
  });
});
