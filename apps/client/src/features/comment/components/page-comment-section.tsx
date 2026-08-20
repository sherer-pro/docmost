import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge, Button, Collapse, Paper, Text } from "@mantine/core";
import { useFocusWithin } from "@mantine/hooks";
import CommentActions from "@/features/comment/components/comment-actions";
import CommentEditor from "@/features/comment/components/comment-editor";
import {
  useCommentsQuery,
  useCreateCommentMutation,
} from "@/features/comment/queries/comment-query";
import { IComment } from "@/features/comment/types/comment.types.ts";
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
import { useAtomValue } from "jotai";
import { activeCommentIdAtom } from "@/features/comment/atoms/comment-atom";
import { COMMENT_LIMIT } from "@/features/comment/comment.constants";
import { CommentThreadList } from "./comment-thread-list";
import { shouldRevealResolvedComments } from "../utils/comment-collapse";
import { useLazyCommentTrigger } from "../hooks/use-lazy-comment-trigger";

interface PageCommentSectionProps {
  pageId: string;
}

function LoadedPageCommentSection({ pageId }: PageCommentSectionProps) {
  const { t } = useTranslation();
  const emit = useQueryEmit();
  const { pageByRoute } = useDatabasePageContext();
  const { data: space } = useGetSpaceBySlugQuery(pageByRoute?.space?.slug);

  const {
    data: comments,
    isLoading: isCommentsLoading,
    isError,
  } = useCommentsQuery({ pageId, limit: COMMENT_LIMIT });

  const createCommentMutation = useCreateCommentMutation();
  const [isReplyLoading, setIsReplyLoading] = useState(false);
  const [isRootLoading, setIsRootLoading] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const activeCommentId = useAtomValue(activeCommentIdAtom);
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

  useEffect(() => {
    if (
      comments?.items &&
      shouldRevealResolvedComments(
        comments.items,
        resolvedComments,
        activeCommentId,
      )
    ) {
      setShowResolved(true);
    }
  }, [activeCommentId, comments?.items, resolvedComments]);

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

  if (!pageId) {
    return null;
  }

  return (
    <div className={classes.container}>
      <Text size="md" fw={600} my="md">
        {t("Comments")}
      </Text>

      {canComment && (
        <Paper
          shadow="sm"
          radius="md"
          p="sm"
          mb="sm"
          withBorder
          ref={rootComposerFocusRef}
        >
          <CommentEditor
            ref={rootEditorRef}
            onUpdate={setRootContent}
            onSave={handleAddRootComment}
            placeholder={t("Write a comment")}
            editable={true}
          />
          {rootComposerFocused && (
            <CommentActions
              onSave={handleAddRootComment}
              isLoading={isRootLoading}
            />
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

      {comments && (
        <CommentThreadList
          comments={comments}
          rootComments={activeComments}
          pageId={pageId}
          canComment={canComment}
          canResolve={canResolveComments}
          userSpaceRole={space?.membership?.role}
          activeCommentId={activeCommentId}
          isReplyLoading={isReplyLoading}
          includesComment={isPageLevelComment}
          onReply={handleAddReply}
        />
      )}

      {resolvedComments.length > 0 && (
        <>
          <Button
            variant="default"
            color="gray"
            size="xs"
            aria-controls="page-resolved-comments"
            aria-expanded={showResolved}
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

          <Collapse id="page-resolved-comments" in={showResolved}>
            <Text size="sm" fw={600} mb="sm">
              {t("Resolved comments")}
            </Text>
            {comments && (
              <CommentThreadList
                comments={comments}
                rootComments={resolvedComments}
                pageId={pageId}
                canComment={canComment}
                canResolve={canResolveComments}
                userSpaceRole={space?.membership?.role}
                activeCommentId={activeCommentId}
                isReplyLoading={isReplyLoading}
                includesComment={isPageLevelComment}
                onReply={handleAddReply}
              />
            )}
          </Collapse>
        </>
      )}
    </div>
  );
}

function PageCommentSection({ pageId }: PageCommentSectionProps) {
  const { t } = useTranslation();
  const activeCommentId = useAtomValue(activeCommentIdAtom);
  const { targetRef, shouldLoad } = useLazyCommentTrigger(activeCommentId);

  if (!pageId) {
    return null;
  }

  return (
    <div ref={targetRef}>
      {shouldLoad ? (
        <LoadedPageCommentSection pageId={pageId} />
      ) : (
        <div className={classes.container}>
          <Text size="md" fw={600} my="md">
            {t("Comments")}
          </Text>
        </div>
      )}
    </div>
  );
}

export default PageCommentSection;
