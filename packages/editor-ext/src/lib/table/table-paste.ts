import { Extension } from '@tiptap/core';
import {
  Fragment,
  Node as ProseMirrorNode,
  Schema,
  Slice,
} from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { findTable } from './utils';

const tablePasteKey = new PluginKey('tablePaste');

export function parseTsvTable(text: string): string[][] | null {
  if (!text.includes('\t')) {
    return null;
  }

  const rows = parseDelimitedRows(text.replace(/\r\n?/g, '\n'), '\t');

  while (
    rows.length > 0 &&
    rows[rows.length - 1].every((cell) => cell === '')
  ) {
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

function getSingleTableNodeFromSlice(slice: Slice): ProseMirrorNode | null {
  if (slice.content.childCount !== 1) {
    return null;
  }

  const node = slice.content.child(0);

  return node.type.spec.tableRole === 'table' ? node : null;
}

function isEmptyTableNode(tableNode: ProseMirrorNode): boolean {
  if (tableNode.type.spec.tableRole !== 'table') {
    return false;
  }

  let hasCell = false;
  let hasContent = false;

  tableNode.descendants((node) => {
    if (node.type.spec.tableRole === 'cell') {
      hasCell = true;
    }

    if (node.isText && node.textContent.trim()) {
      hasContent = true;
      return false;
    }

    return true;
  });

  return hasCell && !hasContent;
}

function replaceSelectedEmptyTable(
  view: EditorView,
  nextTableNode: ProseMirrorNode,
): boolean {
  const table = findTable(view.state.selection.$from);

  if (!table || !isEmptyTableNode(table.node)) {
    return false;
  }

  view.dispatch(
    view.state.tr
      .replaceWith(table.pos, table.pos + table.node.nodeSize, nextTableNode)
      .setMeta('paste', true)
      .scrollIntoView(),
  );

  return true;
}

function isTableCellNode(node: ProseMirrorNode): boolean {
  return node.type.name === 'tableCell' || node.type.name === 'tableHeader';
}

function isMeaningfulCellContent(node: ProseMirrorNode): boolean {
  let hasContent = false;

  node.descendants((child) => {
    if (child.isText && child.textContent.trim()) {
      hasContent = true;
      return false;
    }

    if (child.isLeaf && !child.isText && child.type.name !== 'hardBreak') {
      hasContent = true;
      return false;
    }

    return true;
  });

  return hasContent;
}

function isEmptyTableRow(rowNode: ProseMirrorNode): boolean {
  if (rowNode.type.name !== 'tableRow' || rowNode.childCount === 0) {
    return false;
  }

  let hasCell = false;
  let hasContent = false;

  rowNode.forEach((cell) => {
    if (!isTableCellNode(cell)) {
      hasContent = true;
      return;
    }

    hasCell = true;

    if (isMeaningfulCellContent(cell)) {
      hasContent = true;
    }
  });

  return hasCell && !hasContent;
}

function isHeaderOnlyRow(rowNode: ProseMirrorNode): boolean {
  if (rowNode.type.name !== 'tableRow' || rowNode.childCount === 0) {
    return false;
  }

  let headerOnly = true;

  rowNode.forEach((cell) => {
    if (cell.type.name !== 'tableHeader') {
      headerOnly = false;
    }
  });

  return headerOnly;
}

function isRegularCellOnlyRow(rowNode: ProseMirrorNode): boolean {
  if (rowNode.type.name !== 'tableRow' || rowNode.childCount === 0) {
    return false;
  }

  let cellOnly = true;

  rowNode.forEach((cell) => {
    if (cell.type.name !== 'tableCell') {
      cellOnly = false;
    }
  });

  return cellOnly;
}

function isTableCellOnlyRow(rowNode: ProseMirrorNode): boolean {
  if (rowNode.type.name !== 'tableRow' || rowNode.childCount === 0) {
    return false;
  }

  let cellOnly = true;

  rowNode.forEach((cell) => {
    if (!isTableCellNode(cell)) {
      cellOnly = false;
    }
  });

  return cellOnly;
}

function getTableRowColumnCount(rowNode: ProseMirrorNode): number {
  let columnCount = 0;

  rowNode.forEach((cell) => {
    columnCount += Number(cell.attrs.colspan ?? 1);
  });

  return columnCount;
}

function convertRowCellsToHeaders(
  rowNode: ProseMirrorNode,
  schema: Schema,
): ProseMirrorNode {
  const headerType = schema.nodes.tableHeader;
  let changed = false;
  const cells: ProseMirrorNode[] = [];

  rowNode.forEach((cell) => {
    if (cell.type.name === 'tableHeader') {
      cells.push(cell);
      return;
    }

    changed = true;
    cells.push(headerType.createChecked(cell.attrs, cell.content, cell.marks));
  });

  if (!changed) {
    return rowNode;
  }

  return rowNode.type.createChecked(rowNode.attrs, cells, rowNode.marks);
}

export function normalizeMalformedLeadingTableRows(
  tableNode: ProseMirrorNode,
): ProseMirrorNode | null {
  if (tableNode.type.spec.tableRole !== 'table') {
    return null;
  }

  const rows: ProseMirrorNode[] = [];
  let hasUnexpectedChild = false;

  tableNode.forEach((child) => {
    if (child.type.name !== 'tableRow') {
      hasUnexpectedChild = true;
      return;
    }

    rows.push(child);
  });

  if (hasUnexpectedChild || rows.length < 2) {
    return null;
  }

  const firstContentRowIndex = rows.findIndex((row) => !isEmptyTableRow(row));

  if (firstContentRowIndex <= 0 || firstContentRowIndex > 2) {
    return null;
  }

  const leadingRows = rows.slice(0, firstContentRowIndex);
  const firstContentRow = rows[firstContentRowIndex];
  const firstContentColumnCount = getTableRowColumnCount(firstContentRow);

  if (
    firstContentColumnCount === 0 ||
    !isHeaderOnlyRow(leadingRows[0]) ||
    !isTableCellOnlyRow(firstContentRow)
  ) {
    return null;
  }

  if (leadingRows.length === 2 && !isRegularCellOnlyRow(leadingRows[1])) {
    return null;
  }

  if (
    leadingRows.some(
      (row) => getTableRowColumnCount(row) !== firstContentColumnCount,
    )
  ) {
    return null;
  }

  const normalizedRows = [
    convertRowCellsToHeaders(firstContentRow, tableNode.type.schema),
    ...rows.slice(firstContentRowIndex + 1),
  ];

  return tableNode.type.createChecked(
    tableNode.attrs,
    Fragment.fromArray(normalizedRows),
    tableNode.marks,
  );
}

function createNormalizeTablesTransaction(
  state: EditorState,
): Transaction | null {
  const replacements: Array<{
    node: ProseMirrorNode;
    normalized: ProseMirrorNode;
    pos: number;
  }> = [];

  state.doc.descendants((node, pos) => {
    const normalized = normalizeMalformedLeadingTableRows(node);

    if (normalized) {
      replacements.push({ node, normalized, pos });
      return false;
    }

    return true;
  });

  if (replacements.length === 0) {
    return null;
  }

  const tr = state.tr;

  for (const replacement of replacements.reverse()) {
    tr.replaceWith(
      replacement.pos,
      replacement.pos + replacement.node.nodeSize,
      replacement.normalized,
    );
  }

  return tr.docChanged
    ? tr.setMeta(tablePasteKey, { normalizedMalformedTables: true })
    : null;
}

function normalizeMalformedTablesInView(view: EditorView): boolean {
  const tr = createNormalizeTablesTransaction(view.state);

  if (!tr) {
    return false;
  }

  view.dispatch(tr);
  return true;
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
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }

          if (
            transactions.some(
              (tr) => tr.getMeta(tablePasteKey)?.normalizedMalformedTables,
            )
          ) {
            return null;
          }

          return createNormalizeTablesTransaction(newState);
        },
        props: {
          transformPastedHTML: (html) => normalizePastedTableHTML(html),
          handlePaste: (view, event, slice) => {
            if (
              !event.clipboardData ||
              this.editor.isActive('codeBlock') ||
              (event as ClipboardEvent & { shiftKey?: boolean }).shiftKey
            ) {
              return false;
            }

            const tableFromSlice = getSingleTableNodeFromSlice(slice);
            if (
              tableFromSlice &&
              replaceSelectedEmptyTable(view, tableFromSlice)
            ) {
              event.preventDefault();
              return true;
            }

            const rows = parseTsvTable(
              event.clipboardData.getData('text/plain'),
            );

            if (!rows) {
              return false;
            }

            if (
              replaceSelectedEmptyTable(
                view,
                createTableNodeFromRows(view.state.schema, rows),
              )
            ) {
              event.preventDefault();
              return true;
            }

            return false;
          },
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
        view: (editorView) => {
          let destroyed = false;
          let scheduled = false;

          const scheduleNormalize = (view: EditorView) => {
            if (scheduled) {
              return;
            }

            scheduled = true;
            Promise.resolve().then(() => {
              scheduled = false;

              if (!destroyed) {
                normalizeMalformedTablesInView(view);
              }
            });
          };

          scheduleNormalize(editorView);

          return {
            update(view, prevState) {
              if (prevState.doc !== view.state.doc) {
                scheduleNormalize(view);
              }
            },
            destroy() {
              destroyed = true;
            },
          };
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
