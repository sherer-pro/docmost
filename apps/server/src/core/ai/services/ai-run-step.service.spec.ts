import { approvedStepRecoveryAction } from './ai-run-step-recovery';

describe('approvedStepRecoveryAction', () => {
  const base = 'a'.repeat(64);
  const expected = 'b'.repeat(64);

  it('reapplies a durable approval only when the page is still at its base hash', () => {
    expect(approvedStepRecoveryAction(base, expected, base)).toBe('apply');
  });

  it('completes recovery without replay when the expected hash is already live', () => {
    expect(approvedStepRecoveryAction(base, expected, expected)).toBe(
      'complete',
    );
  });

  it('fails safely for a conflicting page or a legacy step without an expected hash', () => {
    expect(approvedStepRecoveryAction(base, expected, 'c'.repeat(64))).toBe(
      'stale',
    );
    expect(approvedStepRecoveryAction(base, null, base)).toBe('stale');
  });
});
