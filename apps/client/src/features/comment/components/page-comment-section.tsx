import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Collapse,
  Divider,
  Group,
  Paper,
  Text,
} from "@mantine/core";
import { useFocusWithin } from "@mantine/hooks";
import CommentActions from "@/features/comment/components/comment-actions";
import CommentEditor from "@/features/comment/components/comment-editor";
import CommentListItem from "@/features/comment/components/comment-list-item";
import {
  useCommentsQuery,
  useCreateCommentMutation,
} from "@/features/comment/queries/comment-query";
import { IComment } from "@/features/comment/types/comment.types.ts";
import { IPagination } from "@/lib/types.ts";
import { useTranslation } from "react-i18next";
import { useQueryEmit } from "@/features/websocket/use-query-emit";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import { useDatabasePageContext } from "@/features/database/hooks/use-database-page-context.ts";
import { isPageLevelComment } from "@/features/comment/utils/comment-type-filter";
import classes from "./page-comment-section.module.css";

interface PageCommentSectionProps {
  pageId: string;
}

function PageCommentSection({ pageId }: PageCommentSectionProps) {
  const { t } = useTranslation();
  const emit = useQueryEmit();
  const { pageByRoute } = useDatabasePageContext();
  const { data: space } = useGetSpaceBySlugQuery(pageByRoute?.space?.slug);

  const {
    data: comments,
    isLoading: isCommentsLoading,
    isError,
  } = useCommentsQuery({ pageId, limit: 100 });

  const createCommentMutation = useCreateCommentMutation();
  const [isReplyLoading, setIsReplyLoading] = useState(false);
  const [isRootLoading, setIsRootLoading] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [rootContent, setRootContent] = useState("");
  const rootEditorRef = useRef<any>(null);
  const { ref: rootComposerFocusRef, focused: rootComposerFocused } =
    useFocusWithin();

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);

  const canComment: boolean = spaceAbility.can(
    SpaceCaslAction.Create,
    SpaceCaslSubject.Page,
  );

  const canResolveComments: boolean = spaceAbility.can(
    SpaceCaslAction.Edit,
    SpaceCaslSubject.Page,
  );

  const { activeComments, resolvedComments } = useMemo(() => {
    if (!comments?.items) {
      return { activeComments: [], resolvedComments: [] };
    }

    const parentComments = comments.items.filter(
      (comment: IComment) =>
        comment.parentCommentId === null && isPageLevelComment(comment),
    );

    const active = parentComments.filter(
      (comment: IComment) => !comment.resolvedAt,
    );
    const resolved = parentComments.filter(
      (comment: IComment) => comment.resolvedAt,
    );

    return { activeComments: active, resolvedComments: resolved };
  }, [comments]);

  const emitInvalidate = useCallback(
    (workspaceId?: string, spaceId?: string) => {
      if (!workspaceId) {
        return;
      }

      emit(
        {
          operation: "invalidateComment",
          pageId,
        },
        { workspaceId, ...(spaceId ? { spaceId } : {}) },
      );
    },
    [emit, pageId],
  );

  const handleAddRootComment = useCallback(async () => {
    try {
      if (!pageId) {
        return;
      }

      setIsRootLoading(true);
      const createdComment = await createCommentMutation.mutateAsync({
        pageId,
        content: JSON.stringify(rootContent),
        type: "page",
      });

      rootEditorRef.current?.clearContent?.();
      setRootContent("");
      emitInvalidate(createdComment.workspaceId, createdComment.spaceId);
    } catch (error) {
      console.error("Failed to post comment:", error);
    } finally {
      setIsRootLoading(false);
    }
  }, [createCommentMutation, emitInvalidate, pageId, rootContent]);

  const handleAddReply = useCallback(
    async (commentId: string, content: string) => {
      try {
        if (!pageId) {
          return;
        }

        setIsReplyLoading(true);
        const createdComment = await createCommentMutation.mutateAsync({
          pageId,
          parentCommentId: commentId,
          content: JSON.stringify(content),
          type: "page",
        });

        emitInvalidate(createdComment.workspaceId, createdComment.spaceId);
      } catch (error) {
        console.error("Failed to post comment:", error);
      } finally {
        setIsReplyLoading(false);
      }
    },
    [createCommentMutation, emitInvalidate, pageId],
  );

  const renderComments = useCallback(
    (comment: IComment) => (
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
            canResolve={canResolveComments}
            userSpaceRole={space?.membership?.role}
          />
          <MemoizedChildComments
            comments={comments}
            parentId={comment.id}
            pageId={pageId}
            canComment={canComment}
            canResolve={canResolveComments}
            userSpaceRole={space?.membership?.role}
          />
        </div>

        {!comment.resolvedAt && canComment && (
          <>
            <Divider my={4} />
            <CommentEditorWithActions
              commentId={comment.id}
              onSave={handleAddReply}
              isLoading={isReplyLoading}
            />
          </>
        )}
      </Paper>
    ),
    [
      canComment,
      canResolveComments,
      comments,
      handleAddReply,
      isReplyLoading,
      pageId,
      space?.membership?.role,
    ],
  );

  if (!pageId) {
    return null;
  }

  return (
    <div className={classes.container}>
      <Text size="md" fw={600} my="md">
        {t("Comments")}
      </Text>

      {canComment && (
        <Paper shadow="sm" radius="md" p="sm" mb="sm" withBorder ref={rootComposerFocusRef}>
          <CommentEditor
            ref={rootEditorRef}
            onUpdate={setRootContent}
            onSave={handleAddRootComment}
            placeholder={t("Write a comment")}
            editable={true}
          />
          {rootComposerFocused && (
            <CommentActions onSave={handleAddRootComment} isLoading={isRootLoading} />
          )}
        </Paper>
      )}

      {isError && (
        <Text size="sm" c="red">
          {t("Error loading comments.")}
        </Text>
      )}

      {!isCommentsLoading &&
        !isError &&
        activeComments.length === 0 &&
        resolvedComments.length === 0 && (
        <Text size="sm" c="dimmed" py="sm">
          {t("No comments yet.")}
        </Text>
      )}

      {activeComments.map(renderComments)}

      {resolvedComments.length > 0 && (
        <>
          <Button
            variant="default"
            color="gray"
            size="xs"
            onClick={() => setShowResolved((prev) => !prev)}
            style={{
              marginTop: "15px",
              marginBottom: "15px",
            }}
          >
            {showResolved ? t("Hide resolved") : t("Show resolved")}
            <Badge ml="xs" size="sm" variant="default" color="gray">
              {resolvedComments.length}
            </Badge>
          </Button>

          <Collapse in={showResolved}>
            <Text size="sm" fw={600} mb="sm">
              {t("Resolved comments")}
            </Text>
            {resolvedComments.map(renderComments)}
          </Collapse>
        </>
      )}
    </div>
  );
}

interface ChildCommentsProps {
  comments: IPagination<IComment>;
  parentId: string;
  pageId: string;
  canComment: boolean;
  canResolve: boolean;
  userSpaceRole?: string;
}

const ChildComments = ({
  comments,
  parentId,
  pageId,
  canComment,
  canResolve,
  userSpaceRole,
}: ChildCommentsProps) => {
  const getChildComments = useCallback(
    (targetParentId: string) =>
      comments.items.filter(
        (comment: IComment) =>
          comment.parentCommentId === targetParentId &&
          isPageLevelComment(comment),
      ),
    [comments.items],
  );

  return (
    <div>
      {getChildComments(parentId).map((childComment) => (
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
          />
        </div>
      ))}
    </div>
  );
};

const MemoizedChildComments = memo(ChildComments);

const CommentEditorWithActions = ({ commentId, onSave, isLoading }) => {
  const [content, setContent] = useState("");
  const { ref, focused } = useFocusWithin();
  const commentEditorRef = useRef<any>(null);

  const handleSave = useCallback(() => {
    onSave(commentId, content);
    setContent("");
    commentEditorRef.current?.clearContent();
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
};

export default PageCommentSection;
