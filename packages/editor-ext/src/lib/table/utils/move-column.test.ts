// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextSelection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { StarterKit } from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { TableDndExtension } from '../dnd';
import { CustomTable } from '../table';
import { moveColumn } from './move-column';

const editors: Editor[] = [];

function createEditor(content: Record<string, unknown>): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      CustomTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TableDndExtension,
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

function tableContent(merged = false) {
  const headerCells = merged
    ? [
        cell('tableHeader', 'A', { colspan: 2, colwidth: [120, 140] }),
        cell('tableHeader', 'C'),
      ]
    : [
        cell('tableHeader', 'A', { colwidth: [120] }),
        cell('tableHeader', 'B'),
        cell('tableHeader', 'C'),
      ];

  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: headerCells },
          {
            type: 'tableRow',
            content: [
              cell('tableCell', 'A2'),
              cell('tableCell', 'B2'),
              cell('tableCell', 'C2'),
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Outside' }] },
    ],
  };
}

function cell(
  type: 'tableHeader' | 'tableCell',
  text: string,
  attrs?: Record<string, unknown>,
) {
  return {
    type,
    attrs,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function getTable(editor: Editor) {
  let tableNode = editor.state.doc.firstChild!;
  const tablePos = 0;
  const tableStart = tablePos + 1;
  return { tableNode, tablePos, tableStart, map: TableMap.get(tableNode) };
}

function cellPos(editor: Editor, row: number, column: number): number {
  const { tableNode, tableStart, map } = getTable(editor);
  return tableStart + map.positionAt(row, column, tableNode);
}

function selectCell(editor: Editor, row: number, column: number) {
  const pos = cellPos(editor, row, column);
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.near(editor.state.doc.resolve(pos + 1)),
    ),
  );
}

function rowTexts(editor: Editor): string[][] {
  const table = editor.state.doc.firstChild!;
  const rows: string[][] = [];
  table.forEach((row) => {
    const texts: string[] = [];
    row.forEach((currentCell) => texts.push(currentCell.textContent));
    rows.push(texts);
  });
  return rows;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

describe('table column moves', () => {
  it('uses the captured table position when the current selection is outside', () => {
    const editor = createEditor(tableContent());
    const capturedPos = cellPos(editor, 0, 0);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const tr = editor.state.tr;

    expect(
      moveColumn({
        tr,
        originIndex: 0,
        targetIndex: 2,
        select: true,
        pos: capturedPos,
        originIndexes: [0],
      }),
    ).toBe(true);
    editor.view.dispatch(tr);

    expect(rowTexts(editor)).toEqual([
      ['B', 'C', 'A'],
      ['B2', 'C2', 'A2'],
    ]);
    expect(
      editor.state.doc.firstChild?.child(0).lastChild?.attrs,
    ).toMatchObject({
      colwidth: [120],
    });
  });

  it('moves a merged logical range as one block', () => {
    const editor = createEditor(tableContent(true));
    const capturedPos = cellPos(editor, 0, 0);
    const tr = editor.state.tr;

    expect(
      moveColumn({
        tr,
        originIndex: 0,
        targetIndex: 2,
        select: true,
        pos: capturedPos,
      }),
    ).toBe(true);
    editor.view.dispatch(tr);

    expect(rowTexts(editor)).toEqual([
      ['C', 'A'],
      ['C2', 'A2', 'B2'],
    ]);
    expect(editor.state.doc.firstChild?.child(0).lastChild?.attrs.colspan).toBe(
      2,
    );
  });

  it('exposes boundary-aware left and right commands', () => {
    const editor = createEditor(tableContent());
    selectCell(editor, 0, 0);

    expect(editor.can().moveColumnLeft()).toBe(false);
    expect(editor.can().moveColumnRight()).toBe(true);
    expect(editor.commands.moveColumnRight()).toBe(true);
    expect(rowTexts(editor)[0]).toEqual(['B', 'A', 'C']);

    expect(editor.commands.moveColumnLeft()).toBe(true);
    expect(rowTexts(editor)[0]).toEqual(['A', 'B', 'C']);
    expect(editor.can().moveColumnLeft()).toBe(false);
  });
});
