// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextSelection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { StarterKit } from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  vi.restoreAllMocks();
});

describe('table column moves', () => {
  it('binds and removes the document drag lifecycle with the plugin view', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const editor = createEditor(tableContent());

    expect(addEventListener).toHaveBeenCalledWith(
      'dragover',
      expect.any(Function),
      true,
    );
    expect(addEventListener).toHaveBeenCalledWith(
      'drop',
      expect.any(Function),
      true,
    );
    expect(addEventListener).toHaveBeenCalledWith(
      'dragend',
      expect.any(Function),
      true,
    );

    editor.destroy();

    expect(removeEventListener).toHaveBeenCalledWith(
      'dragover',
      expect.any(Function),
      true,
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      'drop',
      expect.any(Function),
      true,
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      'dragend',
      expect.any(Function),
      true,
    );
  });

  it('moves a column through the native drag lifecycle', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    const editor = createEditor(tableContent());
    const firstCellPos = cellPos(editor, 0, 0);
    const firstRowCells = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('tr:first-child > th'),
    );
    firstRowCells.forEach((cellElement, index) => {
      vi.spyOn(cellElement, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(index * 100, 20, 100, 40),
      );
    });
    const firstCell = firstRowCells[0];
    const secondCellPos = cellPos(editor, 0, 1);
    vi.spyOn(editor.view, 'posAtCoords').mockImplementation(({ left }) => {
      const pos = left < 100 ? firstCellPos : secondCellPos;
      return { pos: pos + 1, inside: pos };
    });

    firstCell.dispatchEvent(
      new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );

    const handle = editor.options.element.querySelector<HTMLElement>(
      '.drag-handle[data-direction="horizontal"]',
    );
    const setData = vi.fn();
    const setDragImage = vi.fn();
    const dataTransfer = {
      effectAllowed: 'uninitialized',
      setData,
      setDragImage,
    };
    const createDragEvent = (type: string, clientX: number) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: 30 },
        dataTransfer: { value: dataTransfer },
      });
      return event;
    };

    handle?.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
    );
    firstRowCells[1].dispatchEvent(
      new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 150,
        clientY: 30,
      }),
    );
    handle?.dispatchEvent(createDragEvent('dragstart', 20));
    document.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    document.dispatchEvent(createDragEvent('dragover', 250));
    document.dispatchEvent(createDragEvent('drop', 250));

    expect(setData).toHaveBeenCalledWith(
      'application/x-docmost-table-dnd',
      'col',
    );
    expect(setDragImage).toHaveBeenCalled();
    expect(rowTexts(editor)).toEqual([
      ['B', 'C', 'A'],
      ['B2', 'C2', 'A2'],
    ]);
  });

  it('moves a column through the pointer fallback lifecycle', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    const editor = createEditor(tableContent());
    const firstCellPos = cellPos(editor, 0, 0);
    const firstRowCells = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('tr:first-child > th'),
    );
    firstRowCells.forEach((cellElement, index) => {
      vi.spyOn(cellElement, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(index * 100, 20, 100, 40),
      );
    });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({
      pos: firstCellPos + 1,
      inside: firstCellPos,
    });

    firstRowCells[0].dispatchEvent(
      new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    const handle = editor.options.element.querySelector<HTMLElement>(
      '.drag-handle[data-direction="horizontal"]',
    );
    expect(handle?.draggable).toBe(false);
    handle?.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 20,
        clientY: 30,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        buttons: 1,
        clientX: 25,
        clientY: 30,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        buttons: 1,
        clientX: 250,
        clientY: 30,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 250,
        clientY: 30,
      }),
    );

    expect(rowTexts(editor)).toEqual([
      ['B', 'C', 'A'],
      ['B2', 'C2', 'A2'],
    ]);
  });

  it('commits a valid native drag from dragend when Firefox omits drop', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    const editor = createEditor(tableContent());
    const firstCellPos = cellPos(editor, 0, 0);
    const firstRowCells = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('tr:first-child > th'),
    );
    firstRowCells.forEach((cellElement, index) => {
      vi.spyOn(cellElement, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(index * 100, 20, 100, 40),
      );
    });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({
      pos: firstCellPos + 1,
      inside: firstCellPos,
    });

    firstRowCells[0].dispatchEvent(
      new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    const handle = editor.options.element.querySelector<HTMLElement>(
      '.drag-handle[data-direction="horizontal"]',
    );
    const createDragEvent = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: 30 },
        dataTransfer: {
          value: { effectAllowed: 'uninitialized', setData: vi.fn() },
        },
      });
      return event;
    };

    handle?.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 30,
      }),
    );
    handle?.dispatchEvent(createDragEvent('dragstart', 20));
    document.dispatchEvent(createDragEvent('dragover', 250));
    document.dispatchEvent(createDragEvent('dragend', 250));

    expect(rowTexts(editor)).toEqual([
      ['B', 'C', 'A'],
      ['B2', 'C2', 'A2'],
    ]);
  });

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
