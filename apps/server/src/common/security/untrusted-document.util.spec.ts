import {
  assertPdfCanvasWithinBudget,
  withDeadline,
} from './untrusted-document.util';

describe('untrusted document budgets', () => {
  it('enforces per-page and cumulative PDF pixel limits', () => {
    const budget = {
      maxDimension: 8192,
      maxPixelsPerPage: 16_777_216,
      maxCumulativePixels: 20_000_000,
    };

    expect(assertPdfCanvasWithinBudget(4000, 4000, 0, budget)).toBe(
      16_000_000,
    );
    expect(() =>
      assertPdfCanvasWithinBudget(9000, 10, 0, budget),
    ).toThrow('dimensions');
    expect(() =>
      assertPdfCanvasWithinBudget(5000, 5000, 0, budget),
    ).toThrow('pixel count');
    expect(() =>
      assertPdfCanvasWithinBudget(2000, 2000, 18_000_000, budget),
    ).toThrow('cumulative');
  });

  it('rejects work that outlives its deadline', async () => {
    jest.useFakeTimers();
    const operation = new Promise<string>(() => undefined);
    const result = withDeadline(operation, Date.now() + 100, 'timed out');
    const rejection = expect(result).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(101);
    await rejection;
    jest.useRealTimers();
  });
});
