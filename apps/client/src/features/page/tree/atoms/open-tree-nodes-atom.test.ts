import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  getOpenTreeNodesForSpace,
  isOpenStateEqual,
  normalizeOpenTreeNodesBySpace,
  updateOpenTreeNodesForSpace,
} from "./open-tree-nodes-atom";

describe("sidebar tree open state", () => {
  it("keeps expansion state isolated by space", () => {
    const firstState = updateOpenTreeNodesForSpace({}, "space-1", {
      page1: true,
    });
    const nextState = updateOpenTreeNodesForSpace(firstState, "space-2", {
      page2: true,
    });

    assert.deepEqual(getOpenTreeNodesForSpace(nextState, "space-1"), {
      page1: true,
    });
    assert.deepEqual(getOpenTreeNodesForSpace(nextState, "space-2"), {
      page2: true,
    });
  });

  it("treats invalid persisted values as an empty state", () => {
    assert.deepEqual(normalizeOpenTreeNodesBySpace("invalid"), {});
    assert.deepEqual(normalizeOpenTreeNodesBySpace(["invalid"]), {});
    assert.deepEqual(
      normalizeOpenTreeNodesBySpace({
        "space-1": { page1: true, page2: "invalid" },
        "space-2": null,
      }),
      { "space-1": { page1: true } },
    );
  });

  it("compares complete open maps without depending on object identity", () => {
    assert.equal(isOpenStateEqual({ page1: true }, { page1: true }), true);
    assert.equal(isOpenStateEqual({ page1: true }, { page1: false }), false);
    assert.equal(
      isOpenStateEqual({ page1: true }, { page1: true, page2: true }),
      false,
    );
  });
});
