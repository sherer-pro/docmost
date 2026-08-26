// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import {
  CustomTable,
  TablePaste,
  TableReadonlySort,
  TableView,
  createTableNodeFromRows,
  isSortableTableNode,
  normalizePastedTableHTML,
  parseTsvTable,
  sortTableNode,
} from "@docmost/editor-ext";
import { describe, expect, it, vi } from "vitest";

const tableContent = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Name" }],
                },
              ],
            },
            {
              type: "tableHeader",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Score" }],
                },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Beta" }],
                },
              ],
            },
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "10" }] },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Alpha" }],
                },
              ],
            },
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "2" }] },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph" }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    },
  ],
};

const emptyDefaultTableContent = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph" }],
            },
            {
              type: "tableHeader",
              content: [{ type: "paragraph" }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph" }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    },
  ],
};

const malformedLeadingRowsTableContent = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph" }],
            },
            {
              type: "tableHeader",
              content: [{ type: "paragraph" }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph" }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph" }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Name" }],
                },
              ],
            },
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Score" }],
                },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Alpha" }],
                },
              ],
            },
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "2" }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function createEditor(content: unknown, editable = true): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);

  return new Editor({
    element,
    editable,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CustomTable.configure({
        resizable: false,
      }),
      TableRow,
      TableCell,
      TableHeader,
      TablePaste,
      TableReadonlySort,
    ],
    content,
  });
}

function getTableNode(editor: Editor) {
  let table: ProseMirrorNode | null = null;

  editor.state.doc.descendants((node) => {
    if (node.type.name === "table") {
      table = node;
      return false;
    }

    return true;
  });

  if (!table) {
    throw new Error("Expected test editor to contain a table");
  }

  return table;
}

function getDomFirstColumnValues(editor: Editor): string[] {
  return Array.from(editor.view.dom.querySelectorAll("tr"))
    .slice(1)
    .map((row) => row.querySelector("td")?.textContent?.trim() ?? "");
}

function setSelectionInsideFirstParagraph(editor: Editor): void {
  let textSelectionPos: number | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph") {
      textSelectionPos = pos + 1;
      return false;
    }

    return true;
  });

  if (textSelectionPos === null) {
    throw new Error("Expected test document to contain a paragraph");
  }

  editor.commands.setTextSelection(textSelectionPos);
}

function pastePlainText(editor: Editor, text: string): boolean {
  const preventDefault = vi.fn();
  const event = {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
    preventDefault,
  } as unknown as ClipboardEvent;
  let handled = false;

  editor.view.someProp("handlePaste", (handler) => {
    handled = handler(editor.view, event, Slice.empty) === true;
    return handled;
  });

  expect(preventDefault).toHaveBeenCalled();
  return handled;
}

