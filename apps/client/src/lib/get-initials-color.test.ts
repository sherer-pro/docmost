import { describe, expect, it } from "vitest";
import { defaultInitialsColors, getInitialsColor } from "./get-initials-color";

describe("getInitialsColor", () => {
  it("returns stable colors from the contrast-safe initials palette", () => {
    const color = getInitialsColor("Docmost Workspace");

    expect(defaultInitialsColors).toContain(color);
    expect(getInitialsColor("Docmost Workspace")).toBe(color);
  });

  it("does not use low-contrast bright avatar colors by default", () => {
    expect(defaultInitialsColors).not.toContain("lime");
    expect(defaultInitialsColors).not.toContain("orange");
    expect(defaultInitialsColors).not.toContain("yellow");
  });
});
