import { describe, expect, it } from "vitest";
import {
  getDiagramAttachmentIdForSave,
  getDiagramAttachmentSrc,
  getDiagramSaveErrorMessage,
  shouldCreateNewDiagramAttachment,
} from "./diagram-attachment";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

function documentWithAttachmentIds(
  ...attachmentIds: string[]
): ProseMirrorNode {
  return {
    descendants: (callback: (node: ProseMirrorNode) => void) => {
      for (const attachmentId of attachmentIds) {
        callback({ attrs: { attachmentId } } as unknown as ProseMirrorNode);
      }
    },
  } as ProseMirrorNode;
}

describe("diagram attachment helpers", () => {
  it("builds canonical attachment file URLs for saved diagrams", () => {
    expect(
      getDiagramAttachmentSrc({
        id: "attachment-id",
        fileName: "diagram.drawio.svg",
        updatedAt: "2026-06-18T12:53:32.992Z",
      } as any),
    ).toBe(
      "/api/attachments/files/attachment-id/diagram.drawio.svg?t=1781787212992",
    );
  });

  it("updates an attachment that has a single document reference", () => {
    expect(
      getDiagramAttachmentIdForSave(
        documentWithAttachmentIds("attachment-id"),
        "attachment-id",
      ),
    ).toBe("attachment-id");
  });

  it("creates a new attachment when a copied diagram shares the source", () => {
    expect(
      getDiagramAttachmentIdForSave(
        documentWithAttachmentIds("attachment-id", "attachment-id"),
        "attachment-id",
      ),
    ).toBeUndefined();
  });

  it("creates a new attachment for an unsaved diagram", () => {
    expect(
      getDiagramAttachmentIdForSave(documentWithAttachmentIds(), undefined),
    ).toBeUndefined();
  });

  it.each([
    [403, "File attachment does not match"],
    [404, "Existing attachment to overwrite not found"],
  ])(
    "retries as a new attachment for server conflict %s",
    (status, message) => {
      expect(
        shouldCreateNewDiagramAttachment({
          response: { status, data: { message } },
        }),
      ).toBe(true);
    },
  );

  it("does not hide unrelated upload failures", () => {
    expect(
      shouldCreateNewDiagramAttachment({
        response: {
          status: 403,
          data: { message: "Insufficient permissions" },
        },
      }),
    ).toBe(false);
    expect(shouldCreateNewDiagramAttachment(new Error("network"))).toBe(false);
  });

  it("prefers server upload errors when available", () => {
    expect(
      getDiagramSaveErrorMessage(
        { response: { data: { message: "Error processing file upload." } } },
        (key) => key,
      ),
    ).toBe("Error processing file upload.");
  });

  it("falls back to a translated generic error", () => {
    expect(getDiagramSaveErrorMessage(new Error("network"), (key) => key)).toBe(
      "Failed to update data",
    );
  });
});
