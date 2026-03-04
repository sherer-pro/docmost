import { socketAtom } from "@/features/websocket/atoms/socket-atom.ts";
import { useAtom } from "jotai";
import { WebSocketEvent, WebSocketEventEnvelope } from "@/features/websocket/types";

type QueryEmitContext = {
  spaceId?: string;
  workspaceId?: string;
  targetRoom?: string;
};

const resolveTargetRoom = ({
  targetRoom,
  spaceId,
  workspaceId,
}: QueryEmitContext): string => {
  if (targetRoom) {
    return targetRoom;
  }

  if (spaceId) {
    return `space-${spaceId}`;
  }

  if (workspaceId) {
    return `workspace-${workspaceId}`;
  }

  return "global";
};

export const useQueryEmit = () => {
  const [socket] = useAtom(socketAtom);

  return (input: WebSocketEvent, context: QueryEmitContext = {}) => {
    const derivedSpaceId = "spaceId" in input ? input.spaceId : undefined;
    const envelope: WebSocketEventEnvelope = {
      operation: "broadcast",
      targetRoom: resolveTargetRoom({
        ...context,
        spaceId: context.spaceId ?? derivedSpaceId,
      }),
      data: input,
      ...(context.spaceId ?? derivedSpaceId
        ? { spaceId: context.spaceId ?? derivedSpaceId }
        : {}),
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    };

    socket?.emit("message", envelope);
  };
};
