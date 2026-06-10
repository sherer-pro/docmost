import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { getColStyleDeclaration } from './utils/col-style';
import {
  getTableWidthModeClass,
  normalizeTableWidthMode,
} from './utils/width-mode';

export function updateColumns(
  node: ProseMirrorNode,
  colgroup: HTMLElement,
  table: HTMLTableElement,
  cellMinWidth: number,
  overrideCol?: number,
  overrideValue?: number,
) {
  const widthMode = normalizeTableWidthMode(node.attrs.widthMode);
  const columnWidths: Array<number | undefined> = [];
  let totalWidth = 0;
  let fixedWidth = true;
  let nextDOM = colgroup.firstChild;
  const row = node.firstChild;

  if (row !== null) {
    for (let i = 0, col = 0; i < row.childCount; i += 1) {
      const { colspan, colwidth } = row.child(i).attrs;

      for (let j = 0; j < colspan; j += 1, col += 1) {
        const hasWidth =
          overrideCol === col
            ? overrideValue
            : ((colwidth && colwidth[j]) as number | undefined);
        const normalizedWidth = hasWidth
          ? Math.max(hasWidth, cellMinWidth)
          : undefined;

        columnWidths.push(normalizedWidth);
        totalWidth += normalizedWidth || cellMinWidth;

        if (!normalizedWidth) {
          fixedWidth = false;
        }
      }
    }
  }

  columnWidths.forEach((columnWidth) => {
    const [propertyKey, propertyValue] =
      widthMode === 'normal' && columnWidth
        ? ['width', `${(columnWidth / totalWidth) * 100}%`]
        : getColStyleDeclaration(cellMinWidth, columnWidth);

    if (!nextDOM) {
      const colElement = document.createElement('col');

      applyColumnStyle(colElement, propertyKey, propertyValue);

      colgroup.appendChild(colElement);
    } else {
      applyColumnStyle(
        nextDOM as HTMLTableColElement,
        propertyKey,
        propertyValue,
      );

      nextDOM = nextDOM.nextSibling;
    }
  });

  while (nextDOM) {
    const after = nextDOM.nextSibling;

    nextDOM.parentNode?.removeChild(nextDOM);
    nextDOM = after;
  }

  const hasUserWidth =
    node.attrs.style &&
    typeof node.attrs.style === 'string' &&
    /\bwidth\s*:/i.test(node.attrs.style);

  if (widthMode === 'normal') {
    table.style.width = '100%';
    table.style.minWidth = '';
    return;
  }

  if (fixedWidth && !hasUserWidth) {
    table.style.width = `${totalWidth}px`;
    table.style.minWidth = '';
  } else {
    table.style.width = '';
    table.style.minWidth = `${totalWidth}px`;
  }
}

function applyColumnStyle(
  colElement: HTMLTableColElement,
  propertyKey: string,
  propertyValue: string,
): void {
  if (propertyKey === 'width') {
    colElement.style.removeProperty('min-width');
  } else {
    colElement.style.removeProperty('width');
  }

  if (colElement.style.getPropertyValue(propertyKey) !== propertyValue) {
    colElement.style.setProperty(propertyKey, propertyValue);
  }
}

export class TableView implements NodeView {
  node: ProseMirrorNode;

  cellMinWidth: number;

  dom: HTMLDivElement;

  table: HTMLTableElement;

  colgroup: HTMLTableColElement;

  contentDOM: HTMLTableSectionElement;

  constructor(node: ProseMirrorNode, cellMinWidth: number) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.dom = document.createElement('div');
    this.updateWidthMode();
    this.table = this.dom.appendChild(document.createElement('table'));
    this.table.setAttribute(
      'data-table-width-mode',
      normalizeTableWidthMode(node.attrs.widthMode),
    );

    if (node.attrs.style) {
      this.table.style.cssText = node.attrs.style;
    }

    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    updateColumns(node, this.colgroup, this.table, cellMinWidth);
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;

    this.node = node;
    this.updateWidthMode();
    this.table.setAttribute(
      'data-table-width-mode',
      normalizeTableWidthMode(node.attrs.widthMode),
    );
    updateColumns(node, this.colgroup, this.table, this.cellMinWidth);

    return true;
  }

  updateWidthMode() {
    const widthMode = normalizeTableWidthMode(this.node.attrs.widthMode);

    this.dom.className = `tableWrapper ${getTableWidthModeClass(widthMode)}`;
    this.dom.setAttribute('data-table-width-mode', widthMode);
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    const target = mutation.target as Node;
    const isInsideWrapper = this.dom.contains(target);
    const isInsideContent = this.contentDOM.contains(target);

    if (isInsideWrapper && !isInsideContent) {
      if (
        mutation.type === 'attributes' ||
        mutation.type === 'childList' ||
        mutation.type === 'characterData'
      ) {
        return true;
      }
    }

    if (mutation.target instanceof Element) {
      const chevronTarget = mutation.target.closest(
        '.tableReadonlySortChevron',
      );

      if (chevronTarget) {
        return true;
      }
    }

    // Chevron span (.tableReadonlySortChevron) added/removed by sort plugin.
    if (mutation.type === 'childList') {
      const nodes = [
        ...Array.from(mutation.addedNodes),
        ...Array.from(mutation.removedNodes),
      ];
      if (
        nodes.some(
          (n) =>
            n instanceof Element &&
            n.classList.contains('tableReadonlySortChevron'),
        )
      ) {
        return true;
      }
    }

    return false;
  }
}
