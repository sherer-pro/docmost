import { Editor, Extension } from '@tiptap/core';
import { PluginKey, Plugin, PluginSpec } from '@tiptap/pm/state';
import { EditorProps, EditorView } from '@tiptap/pm/view';
import {
  DraggingDOMs,
  getDndRelatedDOMs,
  getHoveringCell,
  HoveringCellInfo,
} from './utils';
import { getDragOverColumn, getDragOverRow } from './calc-drag-over';
import {
  getColumnRangeAt,
  getRowRangeAt,
  moveColumn,
  moveRow,
  moveSelectedColumn,
} from '../utils';
import { PreviewController } from './preview/preview-controller';
import { DropIndicatorController } from './preview/drop-indicator-controller';
import { DragHandleController } from './handle/drag-handle-controller';
import { EmptyImageController } from './handle/empty-image-controller';
import { AutoScrollController } from './auto-scroll-controller';

export interface TableDndOptions {
  getLabel: (key: 'moveColumn' | 'moveRow') => string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableDragAndDrop: {
      moveColumnLeft: () => ReturnType;
      moveColumnRight: () => ReturnType;
    };
  }
}

export const TableDndKey = new PluginKey('table-drag-and-drop');

const TABLE_DND_MIME_TYPE = 'application/x-docmost-table-dnd';

class TableDragHandlePluginSpec implements PluginSpec<void> {
  key = TableDndKey;
  props: EditorProps<Plugin<void>>;

  private _colDragHandle: HTMLElement;
  private _rowDragHandle: HTMLElement;
  private _hoveringCell?: HoveringCellInfo;
  private _disposables: (() => void)[] = [];
  private _draggingCoords: { x: number; y: number } = { x: 0, y: 0 };
  private _dragPending = false;
  private _dragging = false;
  private _draggingDirection: 'col' | 'row' = 'col';
  private _draggingIndex = -1;
  private _droppingIndex = -1;
  private _draggingCellPos?: number;
  private _draggingRange?: readonly number[];
  private _draggingDOMs?: DraggingDOMs | undefined;
  private _startCoords: { x: number; y: number } = { x: 0, y: 0 };
  private _previewController: PreviewController;
  private _dropIndicatorController: DropIndicatorController;
  private _dragHandleController: DragHandleController;
  private _emptyImageController: EmptyImageController;
  private _autoScrollController: AutoScrollController;

  constructor(
    public editor: Editor,
    options: TableDndOptions,
  ) {
    this.props = {
      handleDOMEvents: {
        pointerover: this._pointerOver,
      },
    };

    this._dragHandleController = new DragHandleController(options.getLabel);
    this._colDragHandle = this._dragHandleController.colDragHandle;
    this._rowDragHandle = this._dragHandleController.rowDragHandle;

    this._previewController = new PreviewController();
    this._dropIndicatorController = new DropIndicatorController();
    this._emptyImageController = new EmptyImageController();

    this._autoScrollController = new AutoScrollController();
  }

  view = () => {
    const wrapper = this.editor.options.element;
    //@ts-ignore
    wrapper.appendChild(this._colDragHandle);
    //@ts-ignore
    wrapper.appendChild(this._rowDragHandle);
    //@ts-ignore
    wrapper.appendChild(this._previewController.previewRoot);
    //@ts-ignore
    wrapper.appendChild(this._dropIndicatorController.dropIndicatorRoot);
    this._bindDragEvents();

    return {
      update: this.update,
      destroy: this.destroy,
    };
  };

  update = () => {
    if (!this.editor.isEditable) {
      this._dragHandleController.hide();
    }
  };

  destroy = () => {
    this._dragHandleController.destroy();
    this._emptyImageController.destroy();
    this._previewController.destroy();
    this._dropIndicatorController.destroy();
    this._autoScrollController.stop();

    this._disposables.forEach((disposable) => disposable());
  };

  private _pointerOver = (view: EditorView, event: PointerEvent) => {
    if (this._dragPending || this._dragging) return;

    if (
      !this.editor.isEditable ||
      view.dom.ownerDocument.defaultView?.matchMedia('(max-width: 600px)')
        .matches
    ) {
      this._dragHandleController.hide();
      return;
    }

    const hoveringCell = getHoveringCell(view, event);
    this._hoveringCell = hoveringCell;
    if (!hoveringCell) {
      this._dragHandleController.hide();
    } else {
      this._dragHandleController.show(this.editor, hoveringCell);
    }
  };

  private _onDragColStart = (event: DragEvent) => {
    this._onDragStart(event, 'col');
  };

