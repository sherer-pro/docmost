import { describe, expect, it } from "vitest";
import {
  estimateReadingTime,
  getReadingTimeColorProgress,
} from "./reading-time";

describe("estimateReadingTime", () => {
  it.each([
    [0, "less-than-minute", 0, 1],
    [1, "less-than-minute", 0, 1],
    [199, "less-than-minute", 0, 1],
    [200, "minutes", 1, 1],
    [201, "minutes", 2, 2],
    [1000, "minutes", 5, 5],
    [4200, "minutes", 21, 21],
    [6000, "minutes", 30, 30],
    [6001, "over-limit", 31, 30],
  ] as const)("maps %i words to %s", (wordCount, kind, minutes, colorStep) => {
    expect(estimateReadingTime(wordCount)).toMatchObject({
      kind,
      minutes,
      colorStep,
    });
  });

  it("treats invalid and negative word counts as empty content", () => {
    expect(estimateReadingTime(Number.NaN).kind).toBe("less-than-minute");
    expect(estimateReadingTime(-10).kind).toBe("less-than-minute");
  });
});

describe("getReadingTimeColorProgress", () => {
  it("creates a unique, monotonic color for every minute", () => {
    const progress = Array.from({ length: 30 }, (_, index) =>
      getReadingTimeColorProgress(index + 1),
    );

    expect(new Set(progress).size).toBe(30);
    expect(
      progress.every(
        (value, index) => index === 0 || value > progress[index - 1],
      ),
    ).toBe(true);
  });

  it("keeps the first twelve steps in the green part of the gradient", () => {
    expect(getReadingTimeColorProgress(1)).toBe(0);
    expect(getReadingTimeColorProgress(12)).toBe(12);
    expect(getReadingTimeColorProgress(13)).toBeGreaterThan(12);
    expect(getReadingTimeColorProgress(30)).toBe(100);
  });
});