async function flushEditorMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("table widths", () => {
  function createTableNodeWithColumnWidths(
    editor: Editor,
    widths: Array<number | null>,
    widthMode = "normal",
  ): ProseMirrorNode {
    const { schema } = editor;
    const headerCells = widths.map((width, index) =>
      schema.nodes.tableHeader.createChecked(
        width ? { colwidth: [width] } : null,
        [
          schema.nodes.paragraph.createChecked(null, [
            schema.text(`Header ${index + 1}`),
          ]),
        ],
      ),
    );
    const bodyCells = widths.map((width, index) =>
      schema.nodes.tableCell.createChecked(
        width ? { colwidth: [width] } : null,
        [
          schema.nodes.paragraph.createChecked(null, [
            schema.text(`Cell ${index + 1}`),
          ]),
        ],
      ),
    );

    return schema.nodes.table.createChecked({ widthMode }, [
      schema.nodes.tableRow.createChecked(null, headerCells),
      schema.nodes.tableRow.createChecked(null, bodyCells),
    ]);
  }

  it("ignores saved column widths in the table view layout", () => {
    const editor = createEditor("<p></p>");

    try {
      const node = createTableNodeWithColumnWidths(editor, [900, 300]);
      const view = new TableView(node, 49);

      expect(view.dom.querySelectorAll("colgroup > col")).toHaveLength(2);
      expect(view.table.style.tableLayout).toBe("fixed");
      expect(view.table.style.width).toBe("98px");
      expect(view.table.style.minWidth).toBe("98px");
      expect(
        Array.from(
          view.colgroup.children,
          (col) => (col as HTMLElement).style.width,
        ),
      ).toEqual(["49px", "49px"]);
      expect(view.dom.getAttribute("data-block-width-mode")).toBe("normal");
      expect(view.dom.getAttribute("data-table-width-mode")).toBe("normal");
      view.destroy();
    } finally {
      editor.destroy();
    }
  });

  it("keeps table width modes independent from column width hints", () => {
    const editor = createEditor("<p></p>");

    try {
      const node = createTableNodeWithColumnWidths(editor, [900, 300], "full");
      const view = new TableView(node, 49);
      const nextNode = createTableNodeWithColumnWidths(
        editor,
        [120, 480],
        "wide",
      );

      expect(view.dom.getAttribute("data-table-width-mode")).toBe("full");
      expect(view.dom.getAttribute("data-block-width-mode")).toBe("full");
      expect(view.table.getAttribute("data-table-width-mode")).toBe("full");
      expect(view.table.style.width).toBe("98px");
      expect(view.dom.querySelectorAll("colgroup > col")).toHaveLength(2);

      expect(view.update(nextNode)).toBe(true);
      expect(view.dom.getAttribute("data-table-width-mode")).toBe("wide");
      expect(view.dom.getAttribute("data-block-width-mode")).toBe("wide");
      expect(view.table.getAttribute("data-table-width-mode")).toBe("wide");
      expect(view.table.style.width).toBe("98px");
      expect(view.dom.querySelectorAll("colgroup > col")).toHaveLength(2);
      view.destroy();
    } finally {
      editor.destroy();
    }
  });
});

