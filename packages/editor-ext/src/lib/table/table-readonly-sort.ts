import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  compareTableCellText,
  getNextTableSortState,
  type TableSortDirection,
  type TableSortState,
} from './utils';

const CHEVRON_CLASS = 'tableReadonlySortChevron';

const tableReadonlySortKey = new PluginKey('tableReadonlySort');

const sortStates = new WeakMap<HTMLTableElement, TableSortState>();
const originalOrders = new WeakMap<HTMLTableElement, HTMLTableRowElement[]>();

const CHEVRON_SVG =
  '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
  '<path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />' +
  '</svg>';

function getColumnIndex(th: HTMLTableCellElement): number {
  const row = th.parentElement as HTMLTableRowElement;
  if (!row) return -1;

  let col = 0;
  for (let i = 0; i < row.cells.length; i += 1) {
    if (row.cells[i] === th) return col;

    col += row.cells[i].colSpan ?? 1;
  }

  return -1;
}

function getHeaderTh(target: EventTarget | null): HTMLTableCellElement | null {
  if (!(target instanceof Element)) return null;

  const th = target.closest('th') as HTMLTableCellElement | null;
  if (!th) return null;

  const row = th.parentElement;
  if (!row) return null;

  const table = row.closest('table');
  if (!table) return null;

  const firstRow = table.querySelector('tr');
  if (firstRow !== row) return null;

  return th;
}

function getCellText(
  row: HTMLTableRowElement,
  colIndex: number,
): string | null {
  let col = 0;

  for (let i = 0; i < row.cells.length; i += 1) {
    const cell = row.cells[i];
    const colspan = cell.colSpan ?? 1;

    if (colIndex >= col && colIndex < col + colspan) {
      if (col !== colIndex || colspan !== 1 || (cell.rowSpan ?? 1) !== 1) {
        return null;
      }

      return cell.textContent?.trim() ?? '';
    }

    col += colspan;
  }

  return null;
}

function getOrSaveOriginalOrder(
  table: HTMLTableElement,
  dataRows: HTMLTableRowElement[],
): HTMLTableRowElement[] {
  if (!originalOrders.has(table)) {
    originalOrders.set(table, [...dataRows]);
  }

  return originalOrders.get(table)!;
}

function sortDataRows(
  dataRows: HTMLTableRowElement[],
  colIndex: number,
  direction: TableSortDirection,
): HTMLTableRowElement[] | null {
  const rowsWithText: Array<{
    row: HTMLTableRowElement;
    text: string;
    index: number;
  }> = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];

    if (Array.from(row.cells).some((cell) => (cell.rowSpan ?? 1) !== 1)) {
      return null;
    }

    const text = getCellText(row, colIndex);

    if (text === null) {
      return null;
    }

    rowsWithText.push({ row, text, index });
  }

  return rowsWithText
    .sort((a, b) => {
      const cmp = compareTableCellText(a.text, b.text, direction);

      return cmp === 0 ? a.index - b.index : cmp;
    })
    .map((item) => item.row);
}

function isSortableTableDOM(table: HTMLTableElement): boolean {
  const firstRow = table.querySelector('tr');

  if (!firstRow || firstRow.cells.length === 0) {
    return false;
  }

  return Array.from(firstRow.cells).every(
    (cell) => cell.tagName === 'TH' && (cell.rowSpan ?? 1) === 1,
  );
}

function removeTableChevrons(table: HTMLTableElement): void {
  table
    .querySelectorAll<HTMLSpanElement>(`.${CHEVRON_CLASS}`)
    .forEach((el) => el.remove());
}

function ensureChevron(th: HTMLTableCellElement): HTMLSpanElement {
  let chevron = th.querySelector<HTMLSpanElement>(`.${CHEVRON_CLASS}`);

  if (!chevron) {
    chevron = document.createElement('span');
    chevron.className = CHEVRON_CLASS;
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = CHEVRON_SVG;
    th.appendChild(chevron);
  }

  return chevron;
}

