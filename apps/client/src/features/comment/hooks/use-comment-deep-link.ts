import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useSetAtom } from "jotai";
import { activeCommentIdAtom } from "../atoms/comment-atom";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import { getCommentById } from "../services/comment-service";

export function useCommentDeepLink(pageId?: string) {
  const [params] = useSearchParams();
  const commentId = params.get("commentId");
  const setActive = useSetAtom(activeCommentIdAtom);
  const setAside = useSetAtom(asideStateAtom);
  useEffect(() => {
    if (!pageId || !commentId || !/^[a-f0-9-]{36}$/i.test(commentId)) return;
    let current = true;
    void getCommentById(commentId)
      .then(async (comment) => {
        if (!current || comment.pageId !== pageId) return;
        let root = comment;
        for (let depth = 0; root.parentCommentId && depth < 30; depth++) {
          root = await getCommentById(root.parentCommentId);
          if (!current || root.pageId !== pageId) return;
        }
        setActive(commentId);
        setAside({
          tab: root.type === "page" ? "" : "comments",
          isAsideOpen: root.type !== "page",
        });
      })
      .catch(() => {
        /* Deleted and inaccessible comments leave the page readable. */
      });
    return () => {
      current = false;
      setActive(null);
    };
  }, [pageId, commentId, setActive, setAside]);
}