  private _onDraggingCol = (event: DragEvent) => {
    const draggingDOMs = this._draggingDOMs;
    if (!draggingDOMs) return;

    this._draggingCoords = { x: event.clientX, y: event.clientY };
    this._previewController.onDragging(
      draggingDOMs,
      this._draggingCoords.x,
      this._draggingCoords.y,
      'col',
    );

    this._autoScrollController.checkXAutoScroll(event.clientX, draggingDOMs);

    const dragOverColumn = getDragOverColumn(
      draggingDOMs.table,
      this._draggingCoords.x,
    );
    if (!dragOverColumn) {
      this._droppingIndex = -1;
      this._dropIndicatorController.hide();
      return;
    }

    const [col, index] = dragOverColumn;
    this._droppingIndex = index;
    const rect = col.getBoundingClientRect();
    const direction =
      this._draggingCoords.x < rect.left + rect.width / 2 ? 'left' : 'right';
    this._dropIndicatorController.onDragging(col, direction, 'col');
  };

  private _onDragRowStart = (event: DragEvent) => {
    this._onDragStart(event, 'row');
  };

  private _onDraggingRow = (event: DragEvent) => {
    const draggingDOMs = this._draggingDOMs;
    if (!draggingDOMs) return;

    this._draggingCoords = { x: event.clientX, y: event.clientY };
    this._previewController.onDragging(
      draggingDOMs,
      this._draggingCoords.x,
      this._draggingCoords.y,
      'row',
    );

    this._autoScrollController.checkYAutoScroll(event.clientY);

    const direction =
      this._startCoords.y > this._draggingCoords.y ? 'up' : 'down';
    const dragOverRow = getDragOverRow(
      draggingDOMs.table,
      this._draggingCoords.y,
    );
    if (!dragOverRow) {
      this._droppingIndex = -1;
      this._dropIndicatorController.hide();
      return;
    }

    const [row, index] = dragOverRow;
    this._droppingIndex = index;
    this._dropIndicatorController.onDragging(row, direction, 'row');
  };

  private _onDragEnd = () => {
    this._dragPending = false;
    this._dragging = false;
    this._draggingIndex = -1;
    this._droppingIndex = -1;
    this._draggingCellPos = undefined;
    this._draggingRange = undefined;
    this._draggingDOMs = undefined;
    this._startCoords = { x: 0, y: 0 };
    this._autoScrollController.stop();
    this._dropIndicatorController.onDragEnd();
    this._previewController.onDragEnd();
  };

  private _bindDragEvents = () => {
    const onPointerDown = () => {
      // Freeze the hovered cell before the browser starts its native drag.
      // Otherwise pointerover can move the absolutely positioned handle away
      // from under the pressed pointer and Chromium cancels dragstart.
      this._dragPending = true;
    };
    const onPointerRelease = () => {
      if (!this._dragging) this._dragPending = false;
    };

    this._colDragHandle.addEventListener('pointerdown', onPointerDown);
    this._rowDragHandle.addEventListener('pointerdown', onPointerDown);
    this._disposables.push(() => {
      this._colDragHandle.removeEventListener('pointerdown', onPointerDown);
      this._rowDragHandle.removeEventListener('pointerdown', onPointerDown);
    });

    this._colDragHandle.addEventListener('dragstart', this._onDragColStart);
    this._disposables.push(() => {
      this._colDragHandle.removeEventListener(
        'dragstart',
        this._onDragColStart,
      );
    });

    this._colDragHandle.addEventListener('dragend', this._onDragEnd);
    this._disposables.push(() => {
      this._colDragHandle.removeEventListener('dragend', this._onDragEnd);
    });

    this._rowDragHandle.addEventListener('dragstart', this._onDragRowStart);
    this._disposables.push(() => {
      this._rowDragHandle.removeEventListener(
        'dragstart',
        this._onDragRowStart,
      );
    });

    this._rowDragHandle.addEventListener('dragend', this._onDragEnd);
    this._disposables.push(() => {
      this._rowDragHandle.removeEventListener('dragend', this._onDragEnd);
    });

    const ownerDocument = this.editor.view.dom?.ownerDocument;
    if (ownerDocument) {
      ownerDocument.addEventListener('pointerup', onPointerRelease, true);
      ownerDocument.addEventListener('pointercancel', onPointerRelease, true);
      // To make `drop` event work, we need to prevent the default behavior of the
      // `dragover` event for drop zone. Here we set the whole document as the
      // drop zone so that even the mouse moves outside the editor, the `drop`
      // event will still be triggered.
      ownerDocument.addEventListener('drop', this._onDrop, true);
      ownerDocument.addEventListener('dragover', this._onDrag, true);
      this._disposables.push(() => {
        ownerDocument.removeEventListener('pointerup', onPointerRelease, true);
        ownerDocument.removeEventListener(
          'pointercancel',
          onPointerRelease,
          true,
        );
        ownerDocument.removeEventListener('drop', this._onDrop, true);
        ownerDocument.removeEventListener('dragover', this._onDrag, true);
      });
    }
  };

