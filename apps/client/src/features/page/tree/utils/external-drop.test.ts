import { describe, expect, it } from "vitest";
import {
  createTreeExternalDropResult,
  isTreeExternalDropResult,
} from "./external-drop.ts";

describe("external tree drop results", () => {
  it("marks external targets without matching regular tree drop results", () => {
    expect(
      isTreeExternalDropResult(createTreeExternalDropResult("ai-context")),
    ).toBe(true);
    expect(isTreeExternalDropResult({ parentId: "page", index: 2 })).toBe(
      false,
    );
    expect(isTreeExternalDropResult(undefined)).toBe(false);
  });
});
