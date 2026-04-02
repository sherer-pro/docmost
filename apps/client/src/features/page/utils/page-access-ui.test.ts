import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  canOpenPageAccessModal,
  stopPageAccessModalEvent,
  supportsPageAccessEntity,
} from "./page-access-ui";

describe("supportsPageAccessEntity", () => {
  it("returns true for page-like entities", () => {
    assert.equal(supportsPageAccessEntity("page"), true);
    assert.equal(supportsPageAccessEntity("database"), true);
    assert.equal(supportsPageAccessEntity("databaseRow"), true);
  });

  it("returns false for nullish values", () => {
    assert.equal(supportsPageAccessEntity(undefined), false);
    assert.equal(supportsPageAccessEntity(null), false);
  });
});

describe("canOpenPageAccessModal", () => {
  it("requires both page id and manage permission", () => {
    assert.equal(
      canOpenPageAccessModal({ pageId: "page-1", canManageAccess: true }),
      true,
    );
    assert.equal(
      canOpenPageAccessModal({ pageId: "page-1", canManageAccess: false }),
      false,
    );
    assert.equal(
      canOpenPageAccessModal({ pageId: undefined, canManageAccess: true }),
      false,
    );
  });
});

describe("stopPageAccessModalEvent", () => {
  it("stops bubbling to parent handlers", () => {
    const stopPropagation = vi.fn();
    stopPageAccessModalEvent({ stopPropagation });
    assert.equal(stopPropagation.mock.calls.length, 1);
  });
});
