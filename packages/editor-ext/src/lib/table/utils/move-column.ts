import type { Node } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';

import { convertArrayOfRowsToTableNode } from './convert-array-of-rows-to-table-node';
import { convertTableNodeToArrayOfRows } from './convert-table-node-to-array-of-rows';
import { getSelectionRangeInColumn } from './get-selection-range-in-column';
import { moveRowInArrayOfRows } from './move-row-in-array-of-rows';
import { findCellPos, findTable } from './query';
import { transpose } from './transpose';

export interface MoveColumnParams {
  tr: Transaction;
  originIndex: number;
  targetIndex: number;
  select: boolean;
  pos: number;
  originIndexes?: readonly number[];
}

export interface MoveSelectedColumnParams {
  tr: Transaction;
  pos: number;
  direction: -1 | 1;
  select?: boolean;
}

export function getColumnRangeAt(
  tr: Transaction,
  columnIndex: number,
  pos: number,
): number[] | undefined {
  const $cell = findCellPos(tr.doc, pos);
  if (!$cell) return;

  const selection = TextSelection.near(tr.doc.resolve($cell.pos + 1));
  return getSelectionRangeInColumn(tr, columnIndex, columnIndex, selection)
    ?.indexes;
}

export function moveSelectedColumn({
  tr,
  pos,
  direction,
  select = true,
}: MoveSelectedColumnParams): boolean {
  const $cell = findCellPos(tr.doc, pos);
  if (!$cell) return false;

  const table = findTable($cell);
  if (!table) return false;

  const map = TableMap.get(table.node);
  const rect = map.findCell($cell.pos - table.start);
  const originIndexes = getColumnRangeAt(tr, rect.left, pos);
  if (!originIndexes?.length) return false;

  const targetIndex =
    direction < 0
      ? originIndexes[0] - 1
      : originIndexes[originIndexes.length - 1] + 1;
  if (targetIndex < 0 || targetIndex >= map.width) return false;

  return moveColumn({
    tr,
    originIndex: originIndexes[0],
    targetIndex,
    select,
    pos,
    originIndexes,
  });
}

/**
 * Move a column from index `origin` to index `target`.
 *
 * @internal
 */
export function moveColumn(moveColParams: MoveColumnParams): boolean {
  const { tr, originIndex, targetIndex, select, pos, originIndexes } =
    moveColParams;
  const $pos = tr.doc.resolve(pos);
  const table = findTable($pos);
  if (!table) return false;

  const mapBefore = TableMap.get(table.node);
  if (targetIndex < 0 || targetIndex >= mapBefore.width) return false;

  const indexesOriginColumn = originIndexes?.length
    ? [...originIndexes]
    : getColumnRangeAt(tr, originIndex, pos);
  const indexesTargetColumn = getColumnRangeAt(tr, targetIndex, pos);

  if (!indexesOriginColumn || !indexesTargetColumn) return false;

  if (indexesOriginColumn.includes(targetIndex)) return false;

  const newTable = moveTableColumn(
    table.node,
    indexesOriginColumn,
    indexesTargetColumn,
    0,
  );

  tr.replaceWith(table.pos, table.pos + table.node.nodeSize, newTable);

  if (!select) return true;

  const map = TableMap.get(newTable);
  const start = table.start;
  const index = targetIndex;
  const lastCell = map.positionAt(map.height - 1, index, newTable);
  const $lastCell = tr.doc.resolve(start + lastCell);

  const firstCell = map.positionAt(0, index, newTable);
  const $firstCell = tr.doc.resolve(start + firstCell);

  tr.setSelection(CellSelection.colSelection($lastCell, $firstCell));
  return true;
}

function moveTableColumn(
  table: Node,
  indexesOrigin: number[],
  indexesTarget: number[],
  direction: -1 | 1 | 0,
) {
  let rows = transpose(convertTableNodeToArrayOfRows(table));

  rows = moveRowInArrayOfRows(rows, indexesOrigin, indexesTarget, direction);
  rows = transpose(rows);

  return convertArrayOfRowsToTableNode(table, rows);
}
