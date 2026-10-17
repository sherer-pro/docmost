import { Extension } from "@tiptap/core";
import { autoUpdate } from "@floating-ui/dom";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { dropPoint, type Mappable } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

const listTypes = new Set(["bulletList", "orderedList", "taskList"]);
const itemTypes = new Set(["listItem", "taskItem"]);
const structuralTypes = new Set([
  "detailsSummary",
  "detailsContent",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

export interface BlockDragRange {
  from: number;
  to: number;
  slice: Slice;
  list: PMNode | null;
}

export interface BlockTarget {
  from: number;
  to: number;
  node: PMNode;
  dom: HTMLElement;
}

interface DragState {
  range: BlockDragRange | null;
  cancelled: boolean;
}

export const blockDragHandleKey = new PluginKey<DragState>("blockDragHandle");

function isLocked(element: Element) {
  return Boolean(
    element.closest('[data-template-locked="true"], .not-draggable'),
  );
}

export function resolveBlockTarget(
  view: EditorView,
  target: Element,
): BlockTarget | null {
  if (!view.dom.contains(target) || isLocked(target)) return null;
  if (target.closest(".drag-handle[data-direction]")) return null;

  // Nested reference editors belong to the atom in the host document.
  const reference = target.closest('[data-type="transclusionReference"]');
  if (reference && view.dom.contains(reference)) target = reference;
  else if (target.closest(".ProseMirror") !== view.dom) return null;

  if (target === view.dom) return null;
  let pos: number;
  try {
    pos = view.posAtDOM(target, 0);
  } catch {
    return null;
  }
  const $pos = view.state.doc.resolve(pos);
  const candidates: BlockTarget[] = [];
  const add = (node: PMNode, from: number) => {
    if (!node.isBlock) return;
    const dom = view.nodeDOM(from);
    if (
      !(dom instanceof HTMLElement) ||
      !(dom === target || dom.contains(target))
    )
      return;
    const anchor =
      node.attrs.widthMode != null &&
      !dom.matches(".blockWidthWrapper, .tableWrapper")
        ? (dom.querySelector<HTMLElement>(
            ".blockWidthWrapper, .tableWrapper",
          ) ?? dom)
        : dom;
    candidates.push({ from, to: from + node.nodeSize, node, dom: anchor });
  };
  const after = view.state.doc.nodeAt(pos);
  if (after) add(after, pos);
  const before = $pos.nodeBefore;
  if (before) add(before, pos - before.nodeSize);
  for (let depth = $pos.depth; depth > 0; depth--)
    add($pos.node(depth), $pos.before(depth));

  const table = candidates.find(
    (candidate) => candidate.node.type.name === "table",
  );
  if (table) return target.closest("td, th") ? null : table;
  const atom = candidates.find((candidate) => candidate.node.isAtom);
  if (atom) return atom;
  const item = candidates.find((candidate) =>
    itemTypes.has(candidate.node.type.name),
  );
  if (item) return item;
  return (
    candidates.find(
      (candidate) => !structuralTypes.has(candidate.node.type.name),
    ) ?? null
  );
}

export function getBlockDragRange(
  state: EditorState,
  target: BlockTarget,
): BlockDragRange {
  let { from, to } = target;
  const { selection } = state;
  if (!selection.empty && selection.from < to && selection.to > from) {
    const range = selection.$from.blockRange(selection.$to);
    if (
      range &&
      range.endIndex - range.startIndex > 1 &&
      range.start <= from &&
      range.end >= to
    ) {
      let eligible = true;
      range.parent.forEach((node, _offset, index) => {
        if (index < range.startIndex || index >= range.endIndex) return;
        if (
          !node.isBlock ||
          structuralTypes.has(node.type.name) ||
          node.attrs.locked
        )
          eligible = false;
      });
      if (eligible) ({ start: from, end: to } = range);
    }
  }
  const parent = state.doc.resolve(from).parent;
  return {
    from,
    to,
    slice: state.doc.slice(from, to),
    list: listTypes.has(parent.type.name) ? parent : null,
  };
}

export function mapBlockDragRange(
  range: BlockDragRange,
  transaction: Transaction,
): BlockDragRange | null {
  const from = transaction.mapping.mapResult(range.from, 1);
  const to = transaction.mapping.mapResult(range.to, -1);
  if (from.deletedAcross || to.deletedAcross || from.pos >= to.pos) return null;
  const slice = transaction.doc.slice(from.pos, to.pos);
  if (!slice.eq(range.slice)) return null;
  const parent = transaction.doc.resolve(from.pos).parent;
  if (range.list && !parent.sameMarkup(range.list)) return null;
  return { ...range, from: from.pos, to: to.pos };
}

export function getBlockDropSlice(
  doc: PMNode,
  pos: number,
  range: BlockDragRange,
): Slice | null {
  if (pos >= range.from && pos <= range.to) return null;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.attrs.locked || node.type.name === "transclusionReference")
      return null;
  }
  let slice = range.slice;
  if (range.list) {
    let sameList = false;
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (listTypes.has(node.type.name)) {
        if (node.type !== range.list.type) return null;
        sameList = true;
        break;
      }
    }
    if (!sameList)
      slice = new Slice(
        Fragment.from(range.list.type.create(range.list.attrs, slice.content)),
        0,
        0,
      );
  }
  return dropPoint(doc, pos, slice) == null ? null : slice;
}

