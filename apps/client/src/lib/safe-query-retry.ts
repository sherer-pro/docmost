export function shouldRetrySafeQuery(
  failureCount: number,
  error: unknown,
  maxRetries = 2,
): boolean {
  if (failureCount >= maxRetries) {
    return false;
  }

  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  return status === undefined || (status >= 500 && status < 600);
}

export function safeQueryRetryDelay(attemptIndex: number): number {
  return Math.min(500 * 2 ** attemptIndex, 2_000);
}
