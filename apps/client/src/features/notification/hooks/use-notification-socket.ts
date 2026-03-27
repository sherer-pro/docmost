import { useEffect } from "react";
import { useAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { socketAtom } from "@/features/websocket/atoms/socket-atom";
import { invalidateNotificationQueries } from "../queries/notification-query-keys";

export function useNotificationSocket() {
  const queryClient = useQueryClient();
  const [socket] = useAtom(socketAtom);

  useEffect(() => {
    if (!socket) return;

    const handler = () => {
      void invalidateNotificationQueries(queryClient);
    };

    socket.on("notification", handler);
    return () => {
      socket.off("notification", handler);
    };
  }, [socket, queryClient]);
}