// A block range must delete complete nodes, including their wrappers. A text
// selection would leave the first and last paragraph shells behind on drop.
class BlockRangeSelection extends Selection {
  map(doc: PMNode, mapping: Mappable): Selection {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    return from < to
      ? new BlockRangeSelection(doc.resolve(from), doc.resolve(to))
      : Selection.near(doc.resolve(from));
  }
  eq(other: Selection) {
    return (
      other instanceof BlockRangeSelection &&
      this.from === other.from &&
      this.to === other.to
    );
  }
  toJSON() {
    return { type: "blockDragRange", from: this.from, to: this.to };
  }
  static fromJSON(doc: PMNode, json: { from: number; to: number }) {
    return new BlockRangeSelection(
      doc.resolve(json.from),
      doc.resolve(json.to),
    );
  }
  getBookmark() {
    return new BlockRangeBookmark(this.from, this.to);
  }
}

class BlockRangeBookmark {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {}
  map(mapping: Mappable) {
    return new BlockRangeBookmark(
      mapping.map(this.from, 1),
      mapping.map(this.to, -1),
    );
  }
  resolve(doc: PMNode): Selection {
    return this.from < this.to
      ? new BlockRangeSelection(doc.resolve(this.from), doc.resolve(this.to))
      : Selection.near(doc.resolve(this.from));
  }
}

Selection.jsonID("blockDragRange", BlockRangeSelection);

function blockSelection(doc: PMNode, range: BlockDragRange): Selection {
  const $from = doc.resolve(range.from);
  return $from.nodeAfter?.nodeSize === range.to - range.from
    ? NodeSelection.create(doc, range.from)
    : new BlockRangeSelection($from, doc.resolve(range.to));
}

