// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { getTableContentWidth } from './table-view';

describe('table view width budget', () => {
  it('reserves the collapsed outer border from the column budget', () => {
    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    const row = table.insertRow();
    const firstCell = row.insertCell();
    const lastCell = row.insertCell();
    firstCell.style.borderLeft = '1px solid black';
    lastCell.style.borderRight = '1px solid black';
    document.body.appendChild(table);

    expect(getTableContentWidth(table, 600)).toBe(599);
  });

  it('keeps the full budget for separate table borders', () => {
    const table = document.createElement('table');
    table.style.borderCollapse = 'separate';

    expect(getTableContentWidth(table, 600)).toBe(600);
  });
});
