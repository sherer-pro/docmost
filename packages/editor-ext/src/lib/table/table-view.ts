import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';

import {
  allocateTableColumnWidths,
  type TableColumnDemand,
} from './utils/column-layout';
import {
  getTableWidthModeClass,
  normalizeTableWidthMode,
} from './utils/width-mode';

const DEFAULT_CELL_MIN_WIDTH = 48;

interface TableCellWidthMeasurement {
  minimumWidth: number;
  preferredWidth: number;
}

export function getTableContentWidth(
  table: HTMLTableElement,
  containerWidth: number,
): number {
  if (getComputedStyle(table).borderCollapse !== 'collapse') {
    return containerWidth;
  }

  const firstRow = table.rows[0];
  const firstCell = firstRow?.cells[0];
  const lastCell = firstRow?.cells[firstRow.cells.length - 1];
  if (!firstCell || !lastCell) return containerWidth;

  const leftBorder = Number.parseFloat(
    getComputedStyle(firstCell).borderLeftWidth,
  );
  const rightBorder = Number.parseFloat(
    getComputedStyle(lastCell).borderRightWidth,
  );
  const outerBorderWidth =
    ((Number.isFinite(leftBorder) ? leftBorder : 0) +
      (Number.isFinite(rightBorder) ? rightBorder : 0)) /
    2;

  return Math.max(0, containerWidth - outerBorderWidth);
}

export function updateColumns(
  node: ProseMirrorNode,
  colgroup: HTMLTableColElement,
  table: HTMLTableElement,
  cellMinWidth: number,
  widths?: readonly number[],
) {
  const columnCount = TableMap.get(node).width;
  const fallbackWidth = Math.max(cellMinWidth, DEFAULT_CELL_MIN_WIDTH);
  const appliedWidths =
    widths?.length === columnCount
      ? widths
      : Array<number>(columnCount).fill(fallbackWidth);

  while (colgroup.children.length < columnCount) {
    colgroup.appendChild(document.createElement('col'));
  }
  while (colgroup.children.length > columnCount) {
    colgroup.lastElementChild?.remove();
  }

  appliedWidths.forEach((width, index) => {
    const col = colgroup.children[index] as HTMLTableColElement;
    col.style.width = `${width}px`;
    col.style.minWidth = `${fallbackWidth}px`;
  });

  const tableWidth = appliedWidths.reduce((total, width) => total + width, 0);
  table.style.tableLayout = 'fixed';
  table.style.width = `${tableWidth}px`;
  table.style.minWidth = `${tableWidth}px`;
}

export class TableView implements NodeView {
  node: ProseMirrorNode;

  dom: HTMLDivElement;

  table: HTMLTableElement;

  colgroup: HTMLTableColElement;

  contentDOM: HTMLTableSectionElement;

  private readonly cellMinWidth: number;

  private readonly measureRoot: HTMLDivElement;

  private readonly measuredWidths = new WeakMap<
    ProseMirrorNode,
    TableCellWidthMeasurement
  >();

  private resizeObserver?: ResizeObserver;

  private animationFrame?: number;

  private destroyed = false;

  constructor(node: ProseMirrorNode, cellMinWidth = DEFAULT_CELL_MIN_WIDTH) {
    this.node = node;
    this.cellMinWidth = Math.max(cellMinWidth, DEFAULT_CELL_MIN_WIDTH);
    this.dom = document.createElement('div');
    this.table = this.dom.appendChild(document.createElement('table'));
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
    this.measureRoot = this.dom.appendChild(document.createElement('div'));
    this.measureRoot.className = 'tableColumnMeasureRoot';
    this.measureRoot.setAttribute('aria-hidden', 'true');

    this.updateWidthMode();
    this.updateTableStyle();
    updateColumns(this.node, this.colgroup, this.table, this.cellMinWidth);
    this.observeResize();
    this.scheduleLayout();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;

    const currentWidths = Array.from(this.colgroup.children, (column) =>
      Number.parseFloat((column as HTMLTableColElement).style.width),
    );
    this.node = node;
    this.updateWidthMode();
    this.updateTableStyle();
    updateColumns(
      this.node,
      this.colgroup,
      this.table,
      this.cellMinWidth,
      currentWidths,
    );
    this.scheduleLayout();

    return true;
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();

    const ownerWindow = this.dom.ownerDocument.defaultView;
    if (this.animationFrame != null && ownerWindow?.cancelAnimationFrame) {
      ownerWindow.cancelAnimationFrame(this.animationFrame);
    }
  }

  updateWidthMode() {
    const widthMode = normalizeTableWidthMode(this.node.attrs.widthMode);

    this.dom.classList.add('tableWrapper', 'blockWidthWrapper');
    this.dom.classList.remove(
      getTableWidthModeClass('normal'),
      getTableWidthModeClass('wide'),
      getTableWidthModeClass('full'),
    );
    this.dom.classList.add(getTableWidthModeClass(widthMode));
    this.dom.setAttribute('data-block-width-mode', widthMode);
    this.dom.setAttribute('data-table-width-mode', widthMode);
    this.table.setAttribute('data-table-width-mode', widthMode);
  }