export function createBlockDragHandlePlugin(
  label: string | (() => string),
): Plugin<DragState> {
  let handle: HTMLElement;
  let hovered: BlockTarget | null = null;
  let view: EditorView;
  let stopPositioning: (() => void) | null = null;
  const editorDrops = new WeakSet<Event>();
  const forwardedTargets = new WeakMap<Event, Element>();
  const updateLabel = () => {
    const value = typeof label === "function" ? label() : label;
    if (handle.getAttribute("aria-label") !== value) {
      handle.setAttribute("aria-label", value);
      handle.setAttribute("title", value);
    }
  };
  const state = () => blockDragHandleKey.getState(view.state)!;
  const hide = () => {
    handle?.classList.add("hide");
    stopPositioning?.();
    stopPositioning = null;
  };
  const finish = () => {
    if (view.isDestroyed) return;
    view.dragging = null;
    view.dom.classList.remove("dragging");
    hide();
    hovered = null;
    if (state().range)
      view.dispatch(view.state.tr.setMeta(blockDragHandleKey, null));
  };
  const isNarrow = () =>
    view.dom.ownerDocument.defaultView?.matchMedia("(max-width: 600px)")
      .matches;
  const position = () => {
    if (!hovered?.dom.isConnected) return false;
    const rect = hovered.dom.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const style = getComputedStyle(hovered.dom);
    const lineHeight =
      parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const marker = itemTypes.has(hovered.node.type.name) ? 16 : 0;
    const left = rect.left - marker - handleRect.width - 4;
    if (left < 0) return false;
    handle.style.left = `${left}px`;
    handle.style.top = `${rect.top + Math.max(0, parseFloat(style.paddingTop) || 0) + (lineHeight - handleRect.height) / 2}px`;
    return true;
  };
  const hover = (event: MouseEvent) => {
    if (state().range) return;
    if (!view.editable || isNarrow()) return hide();
    if (!(event.target instanceof Element)) return hide();
    let target: Element = event.target;
    if (handle.contains(target)) return;
    if (target === view.dom) {
      target =
        Array.from(view.dom.children).find((child) => {
          const rect = child.getBoundingClientRect();
          return event.clientY >= rect.top && event.clientY <= rect.bottom;
        }) ?? target;
    }
    const next = resolveBlockTarget(view, target);
    if (hovered?.dom !== next?.dom) {
      stopPositioning?.();
      stopPositioning = null;
    }
    hovered = next;
    if (!hovered) return hide();
    // The handle lives in the editor's gutter, outside transformed NodeViews.
    if (!position()) return hide();
    handle.classList.remove("hide");
    if (!stopPositioning) {
      stopPositioning = autoUpdate(
        hovered.dom,
        handle,
        () => {
          if (!position()) hide();
        },
        { animationFrame: true },
      );
    }
  };
  const down = (event: MouseEvent) => {
    if (event.button !== 0 || !hovered || !view.editable) return;
    const current = resolveBlockTarget(view, hovered.dom);
    if (!current) return hide();
    stopPositioning?.();
    stopPositioning = null;
    view.dispatch(
      view.state.tr.setMeta(blockDragHandleKey, {
        range: getBlockDragRange(view.state, current),
        cancelled: false,
      }),
    );
  };
  const start = (event: DragEvent) => {
    const current = state();
    if (
      !current.range ||
      current.cancelled ||
      !event.dataTransfer ||
      !view.editable
    ) {
      event.preventDefault();
      return finish();
    }
    const { range } = current;
    view.focus();
    view.dispatch(
      view.state.tr.setSelection(blockSelection(view.state.doc, range)),
    );
    const { dom, text } = view.serializeForClipboard(range.slice);
    event.dataTransfer.clearData();
    event.dataTransfer.setData("text/html", dom.innerHTML);
    event.dataTransfer.setData("text/plain", text);
    event.dataTransfer.effectAllowed = "copyMove";
    const source = view.nodeDOM(range.from);
    if (source instanceof HTMLElement)
      event.dataTransfer.setDragImage(source, 0, 0);
    view.dragging = { slice: range.slice, move: true };
    view.dom.classList.add("dragging");
    // Changing pointer-events on the native drag source during dragstart can
    // make Chromium cancel the drag before the destination receives a drop.
  };
  const release = () => {
    if (!view.dragging) finish();
  };
  const documentDrop = (event: DragEvent) => {
    if (!state().range) return;
    // The page-tree HTML5Backend prevents native HTML/text drops at window
    // capture. ProseMirror then skips its DOM listener. Dispatch only our own
    // skipped drop through the standard pipeline, before backend cleanup.
    if (
      event.defaultPrevented &&
      !editorDrops.has(event) &&
      event.target instanceof Element &&
      view.dom.contains(event.target)
    ) {
      // ProseMirror also treats defaultPrevented as a handled custom event.
      // Use a fresh event without redispatching through the global backend.
      const forwarded = new DragEvent("drop", {
        dataTransfer: event.dataTransfer,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        cancelable: true,
      });
      forwardedTargets.set(forwarded, event.target);
      view.dispatchEvent(forwarded);
    }
    queueMicrotask(finish);
  };
  const scroll = () => {
    if (!state().range && hovered && !position()) hide();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      view.dragging = null;
      if (state().range)
        view.dispatch(
          view.state.tr.setMeta(blockDragHandleKey, {
            ...state(),
            cancelled: true,
          }),
        );
      hide();
    } else if (
      !state().range &&
      !["Control", "Alt", "Meta", "Shift"].includes(event.key)
    )
      hide();
  };
  const autoScroll = (event: DragEvent) => {
    if (!state().range || state().cancelled || !view.dragging) return;
    let container = view.dom.parentElement;
    while (
      container &&
      !(
        container.scrollHeight > container.clientHeight &&
        /auto|scroll/.test(getComputedStyle(container).overflowY)
      )
    )
      container = container.parentElement;
    const scroller = container ?? view.dom.ownerDocument.scrollingElement;
    if (!scroller) return;
    const rect = container?.getBoundingClientRect();
    const top = rect?.top ?? 0;
    const bottom = rect?.bottom ?? window.innerHeight;
    if (event.clientY < top + 40) scroller.scrollTop -= 20;
    else if (event.clientY > bottom - 40) scroller.scrollTop += 20;
  };
  return new Plugin<DragState>({
    key: blockDragHandleKey,
    state: {
      init: () => ({ range: null, cancelled: false }),
      apply(transaction, previous) {
        const meta = transaction.getMeta(blockDragHandleKey);
        if (meta !== undefined)
          return meta ?? { range: null, cancelled: false };
        if (transaction.getMeta("uiEvent") === "drop")
          return { range: null, cancelled: false };
        if (!previous.range || previous.cancelled || !transaction.docChanged)
          return previous;
        const range = mapBlockDragRange(previous.range, transaction);
        return range
          ? { range, cancelled: false }
          : { ...previous, cancelled: true };
      },
    },
    view(editorView) {
      view = editorView;
      const doc = view.dom.ownerDocument;
      handle = doc.createElement("div");
      handle.className = "drag-handle block-drag-handle hide";
      handle.draggable = true;
      handle.dataset.dragHandle = "";
      updateLabel();
      handle.setAttribute("role", "button");
      handle.setAttribute("tabindex", "-1");
      doc.body.appendChild(handle);
      view.dom.classList.add("has-block-drag-handle");
      handle.addEventListener("mousedown", down);
      handle.addEventListener("dragstart", start);
      doc.addEventListener("mousemove", hover);
      doc.addEventListener("mouseup", release);
      doc.addEventListener("dragend", finish);
      doc.addEventListener("drop", documentDrop);
      doc.addEventListener("dragover", autoScroll);
      doc.addEventListener("keydown", keydown);
      doc.addEventListener("scroll", scroll, true);
      window.addEventListener("resize", scroll);
      return {
        update() {
          updateLabel();
          if (!view.editable || state().cancelled) {
            view.dragging = null;
            hide();
          }
        },
        destroy() {
          hide();
          handle.remove();
          view.dom.classList.remove("has-block-drag-handle", "dragging");
          doc.removeEventListener("mousemove", hover);
          doc.removeEventListener("mouseup", release);
          doc.removeEventListener("dragend", finish);
          doc.removeEventListener("drop", documentDrop);
          doc.removeEventListener("dragover", autoScroll);
          doc.removeEventListener("keydown", keydown);
          doc.removeEventListener("scroll", scroll, true);
          window.removeEventListener("resize", scroll);
        },
      };
    },
    props: {
      handleDOMEvents: {
        drop(editorView, event) {
          editorDrops.add(event);
          const current = blockDragHandleKey.getState(editorView.state)!;
          if (!current.range) return false;
          const pos = editorView.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          const target =
            forwardedTargets.get(event) ??
            (event.target instanceof Element ? event.target : null);
          const presentation = target?.closest('[contenteditable="false"]')
            ? resolveBlockTarget(editorView, target)
            : null;
          const readOnlyTarget =
            target?.closest('[contenteditable="false"]') &&
            !presentation?.node.isAtom &&
            presentation?.node.type.name !== "codeBlock";
          const blocked =
            !editorView.editable ||
            current.cancelled ||
            !pos ||
            !target ||
            isLocked(target) ||
            Boolean(readOnlyTarget) ||
            target.closest(".ProseMirror") !== editorView.dom;
          const slice =
            !blocked && pos
              ? getBlockDropSlice(editorView.state.doc, pos.pos, current.range)
              : null;
          if (!slice || !editorView.dragging) {
            event.preventDefault();
            editorView.dragging = null;
            queueMicrotask(finish);
            return true;
          }
          const selection = blockSelection(editorView.state.doc, current.range);
          if (!editorView.state.selection.eq(selection)) {
            editorView.dispatch(editorView.state.tr.setSelection(selection));
          }
          editorView.dragging.slice = slice;
          queueMicrotask(finish);
          return false;
        },
      },
    },
  });
}

export const BlockDragHandle = Extension.create<{ getLabel: () => string }>({
  name: "blockDragHandle",
  addOptions: () => ({ getLabel: () => "Move block" }),
  addProseMirrorPlugins() {
    return [createBlockDragHandlePlugin(this.options.getLabel)];
  },
});
