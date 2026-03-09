import React from "react";
import { socketAtom } from "@/features/websocket/atoms/socket-atom.ts";
import { useAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { WebSocketEvent, WebSocketIncomingEvent } from "@/features/websocket/types";
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
import { ISpace } from "@/features/space/types/space.types.ts";
import { IPage } from "@/features/page/types/page.types.ts";

const mapTreeNodeToPage = (node: {
  id: string;
  nodeType?: "page" | "database" | "databaseRow";
  slugId?: string;
  databaseId?: string | null;
  name?: string;
  icon?: string;
  position?: string;
  spaceId: string;
  parentPageId?: string | null;
  hasChildren?: boolean;
}) => ({
  id: node.id,
  nodeType: node.nodeType,
  slugId: node.slugId,
  databaseId: node.databaseId ?? null,
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
    const handleMessage = (event: WebSocketIncomingEvent) => {
      const data: WebSocketEvent = "data" in event ? event.data : event;

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

          if (entity === "pages") {
            const pagePatch = data.payload as Partial<IPage>;
            queryKeyId = pagePatch.slugId ?? data.id;

            const updatedPage = updatePageDataFromPatch({
              id: data.id,
              spaceId: data.spaceId,
              ...pagePatch,
            });

            if (!updatedPage) {
              invalidateOnUpdatePage(
                data.spaceId,
                pagePatch.parentPageId,
                data.id,
                pagePatch.title,
                pagePatch.icon,
                pagePatch.customFields?.status,
              );
            }

            break;
          }

          if (entity === "space") {
            const spacePatch = data.payload as Partial<ISpace>;
            const queryKeys: Array<[string, string]> = [];

            if (data.id) {
              queryKeys.push(["space", data.id]);
            }

            if (spacePatch.slug) {
              queryKeys.push(["space", spacePatch.slug]);
            }

            queryKeys.forEach((queryKey) => {
              queryClient.setQueryData(queryKey, (cachedSpace: ISpace) => {
                if (!cachedSpace) {
                  return cachedSpace;
                }

                return { ...cachedSpace, ...spacePatch };
              });
            });

            queryClient.invalidateQueries({ queryKey: ["spaces"] });
            break;
          }

          queryKeyId = data.id;

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
    };

    socket?.on("message", handleMessage);

    return () => {
      socket?.off("message", handleMessage);
    };
  }, [queryClient, socket]);
};
