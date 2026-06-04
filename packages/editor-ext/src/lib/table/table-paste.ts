import { Extension } from '@tiptap/core';
import {
  Fragment,
  Node as ProseMirrorNode,
  Schema,
  Slice,
} from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const tablePasteKey = new PluginKey('tablePaste');

export function parseTsvTable(text: string): string[][] | null {
  if (!text.includes('\t')) {
    return null;
  }

  const rows = parseDelimitedRows(text.replace(/\r\n?/g, '\n'), '\t');

  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === '')) {
    rows.pop();
  }

  if (rows.length < 2 || rows[0].length < 2) {
    return null;
  }

  const columnCount = rows[0].length;

  if (rows.some((row) => row.length !== columnCount)) {
    return null;
  }

  return rows;
}

export function createTableNodeFromRows(
  schema: Schema,
  rows: string[][],
): ProseMirrorNode {
  const tableRows = rows.map((row, rowIndex) => {
    const cellType =
      rowIndex === 0 ? schema.nodes.tableHeader : schema.nodes.tableCell;

    const cells = row.map((cellText) =>
      cellType.createChecked(null, [
        schema.nodes.paragraph.createChecked(
          null,
          cellText ? [schema.text(cellText)] : undefined,
        ),
      ]),
    );

    return schema.nodes.tableRow.createChecked(null, cells);
  });

  return schema.nodes.table.createChecked({ widthMode: 'normal' }, tableRows);
}

export function normalizePastedTableHTML(html: string): string {
  if (!html.includes('<table')) {
    return html;
  }

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  let changed = false;

  doc.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
    if (!table.hasAttribute('data-table-width-mode')) {
      table.setAttribute('data-table-width-mode', 'normal');
      changed = true;
    }

    const colWidths = getTableColumnWidths(table);

    if (colWidths.length > 0) {
      applyColumnWidths(table, colWidths);
      changed = true;
    }
  });

  return changed ? doc.body.innerHTML : html;
}

export const TablePaste = Extension.create({
  name: 'tablePaste',

  priority: 102,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tablePasteKey,
        props: {
          transformPastedHTML: (html) => normalizePastedTableHTML(html),
          clipboardTextParser: (text, context, plainText) => {
            if (plainText || this.editor.isActive('codeBlock')) {
              return null;
            }

            const rows = parseTsvTable(text);

            if (!rows) {
              return null;
            }

            return new Slice(
              Fragment.from(createTableNodeFromRows(this.editor.schema, rows)),
              0,
              0,
            );
          },
        },
      }),
    ];
  },
});

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (quoted && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!quoted && char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

function getTableColumnWidths(table: HTMLTableElement): Array<number | null> {
  const colgroupWidths = Array.from(
    table.querySelectorAll<HTMLTableColElement>('colgroup > col'),
  ).map((col) => getElementWidth(col));

  if (colgroupWidths.some((width) => width !== null)) {
    return colgroupWidths;
  }

  const firstRow = table.querySelector('tr');

  if (!firstRow) {
    return [];
  }

  const widths: Array<number | null> = [];
  let col = 0;

  Array.from(firstRow.cells).forEach((cell) => {
    const colspan = cell.colSpan ?? 1;
    const colwidth = getCellColwidth(cell, colspan);

    if (colwidth) {
      colwidth.forEach((width, index) => {
        widths[col + index] = width;
      });
    } else if (colspan === 1) {
      widths[col] = getElementWidth(cell);
    }

    col += colspan;
  });

  return widths;
}

function applyColumnWidths(
  table: HTMLTableElement,
  widths: Array<number | null>,
): void {
  table.querySelectorAll<HTMLTableRowElement>('tr').forEach((row) => {
    let col = 0;

    Array.from(row.cells).forEach((cell) => {
      const colspan = cell.colSpan ?? 1;
      const cellWidths = widths.slice(col, col + colspan);

      if (
        cellWidths.length === colspan &&
        cellWidths.every((width) => width !== null)
      ) {
        cell.setAttribute('colwidth', cellWidths.join(','));
      }

      col += colspan;
    });
  });
}

function getCellColwidth(
  cell: HTMLTableCellElement,
  colspan: number,
): number[] | null {
  const rawValue = cell.getAttribute('colwidth');

  if (!rawValue) {
    return null;
  }

  const widths = rawValue
    .split(',')
    .map((value) => parsePixelWidth(value))
    .filter((value): value is number => value !== null);

  return widths.length === colspan ? widths : null;
}

function getElementWidth(element: HTMLElement): number | null {
  return (
    parsePixelWidth(element.getAttribute('width')) ||
    parsePixelWidth(element.style.width)
  );
}

function parsePixelWidth(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);

  if (!match) {
    return null;
  }

  const width = Math.round(Number(match[1]));

  return Number.isFinite(width) && width > 0 ? width : null;
}
