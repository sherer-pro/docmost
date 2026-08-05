import React, { useState, useCallback, useMemo } from "react";
import {
  Text,
  ScrollArea,
  Button,
  Badge,
  Collapse,
  Group,
} from "@mantine/core";
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
import { isInlineOrLegacyComment } from "@/features/comment/utils/comment-type-filter";
import { useAtomValue } from "jotai";
import { activeCommentIdAtom } from "@/features/comment/atoms/comment-atom";
import { COMMENT_LIMIT } from "@/features/comment/comment.constants";
import { CommentThreadList } from "./comment-thread-list";

function CommentListWithTabs() {
  const { t } = useTranslation();
  const {
    databasePageId,
    pageByRoute,
  } = useDatabasePageContext();

  /**
   * Single pageId used by query keys, list rendering, and all comment mutations.
   *
   * The value comes from a shared page/database context so the header comments
   * button and the comments panel always point to the same entity.
   */
  const commentsPageId = databasePageId ?? "";
  const {
    data: comments,
    isLoading: isCommentsLoading,
    isError,
  } = useCommentsQuery({ pageId: commentsPageId, limit: COMMENT_LIMIT });
  const createCommentMutation = useCreateCommentMutation();
  const [isLoading, setIsLoading] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const activeCommentId = useAtomValue(activeCommentIdAtom);
  const emit = useQueryEmit();
  const { data: space } = useGetSpaceBySlugQuery(pageByRoute?.space?.slug);

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
      (comment: IComment) =>
        comment.parentCommentId === null && isInlineOrLegacyComment(comment)
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
        if (!commentsPageId) {
          return;
        }

        setIsLoading(true);
        const commentData = {
          pageId: commentsPageId,
          parentCommentId: commentId,
          content: JSON.stringify(content),
          type: "inline" as const,
        };

        await createCommentMutation.mutateAsync(commentData);

        emit({
          operation: "invalidateComment",
          pageId: commentsPageId,
        }, { spaceId: pageByRoute?.spaceId, workspaceId: pageByRoute?.workspaceId });
      } catch (error) {
        console.error("Failed to post comment:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [commentsPageId, createCommentMutation, emit, pageByRoute?.spaceId, pageByRoute?.workspaceId]
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
            <CommentThreadList
              comments={comments}
              rootComments={activeComments}
              pageId={commentsPageId}
              canComment={canComment}
              canResolve={canResolveComments}
              userSpaceRole={space?.membership?.role}
              activeCommentId={activeCommentId}
              isReplyLoading={isLoading}
              includesComment={isInlineOrLegacyComment}
              onReply={handleAddReply}
            />
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
                <CommentThreadList
                  comments={comments}
                  rootComments={resolvedComments}
                  pageId={commentsPageId}
                  canComment={canComment}
                  canResolve={canResolveComments}
                  userSpaceRole={space?.membership?.role}
                  activeCommentId={activeCommentId}
                  isReplyLoading={isLoading}
                  includesComment={isInlineOrLegacyComment}
                  onReply={handleAddReply}
                />
              </Collapse>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default CommentListWithTabs;
