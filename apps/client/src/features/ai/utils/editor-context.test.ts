import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  collectAiPageAttachments,
  hashEditorDocument,
} from "./editor-context.ts";

describe("AI editor context", () => {
  it("produces a stable hash for the same document", () => {
    const document = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
    };

    assert.equal(hashEditorDocument(document), hashEditorDocument(document));
  });

  it("changes the hash when document content changes", () => {
    assert.notEqual(
      hashEditorDocument({ type: "doc", content: ["A"] }),
      hashEditorDocument({ type: "doc", content: ["B"] }),
    );
  });

  it("collects and deduplicates page attachment references", () => {
    assert.deepEqual(
      collectAiPageAttachments({
        type: "doc",
        content: [
          {
            type: "attachment",
            attrs: { attachmentId: "file-1", fileName: "guide.pdf" },
          },
          {
            type: "image",
            attrs: { attachmentId: "file-1", alt: "Duplicate" },
          },
        ],
      }),
      [{ id: "file-1", name: "Duplicate" }],
    );
  });
});