describe("table sorting", () => {
  it("sorts table nodes by content and keeps empty values at the bottom", () => {
    const editor = createEditor(tableContent);

    try {
      const sortedTable = sortTableNode(getTableNode(editor), 0, "asc");

      expect(sortedTable?.child(1).firstChild?.textContent).toBe("Alpha");
      expect(sortedTable?.child(2).firstChild?.textContent).toBe("Beta");
      expect(sortedTable?.child(3).firstChild?.textContent).toBe("");
      expect(isSortableTableNode(getTableNode(editor))).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("sorts numeric text with locale-aware numeric comparison", () => {
    const editor = createEditor(tableContent);

    try {
      const sortedTable = sortTableNode(getTableNode(editor), 1, "asc");

      expect(sortedTable?.child(1).child(1).textContent).toBe("2");
      expect(sortedTable?.child(2).child(1).textContent).toBe("10");
      expect(sortedTable?.child(3).child(1).textContent).toBe("");
    } finally {
      editor.destroy();
    }
  });

  it("defaults existing tables without width mode to wide", () => {
    const editor = createEditor(tableContent);

    try {
      expect(getTableNode(editor).attrs.widthMode).toBe("wide");
    } finally {
      editor.destroy();
    }
  });

  it("rejects tables without a full header row", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Name" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    try {
      expect(isSortableTableNode(getTableNode(editor))).toBe(false);
      expect(sortTableNode(getTableNode(editor), 0, "asc")).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("rejects ambiguous merged cells in the sorted column", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Name" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Score" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 2, rowspan: 1, colwidth: null },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Merged" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    try {
      expect(sortTableNode(getTableNode(editor), 0, "asc")).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("does not add sort controls in editable mode", () => {
    const editor = createEditor(tableContent, true);
    const initialJson = editor.getJSON();

    try {
      expect(
        editor.view.dom.querySelector<HTMLElement>(".tableReadonlySortChevron"),
      ).toBeNull();
      expect(editor.getJSON()).toEqual(initialJson);
    } finally {
      editor.destroy();
    }
  });

  it("does not resolve table DOM positions during ordinary editable updates", () => {
    const editor = createEditor(tableContent, true);
    const posAtDOMSpy = vi.spyOn(editor.view, "posAtDOM");

    try {
      editor.view.dispatch(editor.state.tr.setMeta("test", true));

      expect(posAtDOMSpy).not.toHaveBeenCalled();
    } finally {
      posAtDOMSpy.mockRestore();
      editor.destroy();
    }
  });

  it("sorts only the DOM in readonly mode", () => {
    const editor = createEditor(tableContent, false);
    const initialJson = editor.getJSON();

    try {
      editor.view.dom
        .querySelector<HTMLElement>(".tableReadonlySortChevron")
        ?.click();

      expect(getDomFirstColumnValues(editor)).toEqual(["Alpha", "Beta", ""]);
      expect(editor.getJSON()).toEqual(initialJson);
    } finally {
      editor.destroy();
    }
  });
});

describe("table paste handling", () => {
  it("parses rectangular TSV as a table", () => {
    expect(parseTsvTable("Name\tScore\nAlpha\t2\nBeta\t10")).toEqual([
      ["Name", "Score"],
      ["Alpha", "2"],
      ["Beta", "10"],
    ]);
  });

  it("does not parse ordinary text as a TSV table", () => {
    expect(parseTsvTable("Alpha Beta")).toBeNull();
  });

  it("creates a table with a header row from TSV rows", () => {
    const editor = createEditor("<p></p>");

    try {
      const table = createTableNodeFromRows(editor.schema, [
        ["Name", "Detailed description"],
        ["A", "A much longer value than the first column"],
      ]);

      expect(table.attrs.widthMode).toBe("wide");
      expect(table.child(0).firstChild?.type.name).toBe("tableHeader");
      expect(table.child(1).firstChild?.type.name).toBe("tableCell");
      expect(table.child(0).child(0).attrs.colwidth).toBeNull();
      expect(table.child(0).child(1).attrs.colwidth).toBeNull();
      expect(table.child(1).child(0).attrs.colwidth).toBeNull();
      expect(table.child(1).child(1).attrs.colwidth).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("replaces an empty default table when pasting TSV rows inside it", () => {
    const editor = createEditor(emptyDefaultTableContent);

    try {
      setSelectionInsideFirstParagraph(editor);

      expect(pastePlainText(editor, "Name\tScore\nAlpha\t2")).toBe(true);

      const table = editor.getJSON().content?.[0] as any;
      expect(table.content).toHaveLength(2);
      expect(table.content[0].content[0].content[0].content[0].text).toBe(
        "Name",
      );
      expect(table.content[1].content[0].content[0].content[0].text).toBe(
        "Alpha",
      );
    } finally {
      editor.destroy();
    }
  });

  it("normalizes malformed leading empty rows on load", async () => {
    const editor = createEditor(malformedLeadingRowsTableContent);

    try {
      await flushEditorMicrotasks();

      const table = editor.getJSON().content?.[0] as any;
      expect(table.content).toHaveLength(2);
      expect(table.content[0].content[0].type).toBe("tableHeader");
      expect(table.content[0].content[0].content[0].content[0].text).toBe(
        "Name",
      );
      expect(table.content[1].content[0].content[0].content[0].text).toBe(
        "Alpha",
      );
    } finally {
      editor.destroy();
    }
  });

  it("removes explicit column widths from pasted HTML tables", () => {
    const html = normalizePastedTableHTML(
      '<table width="900" style="width: 900px"><colgroup><col width="120"><col style="width: 240px"></colgroup><tr><th width="120">Name</th><th style="width: 240px; min-width: 200px">Score</th></tr><tr><td colwidth="120">Alpha</td><td colwidth="240" style="max-width: 300px">2</td></tr></table>',
    );

    expect(html).toContain('data-table-width-mode="wide"');
    expect(html).not.toContain("<colgroup");
    expect(html).not.toContain("colwidth");
    expect(html).not.toContain('width="120"');
    expect(html).not.toContain('width="900"');
    expect(html).not.toContain("width: 240px");
    expect(html).not.toContain("width: 900px");
    expect(html).not.toContain("min-width");
    expect(html).not.toContain("max-width");
  });

  it("does not add generated column widths to pasted HTML tables", () => {
    const html = normalizePastedTableHTML(
      "<table><tr><th>ID</th><th>Detailed description</th></tr><tr><td>1</td><td>A much longer value than the first column</td></tr></table>",
    );

    expect(html).toContain('data-table-width-mode="wide"');
    expect(html).not.toContain("colwidth");
  });
});
