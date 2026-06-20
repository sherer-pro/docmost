import { useEffect, useRef } from "react";
import { useAtom } from "jotai";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { SimpleTree } from "react-arborist";
import localEmitter from "@/lib/local-emitter.ts";

/**
 * Synchronizes local, same-tab tree title/slug updates.
 *
 * Socket `message` events are handled only by `useQuerySubscription`; keeping
 * this hook local-only prevents duplicate tree mutations for collaborative
 * create/move/delete/update events.
 */
export const useTreeSocket = () => {
  const [treeData, setTreeData] = useAtom(treeDataAtom);
  const initialTreeData = useRef(treeData);

  useEffect(() => {
    initialTreeData.current = treeData;
  }, [treeData]);

  useEffect(() => {
    const updateNodeName = (event) => {
      const initialData = initialTreeData.current;
      const treeApi = new SimpleTree<SpaceTreeNode>(initialData);

      if (treeApi.find(event?.id)) {
        if (event.payload?.title !== undefined) {
          treeApi.update({
            id: event.id,
            changes: { name: event.payload.title },
          });
        }

        if (event.payload?.slugId !== undefined) {
          treeApi.update({
            id: event.id,
            changes: { slugId: event.payload.slugId },
          });
        }

        setTreeData(treeApi.data);
      }
    };

    localEmitter.on("message", updateNodeName);
    return () => {
      localEmitter.off("message", updateNodeName);
    };
  }, []);
};
