import { memo, useCallback, useRef, useState } from "react";
import { Button, Divider, Paper } from "@mantine/core";
import { useFocusWithin } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import CommentActions from "./comment-actions";
import CommentEditor from "./comment-editor";
import CommentListItem from "./comment-list-item";
import { IComment } from "../types/comment.types";
import { IPagination } from "@/lib/types";
import {
  countCommentThreadReplies,
  isCommentInThread,
  shouldCollapseCommentThread,
} from "../utils/comment-collapse";

interface CommentThreadListProps {
  comments: IPagination<IComment>;
  rootComments: IComment[];
  pageId: string;
  canComment: boolean;
  canResolve: boolean;
  userSpaceRole?: string;
  activeCommentId?: string | null;
  isReplyLoading: boolean;
  includesComment: (comment: IComment) => boolean;
  onReply: (commentId: string, content: string) => void | Promise<void>;
}

export function CommentThreadList({
  comments,
  rootComments,
  pageId,
  canComment,
  canResolve,
  userSpaceRole,
  activeCommentId,
  isReplyLoading,
  includesComment,
  onReply,
}: CommentThreadListProps) {
  const { t } = useTranslation();
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleThread = useCallback((commentId: string) => {
    setExpandedThreadIds((currentThreadIds) => {
      const nextThreadIds = new Set(currentThreadIds);
      if (nextThreadIds.has(commentId)) {
        nextThreadIds.delete(commentId);
      } else {
        nextThreadIds.add(commentId);
      }
      return nextThreadIds;
    });
  }, []);

  return (
    <>
      {rootComments.map((comment) => {
        const replyCount = countCommentThreadReplies(
          comments.items,
          comment.id,
        );
        const isActiveThread = isCommentInThread(
          comments.items,
          comment.id,
          activeCommentId,
        );
        const isThreadCollapsed =
          shouldCollapseCommentThread(replyCount) &&
          !expandedThreadIds.has(comment.id) &&
          !isActiveThread;
        const hasCollapsibleReplies = shouldCollapseCommentThread(replyCount);
        const repliesId = `comment-thread-${comment.id}-replies`;

        return (
          <Paper
            shadow="sm"
            radius="md"
            p="sm"
            mb="sm"
            withBorder
            key={comment.id}
            data-comment-id={comment.id}
          >
            <div>
              <CommentListItem
                comment={comment}
                pageId={pageId}
                canComment={canComment}
                canResolve={canResolve}
                userSpaceRole={userSpaceRole}
              />

              <div id={repliesId} hidden={isThreadCollapsed}>
                {!isThreadCollapsed && (
                  <MemoizedChildComments
                    comments={comments}
                    parentId={comment.id}
                    pageId={pageId}
                    canComment={canComment}
                    canResolve={canResolve}
                    userSpaceRole={userSpaceRole}
                    includesComment={includesComment}
                  />
                )}
              </div>
            </div>

            {hasCollapsibleReplies && !isActiveThread && (
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                px={0}
                aria-controls={repliesId}
                aria-expanded={!isThreadCollapsed}
                onClick={() => toggleThread(comment.id)}
              >
                {isThreadCollapsed ? t("More") : t("Collapse")}
              </Button>
            )}

            {!comment.resolvedAt && canComment && !isThreadCollapsed && (
              <>
                <Divider my={4} />
                <CommentReplyEditor
                  commentId={comment.id}
                  onSave={onReply}
                  isLoading={isReplyLoading}
                />
              </>
            )}
          </Paper>
        );
      })}
    </>
  );
}

interface ChildCommentsProps {
  comments: IPagination<IComment>;
  parentId: string;
  pageId: string;
  canComment: boolean;
  canResolve: boolean;
  userSpaceRole?: string;
  includesComment: (comment: IComment) => boolean;
}

const ChildComments = ({
  comments,
  parentId,
  pageId,
  canComment,
  canResolve,
  userSpaceRole,
  includesComment,
}: ChildCommentsProps) => {
  const childComments = comments.items.filter(
    (comment) =>
      comment.parentCommentId === parentId && includesComment(comment),
  );

  return (
    <div>
      {childComments.map((childComment) => (
        <div key={childComment.id}>
          <CommentListItem
            comment={childComment}
            pageId={pageId}
            canComment={canComment}
            canResolve={canResolve}
            userSpaceRole={userSpaceRole}
          />
          <MemoizedChildComments
            comments={comments}
            parentId={childComment.id}
            pageId={pageId}
            canComment={canComment}
            canResolve={canResolve}
            userSpaceRole={userSpaceRole}
            includesComment={includesComment}
          />
        </div>
      ))}
    </div>
  );
};

const MemoizedChildComments = memo(ChildComments);

interface CommentReplyEditorProps {
  commentId: string;
  onSave: (commentId: string, content: string) => void | Promise<void>;
  isLoading: boolean;
}

function CommentReplyEditor({
  commentId,
  onSave,
  isLoading,
}: CommentReplyEditorProps) {
  const [content, setContent] = useState("");
  const { ref, focused } = useFocusWithin();
  const commentEditorRef = useRef<any>(null);

  const handleSave = useCallback(() => {
    void onSave(commentId, content);
    setContent("");
    commentEditorRef.current?.clearContent?.();
  }, [commentId, content, onSave]);

  return (
    <div ref={ref}>
      <CommentEditor
        ref={commentEditorRef}
        onUpdate={setContent}
        onSave={handleSave}
        editable={true}
      />
      {focused && <CommentActions onSave={handleSave} isLoading={isLoading} />}
    </div>
  );
}
