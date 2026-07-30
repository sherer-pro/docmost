import { describe, expect, it } from "vitest";
import {
  clearAiPageActivity,
  getVisibleAiActivities,
} from "./ai-activity.ts";
import type { AiActivityItem } from "@/features/ai/types/ai.types.ts";

function activity(
  overrides: Partial<AiActivityItem> = {},
): AiActivityItem {
  return {
    runId: "run",
    conversationId: "conversation",
    pageId: "page",
    pageTitle: "Page",
    status: "completed",
    unread: true,
    updatedAt: "2026-07-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("AI activity lifecycle", () => {
  it("shows active items before unread terminal items", () => {
    const visible = getVisibleAiActivities({
      completed: activity({ runId: "completed" }),
      running: activity({
        runId: "running",
        status: "running",
        unread: false,
      }),
      read: activity({ runId: "read", unread: false }),
    });

    expect(visible.map((item) => item.runId)).toEqual([
      "running",
      "completed",
    ]);
  });

  it("clears terminal page activity but keeps a running item", () => {
    const cleared = clearAiPageActivity(
      {
        completed: activity({ runId: "completed" }),
        running: activity({ runId: "running", status: "running" }),
      },
      "page",
    );

    expect(Object.keys(cleared)).toEqual(["running"]);
  });

  it("keeps an agent run visible while approval is pending", () => {
    const visible = getVisibleAiActivities({
      approval: activity({
        runId: "approval",
        status: "awaiting_approval",
        unread: false,
      }),
    });

    expect(visible.map((item) => item.runId)).toEqual(["approval"]);
  });
});
