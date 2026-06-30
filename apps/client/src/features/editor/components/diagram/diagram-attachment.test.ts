import { describe, expect, it } from "vitest";
import {
  getDiagramAttachmentSrc,
  getDiagramSaveErrorMessage,
} from "./diagram-attachment";

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
