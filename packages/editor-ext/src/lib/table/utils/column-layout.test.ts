import { describe, expect, it } from 'vitest';

import { allocateTableColumnWidths } from './column-layout';

const options = {
  columnCount: 3,
  containerWidth: 600,
  minColumnWidth: 48,
};

describe('allocateTableColumnWidths', () => {
  it('keeps equal proportions while content fits its current column', () => {
    expect(
      allocateTableColumnWidths({
        ...options,
        demands: [{ start: 0, span: 1, minimumWidth: 80, preferredWidth: 199 }],
      }),
    ).toEqual([200, 200, 200]);
  });

  it('redistributes spare width proportionally without growing the table', () => {
    const widths = allocateTableColumnWidths({
      ...options,
      demands: [{ start: 0, span: 1, minimumWidth: 120, preferredWidth: 300 }],
    });

    expect(widths).toEqual([300, 150, 150]);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(600);
  });

  it('stops shrinking donor columns at the structural minimum', () => {
    const widths = allocateTableColumnWidths({
      ...options,
      demands: [{ start: 0, span: 1, minimumWidth: 300, preferredWidth: 900 }],
    });

    expect(widths).toEqual([504, 48, 48]);
    expect(widths[0]).toBeLessThan(900);
  });

  it('does not shrink donor columns below their measured demand', () => {
    const widths = allocateTableColumnWidths({
      ...options,
      demands: [
        { start: 0, span: 1, minimumWidth: 300, preferredWidth: 900 },
        { start: 1, span: 1, minimumWidth: 120, preferredWidth: 120 },
        { start: 2, span: 1, minimumWidth: 150, preferredWidth: 150 },
      ],
    });

    expect(widths).toEqual([330, 120, 150]);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(600);
  });

  it('returns to equal proportions after long content is removed', () => {
    const longContentWidths = allocateTableColumnWidths({
      ...options,
      demands: [{ start: 0, span: 1, minimumWidth: 300, preferredWidth: 300 }],
    });
    const shortContentWidths = allocateTableColumnWidths({
      ...options,
      demands: [{ start: 0, span: 1, minimumWidth: 80, preferredWidth: 100 }],
    });

    expect(longContentWidths).toEqual([300, 150, 150]);
    expect(shortContentWidths).toEqual([200, 200, 200]);
  });

  it('recomputes equal proportions when the container becomes wide enough', () => {
    expect(
      allocateTableColumnWidths({
        ...options,
        containerWidth: 900,
        demands: [
          { start: 0, span: 1, minimumWidth: 120, preferredWidth: 300 },
        ],
      }),
    ).toEqual([300, 300, 300]);
  });

  it('treats a colspan demand as one constraint across its logical columns', () => {
    expect(
      allocateTableColumnWidths({
        ...options,
        demands: [
          { start: 0, span: 2, minimumWidth: 200, preferredWidth: 500 },
        ],
      }),
    ).toEqual([250, 250, 100]);
  });

  it('uses the structural minimum when the container is too narrow', () => {
    const widths = allocateTableColumnWidths({
      columnCount: 4,
      containerWidth: 100,
      minColumnWidth: 48,
      demands: [],
    });

    expect(widths).toEqual([48, 48, 48, 48]);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(192);
  });

  it('uses distinct intrinsic minima when content overflows the container', () => {
    const widths = allocateTableColumnWidths({
      columnCount: 4,
      containerWidth: 300,
      minColumnWidth: 48,
      demands: [
        { start: 0, span: 1, minimumWidth: 80, preferredWidth: 80 },
        { start: 1, span: 1, minimumWidth: 120, preferredWidth: 180 },
        { start: 2, span: 1, minimumWidth: 160, preferredWidth: 240 },
        { start: 3, span: 1, minimumWidth: 60, preferredWidth: 60 },
      ],
    });

    expect(widths).toEqual([80, 120, 160, 60]);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(420);
  });

  it('keeps the rounded width budget without violating column minima', () => {
    const widths = allocateTableColumnWidths({
      columnCount: 3,
      containerWidth: 601,
      minColumnWidth: 48,
      demands: [
        { start: 0, span: 1, minimumWidth: 220, preferredWidth: 220 },
        { start: 1, span: 1, minimumWidth: 90, preferredWidth: 90 },
        { start: 2, span: 1, minimumWidth: 50, preferredWidth: 50 },
      ],
    });

    expect(widths[0]).toBeGreaterThanOrEqual(220);
    expect(widths[1]).toBeGreaterThanOrEqual(90);
    expect(widths[2]).toBeGreaterThanOrEqual(50);
    expect(widths.reduce((total, width) => total + width, 0)).toBeCloseTo(601);
  });
});
