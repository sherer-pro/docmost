import { describe, expect, it } from "vitest";
import {
  isInlineOrLegacyComment,
  isPageLevelComment,
} from "./comment-type-filter";

const baseComment = {
  id: "comment-1",
  content: "{}",
  creatorId: "user-1",
  pageId: "page-1",
  workspaceId: "workspace-1",
  createdAt: new Date(),
  creator: {
    id: "user-1",
    name: "User",
    avatarUrl: null,
  },
} as any;

describe("comment-type-filter", () => {
  it("treats type=page as page-level comment", () => {
    expect(isPageLevelComment({ ...baseComment, type: "page" })).toBe(true);
    expect(isInlineOrLegacyComment({ ...baseComment, type: "page" })).toBe(
      false,
    );
  });

  it("treats type=inline as inline comment", () => {
    expect(isPageLevelComment({ ...baseComment, type: "inline" })).toBe(false);
    expect(isInlineOrLegacyComment({ ...baseComment, type: "inline" })).toBe(
      true,
    );
  });

  it("treats legacy null type as inline comment", () => {
    expect(isPageLevelComment({ ...baseComment, type: null })).toBe(false);
    expect(isInlineOrLegacyComment({ ...baseComment, type: null })).toBe(true);
  });
});