function updateChevrons(table: HTMLTableElement): void {
  if (!isSortableTableDOM(table)) {
    removeTableChevrons(table);
    return;
  }

  const firstRow = table.querySelector('tr');
  if (!firstRow) return;

  const state = sortStates.get(table) ?? null;
  let col = 0;

  for (let i = 0; i < firstRow.cells.length; i += 1) {
    const cell = firstRow.cells[i];

    if (cell.tagName !== 'TH') {
      col += cell.colSpan ?? 1;
      continue;
    }

    if (cell.colSpan !== 1 || (cell.rowSpan ?? 1) !== 1) {
      cell.querySelector<HTMLSpanElement>(`.${CHEVRON_CLASS}`)?.remove();
      col += cell.colSpan ?? 1;
      continue;
    }

    const chevron = ensureChevron(cell as HTMLTableCellElement);
    let label: string;

    if (state && state.col === col) {
      chevron.setAttribute('data-sort', state.direction);
      label = state.direction === 'asc' ? 'Sort descending' : 'Clear sort';
    } else {
      chevron.removeAttribute('data-sort');
      label = 'Sort ascending';
    }

    chevron.setAttribute('data-tooltip', label);
    chevron.setAttribute('aria-label', label);
    chevron.title = label;
    col += cell.colSpan ?? 1;
  }
}

function addChevronsToAllTables(editorRoot: HTMLElement): void {
  const tables = editorRoot.querySelectorAll<HTMLTableElement>('table');

  tables.forEach((table) => updateChevrons(table));
}

function removeAllChevrons(editorRoot: HTMLElement): void {
  editorRoot
    .querySelectorAll<HTMLSpanElement>(`.${CHEVRON_CLASS}`)
    .forEach((el) => el.remove());
}

function applyReadonlySort(table: HTMLTableElement, colIndex: number): void {
  if (!isSortableTableDOM(table)) {
    return;
  }

  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  const allRows = Array.from(
    tbody.querySelectorAll<HTMLTableRowElement>(':scope > tr'),
  );
  if (allRows.length === 0) return;

  const headerRow = allRows[0];
  const dataRows = allRows.slice(1);
  if (dataRows.length === 0) return;

  const current = sortStates.get(table) ?? null;
  const saved = getOrSaveOriginalOrder(table, dataRows);
  const next = getNextTableSortState(current, colIndex);

  if (next === null) {
    sortStates.delete(table);
    tbody.append(headerRow, ...saved);
  } else {
    const sorted = sortDataRows(saved, next.col, next.direction);

    if (!sorted) {
      return;
    }

    sortStates.set(table, next);
    tbody.append(headerRow, ...sorted);
  }

  updateChevrons(table);
}

export const TableReadonlySort = Extension.create({
  name: 'tableReadonlySort',

  addProseMirrorPlugins() {
    const editor = this.editor;
    let editorRoot: HTMLElement | null = null;

    const onClick = (event: MouseEvent) => {
      if (editor.isEditable) return;

      if (!(event.target instanceof Element)) return;

      const chevron = event.target.closest(`.${CHEVRON_CLASS}`);
      if (!chevron) return;

      const th = getHeaderTh(chevron);
      if (!th) return;

      const table = th.closest('table') as HTMLTableElement | null;
      if (!table) return;

      const colIndex = getColumnIndex(th);
      if (colIndex < 0) return;

      applyReadonlySort(table, colIndex);
    };

    return [
      new Plugin({
        key: tableReadonlySortKey,

        view(editorView) {
          editorRoot = editorView.dom as HTMLElement;
          editorRoot.addEventListener('click', onClick);

          if (!editor.isEditable) {
            addChevronsToAllTables(editorRoot);
          }

          return {
            update(view) {
              const root = view.dom as HTMLElement;
              if (editor.isEditable) {
                removeAllChevrons(root);
              } else {
                addChevronsToAllTables(root);
              }
            },
            destroy() {
              if (editorRoot) {
                editorRoot.removeEventListener('click', onClick);
                removeAllChevrons(editorRoot);
              }
            },
          };
        },
      }),
    ];
  },
});
