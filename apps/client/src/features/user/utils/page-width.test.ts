import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  normalizeFullPageWidthByPageId,
  resolvePageFullWidth,
} from "./page-width";

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

  it("supports serialized map from persisted settings", () => {
    assert.equal(
      resolvePageFullWidth({
        pageId: "page-1",
        preferences: {
          fullPageWidth: false,
          fullPageWidthByPageId: JSON.stringify({ "page-1": true }),
        },
      }),
      true,
    );
  });
});

describe("normalizeFullPageWidthByPageId", () => {
  it("filters malformed character maps and keeps only boolean values", () => {
    assert.deepEqual(
      normalizeFullPageWidthByPageId({
        "0": "{",
        "1": "\"",
        "2": "p",
        "3": "a",
        "4": "g",
        "5": "e",
        "6": "\"",
        page: true,
      }),
      { page: true },
    );
  });

  it("returns empty map for invalid serialized payload", () => {
    assert.deepEqual(normalizeFullPageWidthByPageId("{broken-json"), {});
  });
});
