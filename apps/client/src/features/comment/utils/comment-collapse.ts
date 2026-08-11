import { IComment } from "@/features/comment/types/comment.types";

export const COMMENT_BODY_COLLAPSE_LINES = 6;
export const COMMENT_THREAD_COLLAPSE_REPLY_COUNT = 3;

export function shouldCollapseCommentBodyLineCount(lineCount: number): boolean {
  return lineCount > COMMENT_BODY_COLLAPSE_LINES;
}

export function shouldCollapseCommentThread(replyCount: number): boolean {
  return replyCount > COMMENT_THREAD_COLLAPSE_REPLY_COUNT;
}

export function countCommentThreadReplies(
  comments: Pick<IComment, "id" | "parentCommentId">[],
  parentId: string,
): number {
  const childrenByParentId = createChildrenByParentId(comments);

  return countNestedReplies(childrenByParentId, parentId);
}

export function isCommentInThread(
  comments: Pick<IComment, "id" | "parentCommentId">[],
  parentId: string,
  commentId: string | null | undefined,
): boolean {
  if (!commentId) {
    return false;
  }

  if (parentId === commentId) {
    return true;
  }

  const childrenByParentId = createChildrenByParentId(comments);

  return hasNestedComment(childrenByParentId, parentId, commentId);
}

export function shouldRevealResolvedComments(
  comments: Pick<IComment, "id" | "parentCommentId">[],
  resolvedRootComments: Pick<IComment, "id" | "parentCommentId">[],
  activeCommentId?: string | null,
): boolean {
  return resolvedRootComments.some((comment) =>
    isCommentInThread(comments, comment.id, activeCommentId),
  );
}

function createChildrenByParentId(
  comments: Pick<IComment, "id" | "parentCommentId">[],
) {
  const childrenByParentId = new Map<string, string[]>();

  for (const comment of comments) {
    if (!comment.parentCommentId) {
      continue;
    }

    const existingChildren = childrenByParentId.get(comment.parentCommentId);
    if (existingChildren) {
      existingChildren.push(comment.id);
      continue;
    }

    childrenByParentId.set(comment.parentCommentId, [comment.id]);
  }

  return childrenByParentId;
}

function countNestedReplies(
  childrenByParentId: Map<string, string[]>,
  parentId: string,
): number {
  const children = childrenByParentId.get(parentId) ?? [];
  let count = children.length;

  for (const childId of children) {
    count += countNestedReplies(childrenByParentId, childId);
  }

  return count;
}

function hasNestedComment(
  childrenByParentId: Map<string, string[]>,
  parentId: string,
  commentId: string,
): boolean {
  const children = childrenByParentId.get(parentId) ?? [];

  for (const childId of children) {
    if (
      childId === commentId ||
      hasNestedComment(childrenByParentId, childId, commentId)
    ) {
      return true;
    }
  }

  return false;
}
