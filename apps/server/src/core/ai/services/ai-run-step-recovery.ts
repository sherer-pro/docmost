export type ApprovedStepRecoveryAction = 'apply' | 'complete' | 'stale';

export function approvedStepRecoveryAction(
  baseContentHash: string | null,
  expectedAfterHash: string | null,
  currentContentHash: string,
): ApprovedStepRecoveryAction {
  if (!baseContentHash || !expectedAfterHash) {
    return 'stale';
  }
  if (currentContentHash === expectedAfterHash) {
    return 'complete';
  }
  if (currentContentHash === baseContentHash) {
    return 'apply';
  }
  return 'stale';
}
