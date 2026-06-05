import { Button, Group, Text, Box } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import classes from "./comment.module.css";
import { useAtom, useAtomValue } from "jotai";
import { timeAgo } from "@/lib/time";
import CommentEditor from "@/features/comment/components/comment-editor";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import CommentActions from "@/features/comment/components/comment-actions";
import CommentMenu from "@/features/comment/components/comment-menu";
import { useHover } from "@mantine/hooks";
import {
  useDeleteCommentMutation,
  useUpdateCommentMutation,
} from "@/features/comment/queries/comment-query";
import { useResolveCommentMutation } from "@/ee/comment/queries/comment-query";
import { IComment } from "@/features/comment/types/comment.types";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useQueryEmit } from "@/features/websocket/use-query-emit";
import { scrollCommentMarkIntoView } from "@/features/comment/utils/comment-dom";
import { COMMENT_BODY_COLLAPSE_LINES } from "@/features/comment/utils/comment-collapse";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

interface CommentListItemProps {
  comment: IComment;
  pageId: string;
  canComment: boolean;
  canResolve: boolean;
  userSpaceRole?: string;
}

function CommentListItem({
  comment,
  pageId,
  canComment,
  canResolve,
  userSpaceRole,
}: CommentListItemProps) {
  const { t } = useTranslation();
  const { hovered, ref } = useHover();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBodyExpanded, setIsBodyExpanded] = useState(false);
  const [isBodyCollapsible, setIsBodyCollapsible] = useState(false);
  const editor = useAtomValue(pageEditorAtom);
  const [content, setContent] = useState<string>(comment.content);
  const editContentRef = useRef<any>(null);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const updateCommentMutation = useUpdateCommentMutation();
  const deleteCommentMutation = useDeleteCommentMutation(comment.pageId);
  const resolveCommentMutation = useResolveCommentMutation();
  const [currentUser] = useAtom(currentUserAtom);
  const emit = useQueryEmit();

  useEffect(() => {
    setContent(comment.content);
    setIsBodyExpanded(false);
  }, [comment.id, comment.content]);

  useEffect(() => {
    if (isEditing || isBodyExpanded) {
      setIsBodyCollapsible(false);
      return;
    }

    const bodyElement = bodyContentRef.current;
    if (!bodyElement) {
      return;
    }

    const updateCollapsibleState = () => {
      setIsBodyCollapsible(
        bodyElement.scrollHeight > bodyElement.clientHeight + 1,
      );
    };

    const frameId = window.requestAnimationFrame(updateCollapsibleState);
    if (typeof ResizeObserver === "undefined") {
      return () => window.cancelAnimationFrame(frameId);
    }

    const resizeObserver = new ResizeObserver(updateCollapsibleState);
    resizeObserver.observe(bodyElement);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [content, isBodyExpanded, isEditing]);

  async function handleUpdateComment() {
    try {
      setIsLoading(true);
      const commentToUpdate = {
        commentId: comment.id,
        content: JSON.stringify(editContentRef.current ?? content),
      };
      await updateCommentMutation.mutateAsync(commentToUpdate);
      if (editContentRef.current) {
        setContent(editContentRef.current);
        editContentRef.current = null;
      }
      setIsEditing(false);

      emit({
        operation: "invalidateComment",
        pageId: pageId,
      }, { workspaceId: comment.workspaceId });
    } catch (error) {
      console.error("Failed to update comment:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteComment() {
    try {
      await deleteCommentMutation.mutateAsync(comment.id);

      if (comment.type !== "page") {
        editor?.commands.unsetComment(comment.id);
      }

      emit({
        operation: "invalidateComment",
        pageId: pageId,
      }, { workspaceId: comment.workspaceId });
    } catch (error) {
      console.error("Failed to delete comment:", error);
    }
  }

  async function handleResolveComment() {
    // Toggle comment state between "active" and "resolved".
    // This keeps resolved discussions separated from open ones in the main list.
    try {
      const isResolved = comment.resolvedAt != null;
      
      await resolveCommentMutation.mutateAsync({
        commentId: comment.id,
        pageId: comment.pageId,
        resolved: !isResolved,
      });

      if (editor && comment.type !== "page") {
        editor.commands.setCommentResolved(comment.id, !isResolved);
      }

      emit({
        operation: "invalidateComment",
        pageId: pageId,
      }, { workspaceId: comment.workspaceId });
    } catch (error) {
      console.error("Failed to toggle resolved state:", error);
    }
  }

  function handleCommentClick(comment: IComment) {
    const el = scrollCommentMarkIntoView(comment.id);
    if (el) {
      el.classList.add("comment-highlight");
      setTimeout(() => {
        el.classList.remove("comment-highlight");
      }, 3000);
    }
  }

  function handleEditToggle() {
    setIsEditing(true);
  }
  function cancelEdit() {
    editContentRef.current = null;
    setIsEditing(false);
  }

  const isOwner = currentUser?.user?.id === comment.creatorId;
  const isAdmin = userSpaceRole === "admin";
  const canEditComment = isOwner;
  const canDeleteComment = isOwner || isAdmin;
  const canResolveComment = canResolve && !comment.parentCommentId;
  const shouldShowMenu = canEditComment || canDeleteComment || canResolveComment;
  const commentBodyCollapseStyle = {
    "--comment-body-collapse-lines": COMMENT_BODY_COLLAPSE_LINES,
  } as React.CSSProperties;

  return (
    <Box ref={ref} pb="xs">
      <Group>
        <CustomAvatar
          size="sm"
          avatarUrl={comment.creator.avatarUrl}
          name={comment.creator.name}
        />

        <div style={{ flex: 1 }}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" fw={500} lineClamp={1}>
              {comment.creator.name}
            </Text>

            <div style={{ visibility: hovered ? "visible" : "hidden" }}>
              {shouldShowMenu && (
                <CommentMenu
                  onEditComment={handleEditToggle}
                  onDeleteComment={handleDeleteComment}
                  onResolveComment={handleResolveComment}
                  canEdit={canEditComment}
                  canDelete={canDeleteComment}
                  isResolved={comment.resolvedAt != null}
                  isParentComment={!comment.parentCommentId && canComment}
                  canResolve={canResolveComment}
                />
              )}
            </div>
          </Group>

          <Group gap="xs">
            <Text size="xs" fw={500} c="dimmed">
              {timeAgo(comment.createdAt)}
            </Text>
          </Group>
        </div>
      </Group>

      <div>
        {!comment.parentCommentId && comment?.selection && (
          <Box
            className={classes.textSelection}
            onClick={() => handleCommentClick(comment)}
          >
            <Text size="sm">{comment?.selection}</Text>
          </Box>
        )}

        {!isEditing ? (
          <>
            <div
              ref={bodyContentRef}
              className={clsx(
                !isBodyExpanded && classes.commentBodyCollapsed,
              )}
              style={commentBodyCollapseStyle}
            >
              <CommentEditor defaultContent={content} editable={false} />
            </div>

            {!isBodyExpanded && isBodyCollapsible && (
              <Button
                className={classes.commentMoreButton}
                size="compact-sm"
                variant="subtle"
                color="gray"
                onClick={() => setIsBodyExpanded(true)}
              >
                {t("More")}
              </Button>
            )}
          </>
        ) : (
          <>
            <CommentEditor
              defaultContent={content}
              editable={true}
              onUpdate={(newContent: any) => { editContentRef.current = newContent; }}
              onSave={handleUpdateComment}
              autofocus={true}
            />

            <CommentActions
              onSave={handleUpdateComment}
              isLoading={isLoading}
              onCancel={cancelEdit}
              isCommentEditor={true}
            />
          </>
        )}
      </div>
    </Box>
  );
}

export default CommentListItem;
