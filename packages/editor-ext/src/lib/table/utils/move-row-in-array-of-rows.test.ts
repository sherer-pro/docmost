import { describe, expect, it } from 'vitest';
import { moveRowInArrayOfRows } from './move-row-in-array-of-rows';

describe('moveRowInArrayOfRows', () => {
  it('moves a row down after the target range', () => {
    expect(moveRowInArrayOfRows(['a', 'b', 'c', 'd'], [1], [3], 0)).toEqual([
      'a',
      'c',
      'd',
      'b',
    ]);
  });

  it('moves a row up before the target range', () => {
    expect(moveRowInArrayOfRows(['a', 'b', 'c', 'd'], [3], [1], 0)).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
  });

  it('keeps multi-row moves stable with explicit direction override', () => {
    expect(
      moveRowInArrayOfRows(['a', 'b', 'c', 'd', 'e'], [1, 2], [4], -1),
    ).toEqual(['a', 'd', 'e', 'b', 'c']);
  });
});
