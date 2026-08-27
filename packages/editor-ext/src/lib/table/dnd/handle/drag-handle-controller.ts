import { Editor } from '@tiptap/core';
import { HoveringCellInfo } from '../utils';
import { computePosition, offset } from '@floating-ui/dom';

export class DragHandleController {
  private _colDragHandle: HTMLElement;
  private _rowDragHandle: HTMLElement;
  private _visibilityRevision = 0;

  constructor(getLabel: (key: 'moveColumn' | 'moveRow') => string) {
    this._colDragHandle = this._createDragHandleDom(
      'col',
      getLabel('moveColumn'),
    );
    this._rowDragHandle = this._createDragHandleDom('row', getLabel('moveRow'));
  }

  get colDragHandle() {
    return this._colDragHandle;
  }

  get rowDragHandle() {
    return this._rowDragHandle;
  }

  show = (editor: Editor, hoveringCell: HoveringCellInfo) => {
    const revision = ++this._visibilityRevision;
    this._showColDragHandle(editor, hoveringCell, revision);
    this._showRowDragHandle(editor, hoveringCell, revision);
  };

  hide = () => {
    this._visibilityRevision += 1;
    Object.assign(this._colDragHandle.style, {
      display: 'none',
      left: '-999px',
      top: '-999px',
    });
    Object.assign(this._rowDragHandle.style, {
      display: 'none',
      left: '-999px',
      top: '-999px',
    });
  };

  destroy = () => {
    this._visibilityRevision += 1;
    this._colDragHandle.remove();
    this._rowDragHandle.remove();
  };

  private _createDragHandleDom = (type: 'col' | 'row', label: string) => {
    const dragHandle = document.createElement('div');
    dragHandle.classList.add('drag-handle');
    // Keep table reordering on the pointer lifecycle. Firefox can omit both
    // `drop` and `dragend` for native HTML drags inside the editor, leaving the
    // preview active without committing the captured row or column range.
    dragHandle.draggable = false;
    dragHandle.setAttribute('role', 'button');
    dragHandle.setAttribute('tabindex', '-1');
    dragHandle.setAttribute('aria-label', label);
    dragHandle.setAttribute('title', label);
    dragHandle.setAttribute(
      'data-direction',
      type === 'col' ? 'horizontal' : 'vertical',
    );
    dragHandle.setAttribute('data-drag-handle', '');
    Object.assign(dragHandle.style, {
      position: 'absolute',
      top: '-999px',
      left: '-999px',
      display: 'none',
    });
    return dragHandle;
  };

  private _showColDragHandle(
    editor: Editor,
    hoveringCell: HoveringCellInfo,
    revision: number,
  ) {
    const referenceCell = editor.view.nodeDOM(hoveringCell.colFirstCellPos);
    if (!referenceCell) return;

    const yOffset =
      (-1 * parseFloat(getComputedStyle(this._colDragHandle).height)) / 2;

    computePosition(referenceCell as HTMLElement, this._colDragHandle, {
      placement: 'top',
      middleware: [offset(yOffset)],
    }).then(({ x, y }) => {
      if (revision !== this._visibilityRevision) return;
      Object.assign(this._colDragHandle.style, {
        display: 'block',
        top: `${y}px`,
        left: `${x}px`,
      });
    });
  }

  private _showRowDragHandle(
    editor: Editor,
    hoveringCell: HoveringCellInfo,
    revision: number,
  ) {
    const referenceCell = editor.view.nodeDOM(hoveringCell.rowFirstCellPos);
    if (!referenceCell) return;

    const xOffset =
      (-1 * parseFloat(getComputedStyle(this._rowDragHandle).width)) / 2;

    computePosition(referenceCell as HTMLElement, this._rowDragHandle, {
      middleware: [offset(xOffset)],
      placement: 'left',
    }).then(({ x, y }) => {
      if (revision !== this._visibilityRevision) return;
      Object.assign(this._rowDragHandle.style, {
        display: 'block',
        top: `${y}px`,
        left: `${x}px`,
      });
    });
  }
}
