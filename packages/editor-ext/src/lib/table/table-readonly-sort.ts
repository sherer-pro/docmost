import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
  compareTableCellText,
  findTable,
  getNextTableSortState,
  sortTableNode,
  type TableSortDirection,
  type TableSortState,
} from './utils';

const CHEVRON_CLASS = 'tableReadonlySortChevron';

const tableReadonlySortKey = new PluginKey('tableReadonlySort');

const sortStates = new WeakMap<HTMLTableElement, TableSortState>();
const originalOrders = new WeakMap<HTMLTableElement, HTMLTableRowElement[]>();

type TableSortLabelKey = 'sortAscending' | 'sortDescending' | 'clearSort';

interface TableReadonlySortOptions {
  getLabel?: (key: TableSortLabelKey) => string;
}

const DEFAULT_LABELS: Record<TableSortLabelKey, string> = {
  sortAscending: 'Sort ascending',
  sortDescending: 'Sort descending',
  clearSort: 'Clear sort',
};

const CHEVRON_SVG =
  '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
  '<path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />' +
  '</svg>';

function getSortLabel(
  options: TableReadonlySortOptions,
  key: TableSortLabelKey,
): string {
  return options.getLabel?.(key) ?? DEFAULT_LABELS[key];
}

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
    (cell) =>
      cell.tagName === 'TH' &&
      cell.colSpan === 1 &&
      (cell.rowSpan ?? 1) === 1,
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
    chevron.setAttribute('contenteditable', 'false');
    chevron.innerHTML = CHEVRON_SVG;
    th.appendChild(chevron);
  }

  return chevron;
}

function setAttributeIfChanged(
  element: HTMLElement,
  name: string,
  value: string,
): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function removeAttributeIfPresent(element: HTMLElement, name: string): void {
  if (element.hasAttribute(name)) {
    element.removeAttribute(name);
  }
}

function updateChevrons(
  table: HTMLTableElement,
  getLabel: (key: TableSortLabelKey) => string,
  isEditable: boolean,
  getState: (table: HTMLTableElement) => TableSortState | null,
): void {
  if (!isSortableTableDOM(table)) {
    removeTableChevrons(table);
    return;
  }

  const firstRow = table.querySelector('tr');
  if (!firstRow) return;

  const state = getState(table);
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
      setAttributeIfChanged(chevron, 'data-sort', state.direction);
      label =
        state.direction === 'asc'
          ? getLabel('sortDescending')
          : getLabel(isEditable ? 'sortAscending' : 'clearSort');
    } else {
      removeAttributeIfPresent(chevron, 'data-sort');
      label = getLabel('sortAscending');
    }

    setAttributeIfChanged(chevron, 'data-tooltip', label);
    setAttributeIfChanged(chevron, 'aria-label', label);
    if (chevron.title !== label) {
      chevron.title = label;
    }
    col += cell.colSpan ?? 1;
  }
}

function addChevronsToAllTables(
  editorRoot: HTMLElement,
  getLabel: (key: TableSortLabelKey) => string,
  isEditable: boolean,
  getState: (table: HTMLTableElement) => TableSortState | null,
): void {
  const tables = editorRoot.querySelectorAll<HTMLTableElement>('table');

  tables.forEach((table) =>
    updateChevrons(table, getLabel, isEditable, getState),
  );
}

function removeAllChevrons(editorRoot: HTMLElement): void {
  editorRoot
    .querySelectorAll<HTMLSpanElement>(`.${CHEVRON_CLASS}`)
    .forEach((el) => el.remove());
}

function applyReadonlySort(
  table: HTMLTableElement,
  colIndex: number,
  getLabel: (key: TableSortLabelKey) => string,
): void {
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

  updateChevrons(table, getLabel, false, (sortedTable) => {
    return sortStates.get(sortedTable) ?? null;
  });
}

function getNextEditableTableSortState(
  current: TableSortState | null,
  col: number,
): TableSortState {
  if (!current || current.col !== col || current.direction === 'desc') {
    return { col, direction: 'asc' };
  }

  return { col, direction: 'desc' };
}

function getTableInfoFromDOM(
  view: EditorView,
  table: HTMLTableElement,
): { node: ProseMirrorNode; pos: number } | null {
  const candidates = [
    table.querySelector('th,td'),
    table.querySelector('tr'),
    table.querySelector('tbody'),
    table,
  ].filter((node): node is Element => node !== null);

  for (const candidate of candidates) {
    for (const offset of [0, 1]) {
      try {
        const pos = view.posAtDOM(candidate, offset);
        const tableInfo = findTable(view.state.doc.resolve(pos));

        if (!tableInfo) {
          continue;
        }

        const tableDOM = view.nodeDOM(tableInfo.pos);

        if (tableDOM instanceof HTMLElement && tableDOM.contains(table)) {
          return {
            node: tableInfo.node,
            pos: tableInfo.pos,
          };
        }
      } catch {
        // Ignore DOM positions that ProseMirror cannot map.
      }
    }
  }

  return null;
}

function applyEditableSort(
  view: EditorView,
  table: HTMLTableElement,
  colIndex: number,
  editableSortStates: Map<number, TableSortState>,
): void {
  const tableInfo = getTableInfoFromDOM(view, table);

  if (!tableInfo) {
    return;
  }

  const current =
    editableSortStates.get(tableInfo.pos) ?? sortStates.get(table) ?? null;
  const next = getNextEditableTableSortState(current, colIndex);
  const sortedTable = sortTableNode(tableInfo.node, next.col, next.direction);

  if (!sortedTable) {
    return;
  }

  editableSortStates.set(tableInfo.pos, next);
  sortStates.set(table, next);

  view.dispatch(
    view.state.tr
      .replaceWith(
        tableInfo.pos,
        tableInfo.pos + tableInfo.node.nodeSize,
        sortedTable,
      )
      .scrollIntoView(),
  );
}

export const TableReadonlySort = Extension.create<TableReadonlySortOptions>({
  name: 'tableReadonlySort',

  addOptions() {
    return {
      getLabel: undefined,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const getLabel = (key: TableSortLabelKey) =>
      getSortLabel(this.options, key);
    const editableSortStates = new Map<number, TableSortState>();
    let editorRoot: HTMLElement | null = null;
    let lastEditable = editor.isEditable;

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;

      const chevron = event.target.closest(`.${CHEVRON_CLASS}`);
      if (!chevron) return;

      const th = getHeaderTh(chevron);
      if (!th) return;

      const table = th.closest('table') as HTMLTableElement | null;
      if (!table) return;

      const colIndex = getColumnIndex(th);
      if (colIndex < 0) return;

      event.preventDefault();
      event.stopPropagation();

      if (editor.isEditable) {
        applyEditableSort(editor.view, table, colIndex, editableSortStates);
      } else {
        applyReadonlySort(table, colIndex, getLabel);
      }
    };

    return [
      new Plugin({
        key: tableReadonlySortKey,

        view(editorView) {
          editorRoot = editorView.dom as HTMLElement;
          editorRoot.addEventListener('click', onClick);
          addChevronsToAllTables(
            editorRoot,
            getLabel,
            editor.isEditable,
            (table) => sortStates.get(table) ?? null,
          );

          return {
            update(view, prevState) {
              const root = view.dom as HTMLElement;
              const editableChanged = lastEditable !== editor.isEditable;

              if (!editableChanged && view.state.doc === prevState.doc) {
                return;
              }

              lastEditable = editor.isEditable;
              addChevronsToAllTables(
                root,
                getLabel,
                editor.isEditable,
                (table) => sortStates.get(table) ?? null,
              );
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
