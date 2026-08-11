import { describe, expect, it } from "vitest";
import { getCommentActionPermissions } from "./comment-permissions";

describe("getCommentActionPermissions", () => {
  it("hides owner mutations when the page is read-only", () => {
    expect(
      getCommentActionPermissions({
        isOwner: true,
        isAdmin: false,
        canComment: false,
        canResolve: false,
        isReply: false,
      }),
    ).toEqual({ canEdit: false, canDelete: false, canResolve: false });
  });

  it("allows an admin to delete only while the page is writable", () => {
    expect(
      getCommentActionPermissions({
        isOwner: false,
        isAdmin: true,
        canComment: true,
        canResolve: true,
        isReply: false,
      }),
    ).toEqual({ canEdit: false, canDelete: true, canResolve: true });
  });

  it("never exposes resolve for a reply", () => {
    expect(
      getCommentActionPermissions({
        isOwner: true,
        isAdmin: true,
        canComment: true,
        canResolve: true,
        isReply: true,
      }).canResolve,
    ).toBe(false);
  });
});
