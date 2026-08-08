import { describe, expect, it } from "vitest";
import { isSupportedAiChatFileName } from "./ai-files";

describe("AI chat file validation", () => {
  it.each([
    "document.pdf",
    "document.DOCX",
    "notes.txt",
    "notes.md",
    "image.jpg",
    "image.jpeg",
    "image.png",
    "image.webp",
  ])("accepts supported extension %s", (fileName) => {
    expect(isSupportedAiChatFileName(fileName)).toBe(true);
  });

  it.each(["unsupported.exe", "image.svg", "document", ".bashrc"])(
    "rejects unsupported extension %s",
    (fileName) => {
      expect(isSupportedAiChatFileName(fileName)).toBe(false);
    },
  );
});
