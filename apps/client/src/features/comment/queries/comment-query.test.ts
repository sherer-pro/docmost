import { describe, expect, it, vi } from "vitest";
import { COMMENT_LIMIT } from "@/features/comment/comment.constants";
import { getCreateCommentErrorMessage } from "@/features/comment/queries/comment-query";

describe("getCreateCommentErrorMessage", () => {
  it("returns the comment limit message for 409 responses", () => {
    const t = vi.fn((key: string, options?: { limit: number }) =>
      options ? `${key}:${options.limit}` : key,
    );

    const message = getCreateCommentErrorMessage(
      {
        response: {
          status: 409,
        },
      } as unknown as Error,
      t,
    );

    expect(message).toBe(
      `This page has reached the limit of {{limit}} comments.:${COMMENT_LIMIT}`,
    );
    expect(t).toHaveBeenCalledWith(
      "This page has reached the limit of {{limit}} comments.",
      { limit: COMMENT_LIMIT },
    );
  });

  it("returns the generic create error for non-limit responses", () => {
    const t = vi.fn((key: string) => key);

    expect(getCreateCommentErrorMessage(new Error("failed"), t)).toBe(
      "Error creating comment",
    );
  });
});
