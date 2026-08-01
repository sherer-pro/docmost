export function logCycleFailures(
  results: PromiseSettledResult<unknown>[],
  write: (message: string) => void = console.error,
): void {
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length === 0) return;
  const errorCodes: Record<string, number> = {};
  for (const failure of failures) {
    const code = errorCode(failure.reason);
    errorCodes[code] = (errorCodes[code] ?? 0) + 1;
  }
  write(
    JSON.stringify({
      component: 'rag-sync',
      event: 'cycle.failed',
      failedBindings: failures.length,
      errorCodes,
    }),
  );
}

function errorCode(error: unknown): string {
  const status = Number((error as { status?: unknown })?.status);
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'remote_unavailable';
  if ((error as Error)?.name === 'AbortError') return 'timeout';
  return 'sync_failed';
}
