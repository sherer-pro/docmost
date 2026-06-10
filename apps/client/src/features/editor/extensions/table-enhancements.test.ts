// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import {
  CustomTable,
  TablePaste,
  TableReadonlySort,
  createTableNodeFromRows,
  isSortableTableNode,
  normalizePastedTableHTML,
  parseTsvTable,
  sortTableNode,
  updateColumns,
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

  it("keeps normal table width constrained to the content area", () => {
    const editor = createEditor("<p></p>");

    try {
      const node = createTableNodeWithColumnWidths(editor, [900, 300]);
      const colgroup = document.createElement("colgroup");
      const table = document.createElement("table");

      updateColumns(node, colgroup, table, 49);

      const columns = colgroup.querySelectorAll("col");
      expect(table.style.width).toBe("100%");
      expect(table.style.minWidth).toBe("");
      expect(columns[0].style.minWidth).toBe("");
      expect(columns[1].style.minWidth).toBe("");
      expect(parseFloat(columns[0].style.width)).toBeCloseTo(75);
      expect(parseFloat(columns[1].style.width)).toBeCloseTo(25);
    } finally {
      editor.destroy();
    }
  });

  it("does not add fixed equal column widths for normal tables without hints", () => {
    const editor = createEditor("<p></p>");

    try {
      const node = createTableNodeWithColumnWidths(editor, [null, null]);
      const colgroup = document.createElement("colgroup");
      const table = document.createElement("table");

      updateColumns(node, colgroup, table, 49);

      const columns = colgroup.querySelectorAll("col");
      expect(table.style.width).toBe("100%");
      expect(table.style.minWidth).toBe("");
      expect(columns[0].style.width).toBe("");
      expect(columns[1].style.width).toBe("");
      expect(columns[0].style.minWidth).toBe("49px");
      expect(columns[1].style.minWidth).toBe("49px");
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

  it("defaults existing tables without width mode to normal", () => {
    const editor = createEditor(tableContent);

    try {
      expect(getTableNode(editor).attrs.widthMode).toBe("normal");
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

      expect(table.attrs.widthMode).toBe("normal");
      expect(table.child(0).firstChild?.type.name).toBe("tableHeader");
      expect(table.child(1).firstChild?.type.name).toBe("tableCell");
      expect(table.child(0).child(1).attrs.colwidth[0]).toBeGreaterThan(
        table.child(0).child(0).attrs.colwidth[0],
      );
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

  it("normalizes pasted HTML table widths into colwidth attributes", () => {
    const html = normalizePastedTableHTML(
      '<table><colgroup><col width="120"><col style="width: 240px"></colgroup><tr><th>Name</th><th>Score</th></tr><tr><td>Alpha</td><td>2</td></tr></table>',
    );

    expect(html).toContain('data-table-width-mode="normal"');
    expect(html).toContain('colwidth="120"');
    expect(html).toContain('colwidth="240"');
  });

  it("adds content-aware widths to pasted HTML tables without explicit widths", () => {
    const html = normalizePastedTableHTML(
      '<table><tr><th>ID</th><th>Detailed description</th></tr><tr><td>1</td><td>A much longer value than the first column</td></tr></table>',
    );
    const widths = Array.from(html.matchAll(/colwidth="(\d+)"/g)).map(
      (match) => Number(match[1]),
    );

    expect(html).toContain('data-table-width-mode="normal"');
    expect(widths.length).toBeGreaterThanOrEqual(4);
    expect(widths[1]).toBeGreaterThan(widths[0]);
  });
});
