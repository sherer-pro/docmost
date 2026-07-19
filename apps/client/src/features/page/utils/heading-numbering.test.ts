import { describe, expect, it } from "vitest";
import { resolveHeadingNumberingEnabled } from "./heading-numbering";
import { normalizeHeadingNumberingByPageId } from "@/features/user/utils/heading-numbering";

describe("heading numbering settings", () => {
  it("defaults to disabled and inherits the space setting", () => {
    expect(resolveHeadingNumberingEnabled({})).toBe(false);
    expect(
      resolveHeadingNumberingEnabled({
        pageId: "page-1",
        spaceSettings: { headingNumbering: { enabled: true } },
      }),
    ).toBe(true);
  });

  it("uses personal page overrides in both directions", () => {
    expect(
      resolveHeadingNumberingEnabled({
        pageId: "page-1",
        preferences: { headingNumberingByPageId: { "page-1": false } },
        spaceSettings: { headingNumbering: { enabled: true } },
      }),
    ).toBe(false);
    expect(
      resolveHeadingNumberingEnabled({
        pageId: "page-1",
        preferences: { headingNumberingByPageId: { "page-1": true } },
        spaceSettings: { headingNumbering: { enabled: false } },
      }),
    ).toBe(true);
  });

  it("keeps overrides independent between pages", () => {
    expect(
      resolveHeadingNumberingEnabled({
        pageId: "page-2",
        preferences: { headingNumberingByPageId: { "page-1": false } },
        spaceSettings: { headingNumbering: { enabled: true } },
      }),
    ).toBe(true);
  });

  it("normalizes serialized and malformed preference maps", () => {
    expect(
      normalizeHeadingNumberingByPageId(
        JSON.stringify({ "page-1": true, "page-2": "false" }),
      ),
    ).toEqual({ "page-1": true });
    expect(normalizeHeadingNumberingByPageId("{broken-json")).toEqual({});
  });
});
