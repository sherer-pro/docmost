// @vitest-environment happy-dom

import { Editor, Node } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  Callout,
  Details,
  DetailsSummary,
  DetailsContent,
  TransclusionReference,
  TemplateManagedBlock,
  CustomTable,
  TableRow,
  TableCell,
  TableHeader,
  TiptapImage,
  TiptapVideo,
  TiptapAudio,
  TiptapPdf,
  Attachment,
  MathBlock,
} from "@docmost/editor-ext";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BlockDragHandle,
  blockDragHandleKey,
  getBlockDragRange,
  getBlockDropSlice,
  mapBlockDragRange,
  resolveBlockTarget,
} from "./block-drag-handle";

const editors: Editor[] = [];
const Atom = Node.create({
  name: "testAtom",
  group: "block",
  atom: true,
  renderHTML: () => [
    "div",
    { "data-type": "testAtom", contenteditable: "false" },
    ["span", "Atom content"],
  ],
});

function createEditor(content: any) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem,
      Callout,
      Details,
      DetailsSummary,
      DetailsContent,
      Atom,
      TransclusionReference,
      TemplateManagedBlock,
      CustomTable,
      TableRow,
      TableCell,
      TableHeader,
      TiptapImage,
      TiptapVideo,
      TiptapAudio,
      TiptapPdf,
      Attachment,
      MathBlock,
      BlockDragHandle,
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

function target(editor: Editor, selector: string) {
  return resolveBlockTarget(
    editor.view,
    editor.view.dom.querySelector(selector)!,
  );
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = "";
});

describe("block drag target resolution", () => {
  it("resolves first and later quote paragraphs consistently and the outer quote separately", () => {
    const editor = createEditor(
      "<blockquote><p>First</p><p>Second</p></blockquote>",
    );
    expect(target(editor, "blockquote p:first-child")?.node.textContent).toBe(
      "First",
    );
    expect(target(editor, "blockquote p:nth-child(2)")?.node.textContent).toBe(
      "Second",
    );
    expect(target(editor, "blockquote")?.node.type.name).toBe("blockquote");
  });

  it("resolves nested callout content and the outer container", () => {
    const editor = createEditor(
      '<div data-type="callout"><p>First</p><h2>Heading</h2></div>',
    );
    expect(target(editor, '[data-type="callout"] p')?.node.type.name).toBe(
      "paragraph",
    );
    expect(target(editor, '[data-type="callout"] h2')?.node.type.name).toBe(
      "heading",
    );
    expect(target(editor, '[data-type="callout"]')?.node.type.name).toBe(
      "callout",
    );
  });

  it("moves details summaries with their container and body paragraphs separately", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "details",
          content: [
            {
              type: "detailsSummary",
              content: [{ type: "text", text: "Summary" }],
            },
            {
              type: "detailsContent",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Body" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(target(editor, '[data-type="detailsSummary"]')?.node.type.name).toBe(
      "details",
    );
    expect(
      target(editor, '[data-type="detailsContent"] p')?.node.type.name,
    ).toBe("paragraph");
  });

  it("selects list items with their nested list rather than their text paragraph", () => {
    const editor = createEditor(
      "<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>",
    );
    expect(target(editor, "li > p")?.node.textContent).toBe("OuterInner");
    expect(target(editor, "li li p")?.node.textContent).toBe("Inner");
    expect(target(editor, "ul")?.node.type.name).toBe("bulletList");
  });

  it("keeps atoms whole and ignores locked template content and foreign editors", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "testAtom" },
        {
          type: "templateManagedBlock",
          attrs: { locked: true },
          content: [{ type: "paragraph" }],
        },
      ],
    });
    expect(target(editor, '[data-type="testAtom"] span')?.node.type.name).toBe(
      "testAtom",
    );
    expect(target(editor, '[data-template-locked="true"] p')).toBeNull();
    expect(
      resolveBlockTarget(editor.view, document.createElement("p")),
    ).toBeNull();
  });

  it("resolves a NodeView presentation mapped to the end of its node", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "testAtom" }, { type: "paragraph" }],
    });
    vi.spyOn(editor.view, "posAtDOM").mockReturnValue(
      editor.state.doc.child(0).nodeSize,
    );
    expect(target(editor, '[data-type="testAtom"] span')?.node.type.name).toBe(
      "testAtom",
    );
  });

  it("targets a synced reference without selecting its nested editor content", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "transclusionReference",
          attrs: {
            sourcePageId: "9be6ba83-cb00-4ad3-b835-1c13d73e25fd",
            transclusionId: "59d5ce85-443f-46b2-a125-8298344c4a24",
          },
        },
      ],
    });
    const ref = editor.view.dom.querySelector(
      '[data-type="transclusionReference"]',
    )!;
    ref.innerHTML =
      '<div class="ProseMirror" contenteditable="false"><p>Nested text</p></div>';
    expect(target(editor, "p")?.node.type.name).toBe("transclusionReference");
  });

  it("moves tables as a whole without intercepting cell or row handles", () => {
    const editor = createEditor(
      "<table><tr><td><p>Cell</p></td></tr></table><p>Outside</p>",
    );
    expect(target(editor, "td p")).toBeNull();
    expect(target(editor, "table")?.node.type.name).toBe("table");
  });
});

