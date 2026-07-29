import type {
  AiRun,
  AiRunDeltaEvent,
  AiRunStatusEvent,
  AiStreamingRun,
} from "@/features/ai/types/ai.types.ts";
import { getAiDeltaSequenceDecision } from "./ai-policies.ts";

export type AiRunStateAction =
  | {
      type: "rest";
      run: AiRun;
      content?: string;
    }
  | {
      type: "delta";
      event: AiRunDeltaEvent;
    }
  | {
      type: "status";
      event: AiRunStatusEvent;
    }
  | {
      type: "prune";
      runId: string;
    }
  | {
      type: "reconnect";
    };

export interface AiRunStateTransition {
  runs: Record<string, AiStreamingRun>;
  recoveryConversationId?: string;
  terminalConversationId?: string;
}

export function reduceAiRunState(
  current: Record<string, AiStreamingRun>,
  action: AiRunStateAction,
): AiRunStateTransition {
  if (action.type === "reconnect") {
    return { runs: {} };
  }
  if (action.type === "prune") {
    const runs = { ...current };
    delete runs[action.runId];
    return { runs };
  }
  if (action.type === "rest") {
    const run = action.run;
    return {
      runs: {
        ...current,
        [run.id]: {
          runId: run.id,
          conversationId: run.conversationId,
          messageId: run.assistantMessageId,
          content: action.content ?? current[run.id]?.content ?? "",
          sequence: run.sequence,
          status: run.status,
          cancelRequestedAt: run.cancelRequestedAt,
          error: run.errorMessage ?? undefined,
        },
      },
      terminalConversationId: isTerminal(run.status)
        ? run.conversationId
        : undefined,
    };
  }

  const event = action.event;
  const previous = current[event.runId];
  const decision = getAiDeltaSequenceDecision(
    previous?.sequence,
    event.sequence,
  );
  if (decision === "ignore") {
    return { runs: current };
  }
  if (decision === "recover") {
    const runs = { ...current };
    delete runs[event.runId];
    return {
      runs,
      recoveryConversationId: event.conversationId,
    };
  }

  if (action.type === "delta") {
    const deltaEvent = action.event;
    return {
      runs: {
        ...current,
        [deltaEvent.runId]: {
          runId: deltaEvent.runId,
          conversationId: deltaEvent.conversationId,
          messageId: deltaEvent.messageId ?? previous?.messageId,
          content: `${previous?.content ?? ""}${deltaEvent.delta}`,
          sequence: deltaEvent.sequence,
          status: "running",
          cancelRequestedAt: previous?.cancelRequestedAt,
        },
      },
    };
  }

  const statusEvent = action.event;
  return {
    runs: {
      ...current,
      [statusEvent.runId]: {
        runId: statusEvent.runId,
        conversationId: statusEvent.conversationId,
        messageId: statusEvent.messageId ?? previous?.messageId,
        content: previous?.content ?? "",
        sequence: statusEvent.sequence,
        status: statusEvent.status,
        cancelRequestedAt: previous?.cancelRequestedAt,
        error: statusEvent.errorMessage,
      },
    },
    terminalConversationId: isTerminal(statusEvent.status)
      ? statusEvent.conversationId
      : undefined,
  };
}

function isTerminal(status: AiRun["status"]): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}
