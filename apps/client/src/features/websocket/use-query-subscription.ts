import React from "react";
import { socketAtom } from "@/features/websocket/atoms/socket-atom.ts";
import { useAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { WebSocketEvent } from "@/features/websocket/types";
import { IPagination } from "@/lib/types";
import {
  invalidateOnCreatePage,
  invalidateOnDeletePage,
  updateCacheOnMovePage,
  updatePageDataFromPatch,
  invalidateOnUpdatePage,
} from "../page/queries/page-query";
import { RQ_KEY } from "../comment/queries/comment-query";
import { IComment } from "@/features/comment/types/comment.types";

const mapTreeNodeToPage = (node: {
  id: string;
  slugId?: string;
  name?: string;
  icon?: string;
  position?: string;
  spaceId: string;
  parentPageId?: string | null;
  hasChildren?: boolean;
}) => ({
  id: node.id,
  slugId: node.slugId,
  title: node.name,
  icon: node.icon,
  position: node.position,
  spaceId: node.spaceId,
  parentPageId: node.parentPageId ?? null,
  hasChildren: node.hasChildren,
});

export const useQuerySubscription = () => {
  const queryClient = useQueryClient();
  const [socket] = useAtom(socketAtom);

  React.useEffect(() => {
    socket?.on("message", (event) => {
      const data: WebSocketEvent = event;

      let entity = null;
      let queryKeyId = null;

      switch (data.operation) {
        case "invalidate":
          queryClient.invalidateQueries({
            queryKey: [...data.entity, data.id].filter(Boolean),
          });
          break;
        case "invalidateComment":
          queryClient.invalidateQueries({
            queryKey: RQ_KEY(data.pageId),
          });
          break;
        case "addTreeNode":
          invalidateOnCreatePage(mapTreeNodeToPage(data.payload.node));
          break;
        case "moveTreeNode":
          updateCacheOnMovePage(
            data.spaceId,
            data.payload.id,
            data.payload.oldParentId,
            data.payload.parentId,
            mapTreeNodeToPage(data.payload.node),
          );
          break;
        case "deleteTreeNode":
          invalidateOnDeletePage(data.payload.node.id);
          break;
        case "updateOne":
          entity = data.entity[0];
          queryKeyId = entity === "pages" ? data.payload.slugId : data.id;

          if (entity === "pages") {
            const updatedPage = updatePageDataFromPatch({
              id: data.id,
              spaceId: data.spaceId,
              ...data.payload,
            });

            if (!updatedPage) {
              invalidateOnUpdatePage(
                data.spaceId,
                data.payload.parentPageId,
                data.id,
                data.payload.title,
                data.payload.icon,
                data.payload.customFields?.status,
              );
            }

            break;
          }

          if (queryClient.getQueryData([...data.entity, queryKeyId])) {
            queryClient.setQueryData([...data.entity, queryKeyId], {
              ...queryClient.getQueryData([...data.entity, queryKeyId]),
              ...data.payload,
            });
          }
          break;
        case "refetchRootTreeNodeEvent": {
          const spaceId = data.spaceId;
          queryClient.refetchQueries({ queryKey: ["root-sidebar-pages", spaceId] });
          queryClient.invalidateQueries({ queryKey: ["recent-changes", spaceId] });
          break;
        }
        case "resolveComment": {
          const currentComments = queryClient.getQueryData(
            RQ_KEY(data.pageId),
          ) as IPagination<IComment>;

          if (currentComments && currentComments.items) {
            const updatedComments = currentComments.items.map((comment) =>
              comment.id === data.commentId
                ? {
                    ...comment,
                    resolvedAt: data.resolvedAt,
                    resolvedById: data.resolvedById,
                    resolvedBy: data.resolvedBy,
                  }
                : comment,
            );

            queryClient.setQueryData(RQ_KEY(data.pageId), {
              ...currentComments,
              items: updatedComments,
            });
          }
          break;
        }
      }
    });
  }, [queryClient, socket]);
};
