import { Schema } from "@tiptap/pm/model";
import { describe, expect, it, vi } from "vitest";

vi.mock("../recreate-transform", () => ({
  recreateTransform: () => {
    throw new Error("pathological transform");
  },
}));

import { diffProseMirrorDocuments } from "./document-diff";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function document(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

describe("document diff fallback", () => {
  it("returns bounded semantic changes when the structural transform fails", () => {
    const result = diffProseMirrorDocuments(
      document("Old paragraph"),
      document("New paragraph"),
    );

    expect(result.precise).toBe(false);
    expect(result.changes).toEqual([
      { op: "delete", text: "Old paragraph", block: "Old paragraph" },
      { op: "insert", text: "New paragraph", block: "New paragraph" },
    ]);
    expect(result.summary).toEqual({
      inserted: 13,
      deleted: 13,
      blocksChanged: 2,
    });
  });
});
