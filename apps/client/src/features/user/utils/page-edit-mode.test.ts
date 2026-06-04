import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import {
  buildPageEditModeByPageId,
  normalizePageEditMode,
  normalizePageEditModeByPageId,
  resolvePageEditMode,
} from "./page-edit-mode";

const PAGE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_PAGE_ID = "00000000-0000-4000-8000-000000000002";

describe("page edit mode preferences", () => {
  it("falls back to read mode when page override is missing", () => {
    assert.equal(
      resolvePageEditMode({
        pageId: PAGE_ID,
        preferences: {
          pageEditModeByPageId: { [OTHER_PAGE_ID]: PageEditMode.Edit },
        },
      }),
      PageEditMode.Read,
    );
  });

  it("uses page override when it exists", () => {
    assert.equal(
      resolvePageEditMode({
        pageId: PAGE_ID,
        preferences: {
          pageEditModeByPageId: { [PAGE_ID]: PageEditMode.Edit },
        },
      }),
      PageEditMode.Edit,
    );
  });

  it("normalizes serialized maps and drops invalid keys or values", () => {
    assert.deepEqual(
      normalizePageEditModeByPageId(
        JSON.stringify({
          [PAGE_ID]: '"read"',
          [OTHER_PAGE_ID]: "EDIT",
          "not-a-uuid": "edit",
          "00000000-0000-4000-8000-000000000003": "invalid",
        }),
      ),
      {
        [PAGE_ID]: PageEditMode.Read,
        [OTHER_PAGE_ID]: PageEditMode.Edit,
      },
    );
  });

  it("builds the next page-scoped update payload", () => {
    assert.deepEqual(
      buildPageEditModeByPageId(
        { [OTHER_PAGE_ID]: PageEditMode.Read },
        PAGE_ID,
        PageEditMode.Edit,
      ),
      {
        [OTHER_PAGE_ID]: PageEditMode.Read,
        [PAGE_ID]: PageEditMode.Edit,
      },
    );
  });

  it("normalizes standalone values to read by default", () => {
    assert.equal(normalizePageEditMode("edit"), PageEditMode.Edit);
    assert.equal(normalizePageEditMode("invalid"), PageEditMode.Read);
    assert.equal(normalizePageEditMode(null), PageEditMode.Read);
  });
});
