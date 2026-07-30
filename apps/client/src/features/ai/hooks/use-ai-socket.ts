import { createElement, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { socketAtom } from "@/features/websocket/atoms/socket-atom.ts";
import {
  aiActivityAtom,
  aiDocumentContextAtom,
  aiStreamingRunsAtom,
  aiUnreadRunsAtom,
} from "@/features/ai/atoms/ai-atoms.ts";
import { AI_QUERY_KEYS } from "@/features/ai/queries/ai-query.ts";
import {
  AiRunDeltaEvent,
  AiRunStatusEvent,
  AiRunStepEvent,
  AiConversationUpdatedEvent,
  AiContentPolicyUpdatedEvent,
  AiActivityItem,
} from "@/features/ai/types/ai.types.ts";
import { AI_RECONNECT_QUERY_KEY } from "@/features/ai/utils/ai-policies.ts";
import { reduceAiRunState } from "@/features/ai/utils/ai-run-state.ts";
import { resolveAiErrorMessage } from "@/features/ai/utils/ai-policies.ts";
import { Button, Group, Text } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";

function unwrapAiEvent<T>(value: T | { data: T }): T {
  return value && typeof value === "object" && "data" in value
    ? (value as { data: T }).data
    : (value as T);
}

export function useAiSocket() {
  const socket = useAtomValue(socketAtom);
  const currentDocument = useAtomValue(aiDocumentContextAtom);
  const setRuns = useSetAtom(aiStreamingRunsAtom);
  const setActivity = useSetAtom(aiActivityAtom);
  const setUnread = useSetAtom(aiUnreadRunsAtom);
  const setAsideState = useSetAtom(asideStateAtom);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (!socket) {
      return;
    }

    let deltaFrame: number | undefined;
    let pendingDeltas: AiRunDeltaEvent[] = [];

    const flushPendingDeltas = () => {
      deltaFrame = undefined;
      const events = pendingDeltas;
      pendingDeltas = [];
      if (!events.length) {
        return;
      }

      const latestByRun = new Map<string, AiRunDeltaEvent>();
      for (const event of events) {
        latestByRun.set(event.runId, event);
      }
      setActivity((current) => {
        const next = { ...current };
        const updatedAt = new Date().toISOString();
        for (const event of latestByRun.values()) {
          const existing = current[event.runId];
          next[event.runId] = {
            runId: event.runId,
            conversationId: event.conversationId,
            pageId: event.pageId ?? existing?.pageId ?? "",
            pageTitle:
              existing?.pageTitle ||
              (event.pageId === currentDocument?.pageId
                ? currentDocument.title
                : t("ai.ux.document")),
            pageHref: existing?.pageHref,
            status: "running",
            unread: false,
            updatedAt,
          };
        }
        return next;
      });

      const recoveryConversationIds = new Set<string>();
      setRuns((current) => {
        let next = current;
        for (const event of events) {
          const transition = reduceAiRunState(next, {
            type: "delta",
            event,
          });
          next = transition.runs;
          if (transition.recoveryConversationId) {
            recoveryConversationIds.add(transition.recoveryConversationId);
          }
        }
        return next;
      });
      for (const conversationId of recoveryConversationIds) {
        void queryClient.invalidateQueries({
          queryKey: AI_QUERY_KEYS.messages(conversationId),
        });
      }
    };

    const handleDelta = (
      rawEvent: AiRunDeltaEvent | { data: AiRunDeltaEvent },
    ) => {
      const event = unwrapAiEvent(rawEvent);
      pendingDeltas.push(event);
      if (deltaFrame === undefined) {
        deltaFrame = window.requestAnimationFrame(flushPendingDeltas);
      }
    };

    const handleStatus = (
      rawEvent: AiRunStatusEvent | { data: AiRunStatusEvent },
    ) => {
      const event = unwrapAiEvent(rawEvent);
      if (deltaFrame !== undefined) {
        window.cancelAnimationFrame(deltaFrame);
        flushPendingDeltas();
      }

      let recoveryConversationId: string | undefined;
      let terminalConversationId: string | undefined;
      let activityItem: AiActivityItem | undefined;
      setActivity((current) => {
        const existing = current[event.runId];
        const pageId = event.pageId ?? existing?.pageId ?? "";
        activityItem = {
          runId: event.runId,
          conversationId: event.conversationId,
          pageId,
          pageTitle:
            existing?.pageTitle ||
            (pageId === currentDocument?.pageId
              ? currentDocument.title
              : t("ai.ux.document")),
          pageHref: existing?.pageHref,
          status: event.status,
          unread: Boolean(pageId && pageId !== currentDocument?.pageId),
          updatedAt: new Date().toISOString(),
        };
        return { ...current, [event.runId]: activityItem };
      });
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
          const statusMessage =
            event.status === "completed"
              ? t("ai.generationCompleted")
              : event.status === "failed"
                ? resolveAiErrorMessage(t, i18n, event.errorCode)
                : t("ai.generationStopped");
          notifications.show({
            message: createElement(
              Group,
              { justify: "space-between", gap: "xs", wrap: "nowrap" },
              createElement(Text, { size: "sm" }, statusMessage),
              activityItem?.pageHref
                ? createElement(
                    Button,
                    {
                      size: "compact-xs",
                      variant: "subtle",
                      onClick: () => {
                        navigate(activityItem!.pageHref!);
                        setAsideState({ tab: "ai", isAsideOpen: true });
                      },
                    },
                    t("ai.ux.open"),
                  )
                : null,
            ),
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

    const handleRunStep = (
      rawEvent: AiRunStepEvent | { data: AiRunStepEvent },
    ) => {
      const event = unwrapAiEvent(rawEvent);
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.run(event.runId),
      });
    };

    const handleReconnect = () => {
      setRuns(
        (current) => reduceAiRunState(current, { type: "reconnect" }).runs,
      );
      setActivity((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, item]) => item.unread),
        ),
      );
      void queryClient.invalidateQueries({ queryKey: AI_RECONNECT_QUERY_KEY });
    };

    const handleContentPolicyUpdated = (
      rawEvent:
        | AiContentPolicyUpdatedEvent
        | { data: AiContentPolicyUpdatedEvent },
    ) => {
      const event = unwrapAiEvent(rawEvent);
      void queryClient.invalidateQueries({
        queryKey: AI_QUERY_KEYS.contentPolicy(event.spaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["ai", "status", event.spaceId],
      });
      void queryClient.invalidateQueries({ queryKey: ["ai", "context"] });
      void queryClient.invalidateQueries({
        queryKey: ["ai", "context-sources"],
      });
    };

    socket.on("ai:run.delta", handleDelta);
    socket.on("ai:run.status", handleStatus);
    socket.on("ai:run.step", handleRunStep);
    socket.on("ai:conversation.updated", handleConversationUpdated);
    socket.on("ai:content-policy.updated", handleContentPolicyUpdated);
    socket.on("connect", handleReconnect);

    return () => {
      if (deltaFrame !== undefined) {
        window.cancelAnimationFrame(deltaFrame);
      }
      pendingDeltas = [];
      socket.off("ai:run.delta", handleDelta);
      socket.off("ai:run.status", handleStatus);
      socket.off("ai:run.step", handleRunStep);
      socket.off("ai:conversation.updated", handleConversationUpdated);
      socket.off("ai:content-policy.updated", handleContentPolicyUpdated);
      socket.off("connect", handleReconnect);
    };
  }, [
    currentDocument?.pageId,
    currentDocument?.title,
    i18n,
    navigate,
    queryClient,
    setActivity,
    setAsideState,
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
