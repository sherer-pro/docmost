// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import {
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
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
} from "@docmost/editor-ext";
import { describe, expect, it } from "vitest";

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
              content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
            },
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Score" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Beta" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "10" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }],
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

function getFirstColumnValues(editor: Editor): string[] {
  const table = editor.getJSON().content?.[0] as any;
  const rows = table?.content?.slice(1) ?? [];

  return rows.map((row) => {
    const paragraph = row.content?.[0]?.content?.[0];

    return paragraph?.content?.[0]?.text ?? "";
  });
}

function getDomFirstColumnValues(editor: Editor): string[] {
  return Array.from(editor.view.dom.querySelectorAll("tr"))
    .slice(1)
    .map((row) => row.querySelector("td")?.textContent?.trim() ?? "");
}

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
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
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
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
                },
                {
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Score" }] }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 2, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Merged" }] }],
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

  it("changes the document order in editable mode", () => {
    const editor = createEditor(tableContent, true);

    try {
      editor.view.dom
        .querySelector<HTMLElement>(".tableReadonlySortChevron")
        ?.click();

      expect(getFirstColumnValues(editor)).toEqual(["Alpha", "Beta", ""]);
    } finally {
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
        ["Name", "Score"],
        ["Alpha", "2"],
      ]);

      expect(table.attrs.widthMode).toBe("normal");
      expect(table.child(0).firstChild?.type.name).toBe("tableHeader");
      expect(table.child(1).firstChild?.type.name).toBe("tableCell");
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
});
