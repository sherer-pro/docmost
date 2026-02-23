import React, { useState, useRef, useCallback, memo, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  Divider,
  Paper,
  Text,
  ScrollArea,
  Button,
  Badge,
  Collapse,
  Group,
} from "@mantine/core";
import CommentListItem from "@/features/comment/components/comment-list-item";
import {
  useCommentsQuery,
  useCreateCommentMutation,
} from "@/features/comment/queries/comment-query";
import CommentEditor from "@/features/comment/components/comment-editor";
import CommentActions from "@/features/comment/components/comment-actions";
import { useFocusWithin } from "@mantine/hooks";
import { IComment } from "@/features/comment/types/comment.types.ts";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { IPagination } from "@/lib/types.ts";
import { extractPageSlugId } from "@/lib";
import { useTranslation } from "react-i18next";
import { useQueryEmit } from "@/features/websocket/use-query-emit";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";

function CommentListWithTabs() {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const {
    data: comments,
    isLoading: isCommentsLoading,
    isError,
  } = useCommentsQuery({ pageId: page?.id, limit: 100 });
  const createCommentMutation = useCreateCommentMutation();
  const [isLoading, setIsLoading] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const emit = useQueryEmit();
  const { data: space } = useGetSpaceBySlugQuery(page?.space?.slug);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);

  const canComment: boolean = spaceAbility.can(
    SpaceCaslAction.Create,
    SpaceCaslSubject.Page
  );

  // Resolve/re-open actions are validated on the server via Edit Page permission.
  // Mirror that behavior on the client to avoid showing unavailable actions.
  const canResolveComments: boolean = spaceAbility.can(
    SpaceCaslAction.Edit,
    SpaceCaslSubject.Page
  );

  /**
   * Split only root comments into active and resolved buckets.
   * Child comments stay next to their parent in the same tree.
   */
  const { activeComments, resolvedComments } = useMemo(() => {
    if (!comments?.items) {
      return { activeComments: [], resolvedComments: [] };
    }

    const parentComments = comments.items.filter(
      (comment: IComment) => comment.parentCommentId === null
    );

    const active = parentComments.filter(
      (comment: IComment) => !comment.resolvedAt
    );
    const resolved = parentComments.filter(
      (comment: IComment) => comment.resolvedAt
    );

    return { activeComments: active, resolvedComments: resolved };
  }, [comments]);

  const handleAddReply = useCallback(
    async (commentId: string, content: string) => {
      try {
        setIsLoading(true);
        const commentData = {
          pageId: page?.id,
          parentCommentId: commentId,
          content: JSON.stringify(content),
        };

        await createCommentMutation.mutateAsync(commentData);

        emit({
          operation: "invalidateComment",
          pageId: page?.id,
        });
      } catch (error) {
        console.error("Failed to post comment:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [createCommentMutation, page?.id]
  );

  /**
   * Renders a root comment card with its children and reply form.
   *
   * Pass `canResolveComments` explicitly so the menu does not show
   * Resolve/Re-open actions to users without page edit permission.
   */
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
            pageId={page?.id}
            canComment={canComment}
            canResolve={canResolveComments}
            userSpaceRole={space?.membership?.role}
          />
          <MemoizedChildComments
            comments={comments}
            parentId={comment.id}
            pageId={page?.id}
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
              isLoading={isLoading}
            />
          </>
        )}
      </Paper>
    ),
    [canComment, canResolveComments, comments, handleAddReply, isLoading, page?.id, space?.membership?.role]
  );

  if (isCommentsLoading) {
    return <></>;
  }

  if (isError) {
    return <div>{t("Error loading comments.")}</div>;
  }

  const totalComments = activeComments.length + resolvedComments.length;

  if (totalComments === 0) {
    return <>{t("No comments yet.")}</>;
  }

  return (
    <div
      style={{
        height: "85vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Group justify="space-between" mb="sm">
        <Text size="sm" fw={600}>
          {t("Open comments")}
        </Text>

      </Group>

      <ScrollArea style={{ flex: "1 1 auto" }} scrollbarSize={5} type="scroll">
        <div style={{ paddingBottom: "200px" }}>
          {activeComments.length === 0 ? (
            <Text size="sm" c="dimmed" py="md">
              {t("No open comments.")}
            </Text>
          ) : (
            activeComments.map(renderComments)
          )}

          {/*
            If there are no resolved comments, hide the button and resolved section.
            This removes an empty action from the UI and matches expected UX.
          */}
          {resolvedComments.length > 0 && (
            <>
              <Button
                variant="default" color="gray"
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
      </ScrollArea>
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
    (parentId: string) =>
      comments.items.filter(
        (comment: IComment) => comment.parentCommentId === parentId
      ),
    [comments.items]
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
  const commentEditorRef = useRef(null);

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

export default CommentListWithTabs;
