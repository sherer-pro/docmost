import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import {
  getTableWidthModeClass,
  normalizeTableWidthMode,
} from './utils/width-mode';

export function updateColumns(
  _node: ProseMirrorNode,
  colgroup: HTMLElement,
  table: HTMLTableElement,
  _cellMinWidth: number,
  _overrideCol?: number,
  _overrideValue?: number,
) {
  while (colgroup.firstChild) {
    colgroup.firstChild.remove();
  }

  table.style.width = '100%';
  table.style.minWidth = '';
}

export class TableView implements NodeView {
  node: ProseMirrorNode;

  dom: HTMLDivElement;

  table: HTMLTableElement;

  contentDOM: HTMLTableSectionElement;

  constructor(node: ProseMirrorNode, _cellMinWidth?: number) {
    this.node = node;
    this.dom = document.createElement('div');
    this.table = this.dom.appendChild(document.createElement('table'));
    this.updateWidthMode();
    this.updateTableStyle();
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;

    this.node = node;
    this.updateWidthMode();
    this.updateTableStyle();

    return true;
  }

  updateWidthMode() {
    const widthMode = normalizeTableWidthMode(this.node.attrs.widthMode);

    this.dom.className = `tableWrapper blockWidthWrapper ${getTableWidthModeClass(widthMode)}`;
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

    this.table.style.width = '100%';
    this.table.style.minWidth = '';
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