  updateTableStyle() {
    if (this.node.attrs.style) {
      this.table.style.cssText = this.node.attrs.style;
    } else {
      this.table.removeAttribute('style');
    }

    this.table.style.tableLayout = 'fixed';
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    const target = mutation.target as Node;
    const isInsideWrapper = this.dom.contains(target);
    const isInsideContent = this.contentDOM.contains(target);

    if (isInsideWrapper && !isInsideContent) {
      return true;
    }

    if (mutation.target instanceof Element) {
      const chevronTarget = mutation.target.closest(
        '.tableReadonlySortChevron',
      );

      if (chevronTarget) {
        return true;
      }
    }

    if (mutation.type === 'childList') {
      const nodes = [
        ...Array.from(mutation.addedNodes),
        ...Array.from(mutation.removedNodes),
      ];
      if (
        nodes.some(
          (changedNode) =>
            changedNode instanceof Element &&
            changedNode.classList.contains('tableReadonlySortChevron'),
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private observeResize() {
    const ResizeObserverConstructor =
      this.dom.ownerDocument.defaultView?.ResizeObserver;

    if (!ResizeObserverConstructor) return;

    this.resizeObserver = new ResizeObserverConstructor(() => {
      this.scheduleLayout();
    });
    this.resizeObserver.observe(this.dom);
  }

  private scheduleLayout() {
    if (this.destroyed || this.animationFrame != null) return;

    const ownerWindow = this.dom.ownerDocument.defaultView;
    if (ownerWindow?.requestAnimationFrame) {
      this.animationFrame = ownerWindow.requestAnimationFrame(() => {
        this.animationFrame = undefined;
        this.layoutColumns();
      });
      return;
    }

    queueMicrotask(() => this.layoutColumns());
  }

  private layoutColumns() {
    if (this.destroyed) return;

    const map = TableMap.get(this.node);
    const containerWidth =
      this.dom.clientWidth || this.dom.getBoundingClientRect().width;
    const contentWidth = getTableContentWidth(this.table, containerWidth);
    const demands = this.measureDemands(map);
    const widths = allocateTableColumnWidths({
      columnCount: map.width,
      containerWidth: contentWidth,
      minColumnWidth: this.cellMinWidth,
      demands,
    });

    updateColumns(
      this.node,
      this.colgroup,
      this.table,
      this.cellMinWidth,
      widths,
    );
  }

  private measureDemands(map: TableMap): TableColumnDemand[] {
    const cellElements = Array.from(
      this.contentDOM.querySelectorAll<HTMLTableCellElement>('th, td'),
    );
    const cellNodes: Array<{ node: ProseMirrorNode; pos: number }> = [];

    this.node.descendants((node, pos) => {
      if (
        node.type.spec.tableRole === 'cell' ||
        node.type.spec.tableRole === 'header_cell'
      ) {
        cellNodes.push({ node, pos });
        return false;
      }

      return true;
    });

    return cellNodes.flatMap(({ node, pos }, index) => {
      const cellElement = cellElements[index];
      if (!cellElement) return [];

      const rect = map.findCell(pos);
      const measurement = this.measureCell(node, cellElement);
      return [
        {
          start: rect.left,
          span: rect.right - rect.left,
          ...measurement,
        },
      ];
    });
  }

  private measureCell(
    node: ProseMirrorNode,
    cellElement: HTMLTableCellElement,
  ): TableCellWidthMeasurement {
    const cachedWidths = this.measuredWidths.get(node);
    if (cachedWidths != null) return cachedWidths;

    const styles = getComputedStyle(cellElement);
    const measure = document.createElement('div');
    measure.append(
      ...Array.from(cellElement.childNodes, (child) => child.cloneNode(true)),
    );
    measure.querySelectorAll('.tableReadonlySortChevron').forEach((element) => {
      element.remove();
    });
    Object.assign(measure.style, {
      boxSizing: styles.boxSizing,
      display: 'inline-block',
      minWidth: '0',
      maxWidth: 'none',
      padding: styles.padding,
      borderLeftWidth: styles.borderLeftWidth,
      borderRightWidth: styles.borderRightWidth,
      borderLeftStyle: styles.borderLeftStyle,
      borderRightStyle: styles.borderRightStyle,
      font: styles.font,
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      letterSpacing: styles.letterSpacing,
      lineHeight: styles.lineHeight,
      hyphens: 'none',
      overflowWrap: 'normal',
      wordBreak: 'normal',
    });

    const descendants = measure.querySelectorAll<HTMLElement>('*');
    Object.assign(measure.style, {
      width: 'min-content',
      whiteSpace: 'normal',
    });
    descendants.forEach((element) => {
      element.style.maxWidth = 'none';
      element.style.whiteSpace = 'normal';
      element.style.hyphens = 'none';
      element.style.overflowWrap = 'normal';
      element.style.wordBreak = 'normal';
    });

    const readWidth = () =>
      Math.ceil(
        Math.max(measure.scrollWidth, measure.getBoundingClientRect().width),
      );

    this.measureRoot.appendChild(measure);
    const minimumWidth = readWidth();

    Object.assign(measure.style, {
      width: 'max-content',
      whiteSpace: 'nowrap',
    });
    descendants.forEach((element) => {
      element.style.width = 'max-content';
      element.style.maxWidth = 'none';
      element.style.whiteSpace = 'nowrap';
      element.style.overflowWrap = 'normal';
      element.style.wordBreak = 'normal';
    });

    const preferredWidth = Math.max(minimumWidth, readWidth());
    measure.remove();
    const measurement = { minimumWidth, preferredWidth };
    this.measuredWidths.set(node, measurement);

    return measurement;
  }
}
