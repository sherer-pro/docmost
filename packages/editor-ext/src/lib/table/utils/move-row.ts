import type { Node } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';

import { convertArrayOfRowsToTableNode } from './convert-array-of-rows-to-table-node';
import { convertTableNodeToArrayOfRows } from './convert-table-node-to-array-of-rows';
import { getSelectionRangeInRow } from './get-selection-range-in-row';
import { moveRowInArrayOfRows } from './move-row-in-array-of-rows';
import { findCellPos, findTable } from './query';

export interface MoveRowParams {
  tr: Transaction;
  originIndex: number;
  targetIndex: number;
  select: boolean;
  pos: number;
  originIndexes?: readonly number[];
}

export function getRowRangeAt(
  tr: Transaction,
  rowIndex: number,
  pos: number,
): number[] | undefined {
  const $cell = findCellPos(tr.doc, pos);
  if (!$cell) return;

  const selection = TextSelection.near(tr.doc.resolve($cell.pos + 1));
  return getSelectionRangeInRow(tr, rowIndex, rowIndex, selection)?.indexes;
}

/**
 * Move a row from index `origin` to index `target`.
 *
 * @internal
 */
export function moveRow(moveRowParams: MoveRowParams): boolean {
  const { tr, originIndex, targetIndex, select, pos, originIndexes } =
    moveRowParams;
  const $pos = tr.doc.resolve(pos);
  const table = findTable($pos);
  if (!table) return false;

  const mapBefore = TableMap.get(table.node);
  if (targetIndex < 0 || targetIndex >= mapBefore.height) return false;

  const indexesOriginRow = originIndexes?.length
    ? [...originIndexes]
    : getRowRangeAt(tr, originIndex, pos);
  const indexesTargetRow = getRowRangeAt(tr, targetIndex, pos);

  if (!indexesOriginRow || !indexesTargetRow) return false;

  if (indexesOriginRow.includes(targetIndex)) return false;

  const newTable = moveTableRow(
    table.node,
    indexesOriginRow,
    indexesTargetRow,
    0,
  );

  tr.replaceWith(table.pos, table.pos + table.node.nodeSize, newTable);

  if (!select) return true;

  const map = TableMap.get(newTable);
  const start = table.start;
  const index = targetIndex;
  const lastCell = map.positionAt(index, map.width - 1, newTable);
  const $lastCell = tr.doc.resolve(start + lastCell);

  const firstCell = map.positionAt(index, 0, newTable);
  const $firstCell = tr.doc.resolve(start + firstCell);

  tr.setSelection(CellSelection.rowSelection($lastCell, $firstCell));
  return true;
}

function moveTableRow(
  table: Node,
  indexesOrigin: number[],
  indexesTarget: number[],
  direction: -1 | 1 | 0,
) {
  let rows = convertTableNodeToArrayOfRows(table);

  rows = moveRowInArrayOfRows(rows, indexesOrigin, indexesTarget, direction);

  return convertArrayOfRowsToTableNode(table, rows);
}
