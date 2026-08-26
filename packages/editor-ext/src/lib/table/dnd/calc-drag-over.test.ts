// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { getDragOverColumn } from './calc-drag-over';

function rect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    top: 0,
    bottom: 100,
    width,
    height: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

describe('getDragOverColumn', () => {
  it('uses logical col geometry from the managed colgroup', () => {
    const table = document.createElement('table');
    const colgroup = table.appendChild(document.createElement('colgroup'));
    const columns = [100, 160, 90].map((width) =>
      colgroup.appendChild(document.createElement('col')),
    );
    let left = 0;
    columns.forEach((column, index) => {
      const width = [100, 160, 90][index];
      vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(
        rect(left, width),
      );
      left += width;
    });

    expect(getDragOverColumn(table, 180)?.[1]).toBe(1);
    expect(getDragOverColumn(table, 400)?.[1]).toBe(2);
  });

  it('splits a merged fallback cell into logical column segments', () => {
    const table = document.createElement('table');
    const row = table.insertRow();
    const merged = row.insertCell();
    const last = row.insertCell();
    merged.colSpan = 2;
    vi.spyOn(merged, 'getBoundingClientRect').mockReturnValue(rect(0, 200));
    vi.spyOn(last, 'getBoundingClientRect').mockReturnValue(rect(200, 100));

    expect(getDragOverColumn(table, 50)?.[1]).toBe(0);
    expect(getDragOverColumn(table, 150)?.[1]).toBe(1);
    expect(getDragOverColumn(table, 250)?.[1]).toBe(2);
  });
});
