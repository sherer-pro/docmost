export const READING_WORDS_PER_MINUTE = 238;
export const MAX_READING_TIME_MINUTES = 30;
export const GREEN_READING_TIME_MINUTES = 12;

export type ReadingTimeKind = "less-than-minute" | "minutes" | "over-limit";

export interface ReadingTimeEstimate {
  kind: ReadingTimeKind;
  minutes: number;
  colorStep: number;
  colorProgress: number;
}

function normalizeWordCount(wordCount: number): number {
  if (!Number.isFinite(wordCount)) {
    return 0;
  }

  return Math.max(0, Math.floor(wordCount));
}

export function getReadingTimeColorProgress(colorStep: number): number {
  const step = Math.min(
    MAX_READING_TIME_MINUTES,
    Math.max(1, Math.floor(colorStep)),
  );

  if (step <= GREEN_READING_TIME_MINUTES) {
    return (
      ((step - 1) / (GREEN_READING_TIME_MINUTES - 1)) *
      GREEN_READING_TIME_MINUTES
    );
  }

  return (
    GREEN_READING_TIME_MINUTES +
    ((step - GREEN_READING_TIME_MINUTES) /
      (MAX_READING_TIME_MINUTES - GREEN_READING_TIME_MINUTES)) *
      (100 - GREEN_READING_TIME_MINUTES)
  );
}

export function estimateReadingTime(wordCount: number): ReadingTimeEstimate {
  const normalizedWordCount = normalizeWordCount(wordCount);

  if (normalizedWordCount < READING_WORDS_PER_MINUTE) {
    return {
      kind: "less-than-minute",
      minutes: 0,
      colorStep: 1,
      colorProgress: getReadingTimeColorProgress(1),
    };
  }

  const minutes = Math.ceil(normalizedWordCount / READING_WORDS_PER_MINUTE);
  const colorStep = Math.min(minutes, MAX_READING_TIME_MINUTES);

  return {
    kind: minutes > MAX_READING_TIME_MINUTES ? "over-limit" : "minutes",
    minutes,
    colorStep,
    colorProgress: getReadingTimeColorProgress(colorStep),
  };
}
