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
        demands: [{ start: 0, span: 1, width: 199 }],
      }),
    ).toEqual([200, 200, 200]);
  });

  it('redistributes spare width proportionally without growing the table', () => {
    const widths = allocateTableColumnWidths({
      ...options,
      demands: [{ start: 0, span: 1, width: 300 }],
    });

    expect(widths).toEqual([300, 150, 150]);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(600);
  });

  it('stops shrinking donor columns at the structural minimum', () => {
    const widths = allocateTableColumnWidths({
      ...options,
      demands: [
        { start: 0, span: 1, width: 900 },
        { start: 1, span: 1, width: 150 },
        { start: 2, span: 1, width: 150 },
      ],
    });

    expect(widths).toEqual([504, 48, 48]);
    expect(widths[0]).toBeLessThan(900);
  });

  it('returns to equal proportions after long content is removed', () => {
    const longContentWidths = allocateTableColumnWidths({
      ...options,
      demands: [{ start: 0, span: 1, width: 300 }],
    });
    const shortContentWidths = allocateTableColumnWidths({
      ...options,
      demands: [{ start: 0, span: 1, width: 100 }],
    });

    expect(longContentWidths).toEqual([300, 150, 150]);
    expect(shortContentWidths).toEqual([200, 200, 200]);
  });

  it('recomputes equal proportions when the container becomes wide enough', () => {
    expect(
      allocateTableColumnWidths({
        ...options,
        containerWidth: 900,
        demands: [{ start: 0, span: 1, width: 300 }],
      }),
    ).toEqual([300, 300, 300]);
  });

  it('treats a colspan demand as one constraint across its logical columns', () => {
    expect(
      allocateTableColumnWidths({
        ...options,
        demands: [{ start: 0, span: 2, width: 500 }],
      }),
    ).toEqual([250, 250, 100]);
  });

  it('uses horizontal overflow only for the structural minimum', () => {
    const widths = allocateTableColumnWidths({
      columnCount: 4,
      containerWidth: 100,
      minColumnWidth: 48,
      demands: [],
    });

    expect(widths).toEqual([48, 48, 48, 48]);
    expect(widths.reduce((total, width) => total + width, 0)).toBe(192);
  });
});
