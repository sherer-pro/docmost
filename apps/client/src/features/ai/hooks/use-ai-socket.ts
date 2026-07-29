import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { socketAtom } from "@/features/websocket/atoms/socket-atom.ts";
import {
  aiDocumentContextAtom,
  aiStreamingRunsAtom,
  aiUnreadRunsAtom,
} from "@/features/ai/atoms/ai-atoms.ts";
import { AI_QUERY_KEYS } from "@/features/ai/queries/ai-query.ts";
import {
  AiRunDeltaEvent,
  AiRunStatusEvent,
  AiConversationUpdatedEvent,
} from "@/features/ai/types/ai.types.ts";
import { AI_RECONNECT_QUERY_KEY } from "@/features/ai/utils/ai-policies.ts";
import { reduceAiRunState } from "@/features/ai/utils/ai-run-state.ts";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";

function unwrapAiEvent<T>(value: T | { data: T }): T {
  return value && typeof value === "object" && "data" in value
    ? (value as { data: T }).data
    : (value as T);
}

export function useAiSocket() {
  const socket = useAtomValue(socketAtom);
  const currentDocument = useAtomValue(aiDocumentContextAtom);
  const setRuns = useSetAtom(aiStreamingRunsAtom);
  const setUnread = useSetAtom(aiUnreadRunsAtom);
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleDelta = (
      rawEvent: AiRunDeltaEvent | { data: AiRunDeltaEvent },
    ) => {
      const event = unwrapAiEvent(rawEvent);

      let recoveryConversationId: string | undefined;
      setRuns((current) => {
        const transition = reduceAiRunState(current, {
          type: "delta",
          event,
        });
        recoveryConversationId = transition.recoveryConversationId;
        return transition.runs;
      });
      if (recoveryConversationId) {
        void queryClient.invalidateQueries({
          queryKey: AI_QUERY_KEYS.messages(recoveryConversationId),
        });
      }
    };

    const handleStatus = (
      rawEvent: AiRunStatusEvent | { data: AiRunStatusEvent },
    ) => {
      const event = unwrapAiEvent(rawEvent);

      let recoveryConversationId: string | undefined;
      let terminalConversationId: string | undefined;
      setRuns((current) => {
        const transition = reduceAiRunState(current, {
          type: "status",
          event,
        });
        recoveryConversationId = transition.recoveryConversationId;
        terminalConversationId = transition.terminalConversationId;
        return transition.runs;
      });

      if (recoveryConversationId) {
        void queryClient.invalidateQueries({
          queryKey: AI_QUERY_KEYS.messages(recoveryConversationId),
        });
      }
      if (terminalConversationId) {
        void queryClient
          .refetchQueries({
            queryKey: AI_QUERY_KEYS.messages(terminalConversationId),
          })
          .finally(() => {
            setRuns(
              (current) =>
                reduceAiRunState(current, {
                  type: "prune",
                  runId: event.runId,
                }).runs,
            );
          });

        if (event.pageId && event.pageId !== currentDocument?.pageId) {
          setUnread((current) => ({
            ...current,
            [event.pageId]: (current[event.pageId] ?? 0) + 1,
          }));
          notifications.show({
            message:
              event.status === "completed"
                ? t("ai.generationCompleted")
                : event.status === "failed"
                  ? resolveAiErrorMessage(t, i18n, event.errorCode)
                  : t("ai.generationStopped"),
          });
        }
      }
    };

    const handleConversationUpdated = (
      rawEvent:
        | AiConversationUpdatedEvent
        | { data: AiConversationUpdatedEvent },
    ) => {
      const { conversation } = unwrapAiEvent(rawEvent);
      queryClient.setQueryData(
        AI_QUERY_KEYS.conversations(conversation.pageId),
        (current: Array<typeof conversation> | undefined) =>
          (current ?? []).map((item) =>
            item.id === conversation.id ? conversation : item,
          ),
      );
    };

    const handleReconnect = () => {
      setRuns(
        (current) => reduceAiRunState(current, { type: "reconnect" }).runs,
      );
      void queryClient.invalidateQueries({ queryKey: AI_RECONNECT_QUERY_KEY });
    };

    socket.on("ai:run.delta", handleDelta);
    socket.on("ai:run.status", handleStatus);
    socket.on("ai:conversation.updated", handleConversationUpdated);
    socket.on("connect", handleReconnect);

    return () => {
      socket.off("ai:run.delta", handleDelta);
      socket.off("ai:run.status", handleStatus);
      socket.off("ai:conversation.updated", handleConversationUpdated);
      socket.off("connect", handleReconnect);
    };
  }, [
    currentDocument?.pageId,
    i18n,
    queryClient,
    setRuns,
    setUnread,
    socket,
    t,
  ]);
}

export function AiSocketBridge() {
  useAiSocket();
  return null;
}
