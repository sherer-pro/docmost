/**
 * Minimal smoke test to ensure that Jest can collect backend coverage
 * without transformer conflicts.
 */
describe('coverage smoke', () => {
  it('должен успешно проходить в режиме coverage', () => {
    // The test is intentionally trivial: it gives an early signal if the coverage pipeline breaks.
    expect(true).toBe(true);
  });
});
