import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { shouldPublishTreeApi } from "./tree-api-ref.ts";

describe("shouldPublishTreeApi", () => {
  it("ignores transient null and repeated publication of the same API", () => {
    const treeApi = {};

    assert.equal(shouldPublishTreeApi(null, treeApi), true);
    assert.equal(shouldPublishTreeApi(treeApi, null), false);
    assert.equal(shouldPublishTreeApi(treeApi, treeApi), false);
  });

  it("publishes a replacement API after the tree remounts", () => {
    const currentTreeApi = {};
    const nextTreeApi = {};

    assert.equal(
      shouldPublishTreeApi(currentTreeApi, nextTreeApi),
      true,
    );
  });
});