describe("block drag ranges and insertion", () => {
  it("keeps the handle available when a copy modifier is pressed", () => {
    createEditor("<p>Source</p>");
    const handle = document.querySelector(".block-drag-handle")!;
    handle.classList.remove("hide");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Control", bubbles: true }),
    );
    expect(handle.classList.contains("hide")).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(handle.classList.contains("hide")).toBe(true);
  });

  it("allows dropping next to an atom through its non-editable presentation", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Source" }] },
        { type: "testAtom" },
        { type: "paragraph" },
      ],
    });
    const range = getBlockDragRange(editor.state, target(editor, "p")!);
    editor.view.dispatch(
      editor.state.tr.setMeta(blockDragHandleKey, { range, cancelled: false }),
    );
    editor.view.dragging = { slice: range.slice, move: true };
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: range.to + 1,
      inside: range.to,
    });
    const event = new Event("drop", { cancelable: true }) as DragEvent;
    Object.defineProperties(event, {
      target: {
        value: editor.view.dom.querySelector('[data-type="testAtom"] span'),
      },
      clientX: { value: 0 },
      clientY: { value: 0 },
    });
    const plugin = blockDragHandleKey.get(editor.state)!;
    const handled = plugin.props.handleDOMEvents!.drop!.call(
      plugin,
      editor.view,
      event,
    );
    expect(handled).toBe(false);
    expect(editor.view.dragging).not.toBeNull();
  });
  it("routes an owned drop past a global preventDefault without moving twice", async () => {
    // Happy DOM ignores DragEventInit.dataTransfer, unlike browser engines.
    const OriginalDragEvent = DragEvent;
    vi.stubGlobal(
      "DragEvent",
      class extends OriginalDragEvent {
        constructor(type: string, init: DragEventInit) {
          super(type, init);
          Object.defineProperty(this, "dataTransfer", {
            value: init.dataTransfer,
          });
        }
      },
    );
    const editor = createEditor("<p>First</p><p>Middle</p><p>Destination</p>");
    const range = getBlockDragRange(editor.state, target(editor, "p")!);
    const destination = target(editor, "p:last-child")!;
    editor.view.dispatch(
      editor.state.tr
        .setSelection(NodeSelection.create(editor.state.doc, range.from))
        .setMeta(blockDragHandleKey, { range, cancelled: false }),
    );
    editor.view.dragging = { slice: range.slice, move: true };
    editor.commands.setTextSelection(destination.from + 1);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: destination.from + 1,
      inside: destination.from,
    });
    const prevent = (event: Event) => event.preventDefault();
    window.addEventListener("drop", prevent, true);
    try {
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      expect(event.dataTransfer).toBeDefined();
      destination.dom.dispatchEvent(event);
      await Promise.resolve();
      const texts = () => {
        const result: string[] = [];
        editor.state.doc.forEach((node) => result.push(node.textContent));
        return result;
      };
      expect(texts()).toEqual(["Middle", "First", "Destination"]);
      expect(editor.view.dragging).toBeNull();
      expect(blockDragHandleKey.getState(editor.state)?.range).toBeNull();
      editor.commands.undo();
      expect(texts()).toEqual(["First", "Middle", "Destination"]);
    } finally {
      window.removeEventListener("drop", prevent, true);
      vi.unstubAllGlobals();
    }
  });
  it("expands a multi-block selection to complete sibling blocks", () => {
    const editor = createEditor("<p>First</p><p>Second</p><p>Third</p>");
    editor.commands.setTextSelection({ from: 2, to: 12 });
    const range = getBlockDragRange(editor.state, target(editor, "p")!);
    expect(range.from).toBe(0);
    expect(range.slice.content.childCount).toBe(2);
    expect(range.slice.openStart).toBe(0);
    expect(range.slice.openEnd).toBe(0);
  });

  it("uses only the hovered block for a selection in another block", () => {
    const editor = createEditor("<p>First</p><p>Second</p>");
    editor.commands.setTextSelection({ from: 1, to: 3 });
    expect(
      getBlockDragRange(editor.state, target(editor, "p:nth-child(2)")!).slice
        .content.firstChild?.textContent,
    ).toBe("Second");
  });

  it("maps unrelated edits but cancels a changed or deleted source", () => {
    const editor = createEditor("<p>First</p><p>Second</p>");
    const range = getBlockDragRange(
      editor.state,
      target(editor, "p:nth-child(2)")!,
    );
    const mapped = mapBlockDragRange(
      range,
      editor.state.tr.insertText("New ", 1),
    );
    expect(mapped?.from).toBe(range.from + 4);
    expect(
      mapBlockDragRange(range, editor.state.tr.insertText("X", range.from + 2)),
    ).toBeNull();
    expect(
      mapBlockDragRange(range, editor.state.tr.delete(range.from, range.to)),
    ).toBeNull();
  });

  it("rejects self drops and keeps the source list type and attributes outside lists", () => {
    const editor = createEditor(
      '<ol start="7"><li><p>First</p></li><li><p>Second</p></li></ol><p>Outside</p>',
    );
    const range = getBlockDragRange(editor.state, target(editor, "li p")!);
    expect(
      getBlockDropSlice(editor.state.doc, range.from + 1, range),
    ).toBeNull();
    const slice = getBlockDropSlice(
      editor.state.doc,
      editor.state.doc.content.size - 1,
      range,
    )!;
    expect(slice.content.firstChild?.type.name).toBe("orderedList");
    expect(slice.content.firstChild?.attrs.start).toBe(7);
    expect(slice.content.firstChild?.firstChild?.textContent).toBe("First");
  });

  it("rejects insertion into a locked template region", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Source" }] },
        {
          type: "templateManagedBlock",
          attrs: { locked: true },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Locked" }] },
          ],
        },
      ],
    });
    const range = getBlockDragRange(editor.state, target(editor, "p")!);
    const locked = editor.state.doc.child(0).nodeSize + 2;
    expect(getBlockDropSlice(editor.state.doc, locked, range)).toBeNull();
  });

  it("preserves task state and rejects conversion into a different list type", () => {
    const editor = createEditor(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul><ul><li><p>Ordinary</p></li></ul><p>Outside</p>',
    );
    const range = getBlockDragRange(
      editor.state,
      target(editor, '[data-type="taskList"] li p')!,
    );
    const slice = getBlockDropSlice(
      editor.state.doc,
      editor.state.doc.content.size - 1,
      range,
    )!;
    expect(slice.content.firstChild?.type.name).toBe("taskList");
    expect(slice.content.firstChild?.firstChild?.attrs.checked).toBe(true);
    const ordinary = target(editor, "ul:not([data-type]) li p")!;
    expect(
      getBlockDropSlice(editor.state.doc, ordinary.from + 2, range),
    ).toBeNull();
  });

  it("cancels active drags when source content changes and removes owned DOM on destroy", () => {
    const editor = createEditor("<p>First</p><p>Second</p>");
    const range = getBlockDragRange(editor.state, target(editor, "p")!);
    editor.view.dispatch(
      editor.state.tr
        .setMeta(blockDragHandleKey, { range, cancelled: false })
        .setSelection(NodeSelection.create(editor.state.doc, 0)),
    );
    editor.view.dragging = { slice: range.slice, move: true };
    editor.view.dispatch(editor.state.tr.insertText("Changed", 2));
    expect(blockDragHandleKey.getState(editor.state)?.cancelled).toBe(true);
    expect(editor.view.dragging).toBeNull();
    expect(document.querySelectorAll(".block-drag-handle")).toHaveLength(1);
    editor.destroy();
    expect(document.querySelectorAll(".block-drag-handle")).toHaveLength(0);
  });
});
