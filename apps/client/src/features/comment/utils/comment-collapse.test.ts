import { describe, expect, it } from "vitest";
import {
  COMMENT_BODY_COLLAPSE_LINES,
  COMMENT_THREAD_COLLAPSE_REPLY_COUNT,
  countCommentThreadReplies,
  isCommentInThread,
  shouldCollapseCommentBodyLineCount,
  shouldCollapseCommentThread,
  shouldRevealResolvedComments,
} from "./comment-collapse";

const comments = [
  { id: "root-1", parentCommentId: null },
  { id: "reply-1", parentCommentId: "root-1" },
  { id: "reply-2", parentCommentId: "root-1" },
  { id: "nested-reply-1", parentCommentId: "reply-2" },
  { id: "root-2", parentCommentId: null },
  { id: "reply-3", parentCommentId: "root-2" },
] as any[];

describe("comment collapse helpers", () => {
  it("counts nested replies in a comment thread", () => {
    expect(countCommentThreadReplies(comments, "root-1")).toBe(3);
    expect(countCommentThreadReplies(comments, "root-2")).toBe(1);
  });

  it("collapses comment bodies only after the line threshold", () => {
    expect(
      shouldCollapseCommentBodyLineCount(COMMENT_BODY_COLLAPSE_LINES),
    ).toBe(false);
    expect(
      shouldCollapseCommentBodyLineCount(COMMENT_BODY_COLLAPSE_LINES + 1),
    ).toBe(true);
  });

  it("collapses comment threads only after the reply threshold", () => {
    expect(
      shouldCollapseCommentThread(COMMENT_THREAD_COLLAPSE_REPLY_COUNT),
    ).toBe(false);
    expect(
      shouldCollapseCommentThread(COMMENT_THREAD_COLLAPSE_REPLY_COUNT + 1),
    ).toBe(true);
  });

  it("detects whether a comment belongs to a root thread", () => {
    expect(isCommentInThread(comments, "root-1", "root-1")).toBe(true);
    expect(isCommentInThread(comments, "root-1", "nested-reply-1")).toBe(true);
    expect(isCommentInThread(comments, "root-1", "reply-3")).toBe(false);
    expect(isCommentInThread(comments, "root-1", null)).toBe(false);
  });

  it("reveals resolved threads when a nested reply is active", () => {
    expect(
      shouldRevealResolvedComments(
        comments,
        [{ id: "root-1", parentCommentId: null }],
        "nested-reply-1",
      ),
    ).toBe(true);
    expect(
      shouldRevealResolvedComments(
        comments,
        [{ id: "root-2", parentCommentId: null }],
        "nested-reply-1",
      ),
    ).toBe(false);
  });
});
