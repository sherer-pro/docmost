import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';

export type TableSortDirection = 'asc' | 'desc';

export type TableSortState = {
  col: number;
  direction: TableSortDirection;
};

const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

export function getNextTableSortState(
  current: TableSortState | null,
  col: number,
): TableSortState | null {
  if (!current || current.col !== col) {
    return { col, direction: 'asc' };
  }

  if (current.direction === 'asc') {
    return { col, direction: 'desc' };
  }

  return null;
}

export function isSortableTableNode(tableNode: ProseMirrorNode): boolean {
  const firstRow = tableNode.firstChild;

  if (!firstRow || firstRow.childCount === 0) {
    return false;
  }

  for (let index = 0; index < firstRow.childCount; index += 1) {
    const cell = firstRow.child(index);

    if (cell.type.name !== 'tableHeader' || cell.attrs.rowspan !== 1) {
      return false;
    }
  }

  return true;
}

export function isSortableTableColumn(
  tableNode: ProseMirrorNode,
  colIndex: number,
): boolean {
  if (!isSortableTableNode(tableNode)) {
    return false;
  }

  const map = TableMap.get(tableNode);

  if (colIndex < 0 || colIndex >= map.width) {
    return false;
  }

  const cellPos = map.map[colIndex];
  const cell = tableNode.nodeAt(cellPos);

  if (!cell || cell.type.name !== 'tableHeader') {
    return false;
  }

  const rect = map.findCell(cellPos);

  return (
    rect.top === 0 &&
    rect.bottom === 1 &&
    rect.left === colIndex &&
    rect.right === colIndex + 1
  );
}

export function compareTableCellText(
  textA: string,
  textB: string,
  direction: TableSortDirection,
): number {
  const emptyA = textA === '';
  const emptyB = textB === '';

  if (emptyA && emptyB) {
    return 0;
  }

  if (emptyA) {
    return 1;
  }

  if (emptyB) {
    return -1;
  }

  const result = collator.compare(textA, textB);

  return direction === 'asc' ? result : -result;
}

export function sortTableNode(
  tableNode: ProseMirrorNode,
  colIndex: number,
  direction: TableSortDirection,
): ProseMirrorNode | null {
  if (!isSortableTableColumn(tableNode, colIndex) || tableNode.childCount < 2) {
    return null;
  }

  const map = TableMap.get(tableNode);
  const sortableRows: Array<{
    index: number;
    node: ProseMirrorNode;
    text: string;
  }> = [];

  for (let rowIndex = 1; rowIndex < tableNode.childCount; rowIndex += 1) {
    const row = tableNode.child(rowIndex);

    if (rowHasCrossRowMerge(row)) {
      return null;
    }

    const text = getSortableCellText(tableNode, map, rowIndex, colIndex);

    if (text === null) {
      return null;
    }

    sortableRows.push({
      index: rowIndex,
      node: row,
      text,
    });
  }

  const sortedRows = [...sortableRows].sort((rowA, rowB) => {
    const result = compareTableCellText(rowA.text, rowB.text, direction);

    return result === 0 ? rowA.index - rowB.index : result;
  });

  return tableNode.type.createChecked(
    tableNode.attrs,
    [tableNode.child(0), ...sortedRows.map((row) => row.node)],
    tableNode.marks,
  );
}

function rowHasCrossRowMerge(row: ProseMirrorNode): boolean {
  for (let index = 0; index < row.childCount; index += 1) {
    if (row.child(index).attrs.rowspan !== 1) {
      return true;
    }
  }

  return false;
}

function getSortableCellText(
  tableNode: ProseMirrorNode,
  map: TableMap,
  rowIndex: number,
  colIndex: number,
): string | null {
  const cellPos = map.map[rowIndex * map.width + colIndex];
  const cell = tableNode.nodeAt(cellPos);

  if (!cell) {
    return null;
  }

  const rect = map.findCell(cellPos);

  if (
    rect.top !== rowIndex ||
    rect.bottom !== rowIndex + 1 ||
    rect.left !== colIndex ||
    rect.right !== colIndex + 1
  ) {
    return null;
  }

  return cell.textContent.trim();
}
