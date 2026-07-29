import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AiRun } from "@/features/ai/types/ai.types.ts";
import { reduceAiRunState } from "./ai-run-state.ts";

describe("AI run state reducer", () => {
  it("applies REST, contiguous deltas, and terminal status", () => {
    const run = {
      id: "run",
      conversationId: "conversation",
      assistantMessageId: "message",
      sequence: 0,
      status: "queued",
    } as AiRun;
    const queued = reduceAiRunState({}, { type: "rest", run });
    const streaming = reduceAiRunState(queued.runs, {
      type: "delta",
      event: {
        runId: "run",
        conversationId: "conversation",
        messageId: "message",
        pageId: "page",
        sequence: 1,
        delta: "hello",
      },
    });
    const completed = reduceAiRunState(streaming.runs, {
      type: "status",
      event: {
        runId: "run",
        conversationId: "conversation",
        messageId: "message",
        pageId: "page",
        sequence: 2,
        status: "completed",
      },
    });

    assert.equal(completed.runs.run.content, "hello");
    assert.equal(completed.runs.run.status, "completed");
    assert.equal(completed.terminalConversationId, "conversation");
  });

  it("ignores duplicates and requests recovery for gaps", () => {
    const current = {
      run: {
        runId: "run",
        conversationId: "conversation",
        content: "a",
        sequence: 3,
        status: "running" as const,
      },
    };
    const duplicate = reduceAiRunState(current, {
      type: "delta",
      event: {
        runId: "run",
        conversationId: "conversation",
        messageId: "message",
        pageId: "page",
        sequence: 3,
        delta: "duplicate",
      },
    });
    const gap = reduceAiRunState(current, {
      type: "status",
      event: {
        runId: "run",
        conversationId: "conversation",
        messageId: "message",
        pageId: "page",
        sequence: 5,
        status: "completed",
      },
    });

    assert.equal(duplicate.runs, current);
    assert.equal(gap.runs.run, undefined);
    assert.equal(gap.recoveryConversationId, "conversation");
  });

  it("prunes terminal state and clears ephemeral state on reconnect", () => {
    const current = {
      run: {
        runId: "run",
        conversationId: "conversation",
        content: "",
        sequence: 2,
        status: "failed" as const,
      },
    };
    assert.deepEqual(
      reduceAiRunState(current, { type: "prune", runId: "run" }).runs,
      {},
    );
    assert.deepEqual(reduceAiRunState(current, { type: "reconnect" }).runs, {});
  });

  it("preserves a cancellation request through streaming events", () => {
    const cancelRequestedAt = "2026-07-29T20:00:00.000Z";
    const running = reduceAiRunState(
      {},
      {
        type: "rest",
        run: {
          id: "run",
          conversationId: "conversation",
          assistantMessageId: "message",
          sequence: 1,
          status: "running",
          cancelRequestedAt,
        } as AiRun,
      },
    );
    const streaming = reduceAiRunState(running.runs, {
      type: "delta",
      event: {
        runId: "run",
        conversationId: "conversation",
        messageId: "message",
        pageId: "page",
        sequence: 2,
        delta: "partial",
      },
    });
    const cancelled = reduceAiRunState(streaming.runs, {
      type: "status",
      event: {
        runId: "run",
        conversationId: "conversation",
        messageId: "message",
        pageId: "page",
        sequence: 3,
        status: "cancelled",
      },
    });

    assert.equal(streaming.runs.run.cancelRequestedAt, cancelRequestedAt);
    assert.equal(cancelled.runs.run.cancelRequestedAt, cancelRequestedAt);
    assert.equal(cancelled.runs.run.status, "cancelled");
  });
});
