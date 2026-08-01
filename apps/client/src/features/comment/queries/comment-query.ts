import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  createComment,
  deleteComment,
  getPageComments,
  resolveComment,
  updateComment,
} from "@/features/comment/services/comment-service";
import {
  ICommentParams,
  IComment,
  IResolveComment,
} from "@/features/comment/types/comment.types";
import { notifications } from "@mantine/notifications";
import { IPagination } from "@/lib/types.ts";
import { useTranslation } from "react-i18next";
import { COMMENT_LIMIT } from "@/features/comment/comment.constants";
import { useQueryEmit } from "@/features/websocket/use-query-emit";

export const RQ_KEY = (pageId: string) => ["comments", pageId];

type TranslationFn = (
  key: string,
  options?: {
    limit: number;
  },
) => string;

export function getCreateCommentErrorMessage(
  error: Error,
  t: TranslationFn,
) {
  const isCommentLimitReached = error["response"]?.status === 409;

  if (isCommentLimitReached) {
    return t("This page has reached the limit of {{limit}} comments.", {
      limit: COMMENT_LIMIT,
    });
  }

  return t("Error creating comment");
}

export function useCommentsQuery(
  params: ICommentParams,
): UseQueryResult<IPagination<IComment>, Error> {
  return useQuery({
    queryKey: RQ_KEY(params.pageId),
    queryFn: () => getPageComments(params),
    enabled: !!params.pageId,
  });
}

export function useCreateCommentMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<IComment, Error, Partial<IComment>>({
    mutationFn: (data) => createComment(data),
    onSuccess: (data) => {
      //const newComment = data;
      // let comments = queryClient.getQueryData(RQ_KEY(data.pageId));
      // if (comments) {
      //comments = prevComments => [...prevComments, newComment];
      //queryClient.setQueryData(RQ_KEY(data.pageId), comments);
      //}

      queryClient.refetchQueries({ queryKey: RQ_KEY(data.pageId) });
      notifications.show({ message: t("Comment created successfully") });
    },
    onError: (error) => {
      notifications.show({
        message: getCreateCommentErrorMessage(error, t),
        color: "red",
      });
    },
  });
}

export function useUpdateCommentMutation() {
  const { t } = useTranslation();

  return useMutation<IComment, Error, Partial<IComment>>({
    mutationFn: (data) => updateComment(data),
    onSuccess: (data) => {
      notifications.show({ message: t("Comment updated successfully") });
    },
    onError: (error) => {
      notifications.show({
        message: t("Failed to update comment"),
        color: "red",
      });
    },
  });
}

export function useDeleteCommentMutation(pageId?: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onSuccess: (data, variables) => {
      const comments = queryClient.getQueryData(
        RQ_KEY(pageId),
      ) as IPagination<IComment>;

      if (comments && comments.items) {
        const commentId = variables;
        const newComments = comments.items.filter(
          (comment) => comment.id !== commentId,
        );
        queryClient.setQueryData(RQ_KEY(pageId), {
          ...comments,
          items: newComments,
        });
      }

      notifications.show({ message: t("Comment deleted successfully") });
    },
    onError: (error) => {
      notifications.show({
        message: t("Failed to delete comment"),
        color: "red",
      });
    },
  });
}

export function useResolveCommentMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const emit = useQueryEmit();

  return useMutation({
    mutationFn: (data: IResolveComment) => resolveComment(data),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: RQ_KEY(variables.pageId) });
      const previousComments = queryClient.getQueryData(
        RQ_KEY(variables.pageId),
      );
      queryClient.setQueryData(
        RQ_KEY(variables.pageId),
        (old: IPagination<IComment>) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.map((comment) =>
              comment.id === variables.commentId
                ? {
                    ...comment,
                    resolvedAt: variables.resolved ? new Date() : null,
                    resolvedById: variables.resolved
                      ? "optimistic-user"
                      : null,
                    resolvedBy: variables.resolved
                      ? {
                          id: "optimistic-user",
                          name: "Resolving...",
                          avatarUrl: null,
                        }
                      : null,
                  }
                : comment,
            ),
          };
        },
      );
      return { previousComments };
    },
    onError: (_error, variables, context) => {
      if (context?.previousComments) {
        queryClient.setQueryData(
          RQ_KEY(variables.pageId),
          context.previousComments,
        );
      }
      notifications.show({
        message: t("Failed to resolve comment"),
        color: "red",
      });
    },
    onSuccess: (data: IComment, variables) => {
      const pageId = data.pageId;
      const currentComments = queryClient.getQueryData(
        RQ_KEY(pageId),
      ) as IPagination<IComment>;
      if (currentComments?.items) {
        queryClient.setQueryData(RQ_KEY(pageId), {
          ...currentComments,
          items: currentComments.items.map((comment) =>
            comment.id === variables.commentId
              ? {
                  ...comment,
                  resolvedAt: data.resolvedAt,
                  resolvedById: data.resolvedById,
                  resolvedBy: data.resolvedBy,
                }
              : comment,
          ),
        });
      }
      emit(
        {
          operation: "resolveComment",
          pageId,
          commentId: variables.commentId,
          resolved: variables.resolved,
          resolvedAt: data.resolvedAt,
          resolvedById: data.resolvedById,
          resolvedBy: data.resolvedBy,
        },
        { workspaceId: data.workspaceId },
      );
      queryClient.invalidateQueries({ queryKey: RQ_KEY(pageId) });
      notifications.show({
        message: variables.resolved
          ? t("Comment resolved successfully")
          : t("Comment re-opened successfully"),
      });
    },
  });
}