  private _onDragStart = (event: DragEvent, type: 'col' | 'row') => {
    const hoveringCell = this._hoveringCell;
    if (!hoveringCell) {
      event.preventDefault();
      return;
    }

    const dataTransfer = event.dataTransfer;
    if (dataTransfer) {
      dataTransfer.setData(TABLE_DND_MIME_TYPE, type);
      dataTransfer.effectAllowed = 'move';
      this._emptyImageController.hideDragImage(dataTransfer);
    }
    this._dragPending = false;
    this._dragging = true;
    this._draggingDirection = type;
    this._startCoords = { x: event.clientX, y: event.clientY };
    const draggingIndex =
      type === 'col' ? hoveringCell.colIndex : hoveringCell.rowIndex;

    this._draggingIndex = draggingIndex;
    this._draggingCellPos = hoveringCell.cellPos;
    this._draggingRange =
      type === 'col'
        ? getColumnRangeAt(
            this.editor.state.tr,
            draggingIndex,
            hoveringCell.cellPos,
          )
        : getRowRangeAt(
            this.editor.state.tr,
            draggingIndex,
            hoveringCell.cellPos,
          );

    const relatedDoms = getDndRelatedDOMs(
      this.editor.view,
      hoveringCell.cellPos,
      draggingIndex,
      type,
    );
    if (!relatedDoms || !this._draggingRange?.length) {
      event.preventDefault();
      this._onDragEnd();
      return;
    }
    this._draggingDOMs = relatedDoms;

    const index =
      type === 'col' ? hoveringCell.colIndex : hoveringCell.rowIndex;

    this._previewController.onDragStart(relatedDoms, index, type);
    this._dropIndicatorController.onDragStart(relatedDoms, type);
  };

  private _onDrag = (event: DragEvent) => {
    if (!this._dragging) return;
    event.preventDefault();
    event.stopPropagation();
    if (this._draggingDirection === 'col') {
      this._onDraggingCol(event);
    } else {
      this._onDraggingRow(event);
    }
  };

  private _onDrop = (event: DragEvent) => {
    if (!this._dragging) return;
    event.preventDefault();
    event.stopPropagation();

    try {
      const direction = this._draggingDirection;
      const from = this._draggingIndex;
      const to = this._droppingIndex;
      const pos = this._draggingCellPos;
      const originIndexes = this._draggingRange;
      if (from < 0 || to < 0 || pos == null || !originIndexes?.length) return;

      const tr = this.editor.state.tr;

      if (direction === 'col') {
        const canMove = moveColumn({
          tr,
          originIndex: from,
          targetIndex: to,
          select: true,
          pos,
          originIndexes,
        });
        if (canMove) {
          this.editor.view.dispatch(tr);
        }

        return;
      }

      if (direction === 'row') {
        const canMove = moveRow({
          tr,
          originIndex: from,
          targetIndex: to,
          select: true,
          pos,
          originIndexes,
        });
        if (canMove) {
          this.editor.view.dispatch(tr);
        }
      }
    } finally {
      this._onDragEnd();
    }
  };
}

export const TableDndExtension = Extension.create<TableDndOptions>({
  name: 'table-drag-and-drop',
  addOptions() {
    return {
      getLabel: (key) => (key === 'moveColumn' ? 'Move column' : 'Move row'),
    };
  },
  addCommands() {
    return {
      moveColumnLeft:
        () =>
        ({ tr, state }) =>
          moveSelectedColumn({
            tr,
            pos: state.selection.from,
            direction: -1,
          }),
      moveColumnRight:
        () =>
        ({ tr, state }) =>
          moveSelectedColumn({
            tr,
            pos: state.selection.from,
            direction: 1,
          }),
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;

    const dragHandlePluginSpec = new TableDragHandlePluginSpec(
      editor,
      this.options,
    );
    const dragHandlePlugin = new Plugin(dragHandlePluginSpec);

    return [dragHandlePlugin];
  },
});
