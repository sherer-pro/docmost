import { describe, expect, it } from "vitest";
import { getUserColor, userColors } from "./utils";

describe("getUserColor", () => {
  it("returns a stable palette color for the same user", () => {
    const first = getUserColor("user-123");

    expect(getUserColor("user-123")).toBe(first);
    expect(userColors).toContain(first);
  });

  it("distributes different identifiers across the palette", () => {
    const colors = new Set(
      Array.from({ length: 20 }, (_, index) => getUserColor(`user-${index}`)),
    );

    expect(colors.size).toBeGreaterThan(1);
  });
});
