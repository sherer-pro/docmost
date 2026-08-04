import { describe, expect, it } from "vitest";
import {
  getSpaceReturnTo,
  getTargetedLoginUrl,
  sanitizeRelativeReturnTo,
} from "./return-to";

describe("return-to utilities", () => {
  it.each([
    [undefined, "/home"],
    ["https://evil.example", "/home"],
    ["//evil.example", "/home"],
    ["/\\evil.example", "/home"],
    ["/%5c%5cevil.example", "/home"],
    ["/%2f%2fevil.example", "/home"],
    ["/home%0d%0aLocation:evil", "/home"],
    ["/%", "/home"],
    ["/s/engineering?page=1", "/s/engineering?page=1"],
  ])("sanitizes %s", (value, expected) => {
    expect(sanitizeRelativeReturnTo(value)).toBe(expected);
  });

  it("builds a targeted post-reset login URL with an encoded return path", () => {
    expect(getSpaceReturnTo("product docs")).toBe("/s/product%20docs");
    expect(getTargetedLoginUrl("product docs")).toBe(
      "/login?spaceSlug=product+docs&returnTo=%2Fs%2Fproduct%2520docs",
    );
  });
});
