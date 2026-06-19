import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useAtom } from "jotai";
import { socketAtom } from "@/features/websocket/atoms/socket-atom.ts";
import { extractPageSlugId } from "@/lib";

const HEARTBEAT_MS = 15_000;
const TAB_ID_KEY = "docmost.presence.tabId";

type PresencePayload = {
  type: "page" | "space" | "workspace";
  pageId?: string;
  spaceId?: string;
  path: string;
  tabId: string;
};

function getTabId(): string {
  const existing = window.sessionStorage.getItem(TAB_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated =
    window.crypto?.randomUUID?.() ??
    `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(TAB_ID_KEY, generated);
  return generated;
}

function buildPresencePayload(
  pathname: string,
  params: Readonly<Record<string, string | undefined>>,
): PresencePayload {
  const tabId = getTabId();
  const pageId = params.pageSlug ? extractPageSlugId(params.pageSlug) : undefined;

  if (pageId) {
    return {
      type: "page",
      pageId,
      path: pathname,
      tabId,
    };
  }

  if (params.spaceSlug) {
    return {
      type: "space",
      spaceId: params.spaceSlug,
      path: pathname,
      tabId,
    };
  }

  return {
    type: "workspace",
    path: pathname,
    tabId,
  };
}

export function usePresenceReporter() {
  const [socket] = useAtom(socketAtom);
  const location = useLocation();
  const params = useParams();

  const payload = useMemo(
    () => buildPresencePayload(location.pathname, params),
    [location.pathname, params.pageSlug, params.spaceSlug],
  );

  useEffect(() => {
    if (!socket) {
      return;
    }

    const emitPresence = () => {
      socket.emit("presence:update", payload);
    };

    emitPresence();
    socket.on("connect", emitPresence);

    const intervalId = window.setInterval(emitPresence, HEARTBEAT_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        emitPresence();
      }
    };
    const handleBeforeUnload = () => {
      socket.emit("presence:clear");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      socket.off("connect", emitPresence);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [payload, socket]);
}
