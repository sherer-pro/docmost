import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolvePageFullWidth } from "./page-width";

describe("resolvePageFullWidth", () => {
  it("uses page override when it exists", () => {
    assert.equal(
      resolvePageFullWidth({
        pageId: "page-1",
        preferences: {
          fullPageWidth: false,
          fullPageWidthByPageId: { "page-1": true },
        },
      }),
      true,
    );
  });

  it("falls back to global user preference when page override is missing", () => {
    assert.equal(
      resolvePageFullWidth({
        pageId: "page-1",
        preferences: {
          fullPageWidth: true,
          fullPageWidthByPageId: { "page-2": false },
        },
      }),
      true,
    );
  });

  it("falls back to false when no preferences are available", () => {
    assert.equal(resolvePageFullWidth({ pageId: "page-1" }), false);
  });
});
