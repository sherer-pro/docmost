import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AI_ERROR_CODES } from "@docmost/api-contract";
import type {
  AiConversation,
  AiMessage,
} from "@/features/ai/types/ai.types.ts";
import {
  AI_RECONNECT_QUERY_KEY,
  clampAiPanelWidth,
  getAiApplyPolicy,
  getAiDeltaSequenceDecision,
  getAiErrorTranslationKey,
  getAiPanelPreferencePayload,
  getPersistedActiveRun,
  getLatestAiConversation,
  shouldShowAiRetrievalUi,
  isAiMessageRetryable,
  mergeAiQuickCommands,
  shouldShowAiPanelLoadFailure,
  sortAiMessagesChronologically,
} from "./ai-policies.ts";

describe("AI error presentation", () => {
  it("maps stable backend codes to user-facing translation keys", () => {
    assert.equal(
      getAiErrorTranslationKey("provider_timeout"),
      "ai.errorReason.providerTimeout",
    );
    assert.equal(
      getAiErrorTranslationKey("provider_unavailable"),
      "ai.errorReason.providerUnavailable",
    );
    assert.equal(
      getAiErrorTranslationKey("provider_invalid_response"),
      "ai.errorReason.providerInvalidResponse",
    );
    assert.equal(
      getAiErrorTranslationKey("unexpected_code"),
      "ai.errorReason.unknown",
    );
    for (const code of AI_ERROR_CODES) {
      assert.notEqual(
        getAiErrorTranslationKey(code),
        "ai.errorReason.unknown",
        `missing translation mapping for ${code}`,
      );
    }
  });

  it("prioritizes a specific unavailable status over conversation load errors", () => {
    assert.equal(shouldShowAiPanelLoadFailure(false, true, false), false);
    assert.equal(shouldShowAiPanelLoadFailure(false, true, true), true);
    assert.equal(shouldShowAiPanelLoadFailure(true, false, undefined), true);
  });

  it("hides every retrieval reminder when space search is unavailable", () => {
    assert.equal(shouldShowAiRetrievalUi(undefined), false);
    assert.equal(shouldShowAiRetrievalUi(false), false);
    assert.equal(shouldShowAiRetrievalUi(true), true);
  });

  it("offers retry for failed and explicitly cancelled responses", () => {
    assert.equal(isAiMessageRetryable("failed"), true);
    assert.equal(isAiMessageRetryable("cancelled"), true);
    assert.equal(isAiMessageRetryable("completed"), false);
    assert.equal(isAiMessageRetryable("streaming"), false);
  });
});

describe("AI socket recovery policy", () => {
  it("ignores duplicates, applies contiguous deltas, and recovers gaps", () => {
    assert.equal(getAiDeltaSequenceDecision(4, 4), "ignore");
    assert.equal(getAiDeltaSequenceDecision(4, 5), "apply");
    assert.equal(getAiDeltaSequenceDecision(4, 6), "recover");
    assert.equal(getAiDeltaSequenceDecision(undefined, 2), "recover");
    assert.deepEqual(AI_RECONNECT_QUERY_KEY, ["ai"]);
  });

  it("rehydrates an active run from the REST message snapshot", () => {
    const message = {
      id: "message",
      conversationId: "conversation",
      content: "partial",
      reasoning: "partial reasoning",
      runId: "run",
      runStatus: "running",
      runSequence: 7,
    } as AiMessage;

    assert.deepEqual(getPersistedActiveRun([message]), {
      runId: "run",
      conversationId: "conversation",
      messageId: "message",
      content: "partial",
      reasoning: "partial reasoning",
      sequence: 7,
      status: "running",
    });
  });
});

describe("AI message ordering", () => {
  it("uses the UUIDv7 sequence when a user/assistant pair has the same timestamp", () => {
    const createdAt = "2026-07-29T12:00:00.000Z";
    const userMessage = {
      id: "019b0000-0000-7000-8000-000000000001",
      role: "user",
      createdAt,
    } as AiMessage;
    const assistantMessage = {
      id: "019b0000-0000-7000-8000-000000000002",
      role: "assistant",
      createdAt,
    } as AiMessage;

    assert.deepEqual(
      sortAiMessagesChronologically([assistantMessage, userMessage]).map(
        (message) => message.role,
      ),
      ["user", "assistant"],
    );
  });
});

describe("AI apply policy", () => {
  it("allows replacement only for a current real selection", () => {
    assert.deepEqual(getAiApplyPolicy(true, { from: 3, to: 8 }), {
      hasRealSelection: true,
      canReplace: true,
      insertTarget: "selection-end",
    });
    assert.deepEqual(getAiApplyPolicy(true, { from: 3, to: 3 }), {
      hasRealSelection: false,
      canReplace: false,
      insertTarget: "selection-end",
    });
    assert.deepEqual(getAiApplyPolicy(false, { from: 3, to: 8 }), {
      hasRealSelection: true,
      canReplace: false,
      insertTarget: "cursor",
    });
  });
});

describe("AI panel preferences", () => {
  it("clamps width and builds a stable profile payload", () => {
    assert.equal(clampAiPanelWidth(250), 360);
    assert.equal(clampAiPanelWidth(700), 520);
    assert.equal(clampAiPanelWidth(Number.NaN), 400);
    assert.deepEqual(
      getAiPanelPreferencePayload({
        aiPanelOpen: true,
        aiPanelTab: "ai",
        aiPanelWidth: 640,
      }),
      {
        aiPanelOpen: true,
        aiPanelTab: "ai",
        aiPanelWidth: 520,
      },
    );
  });
});

describe("AI conversation selection", () => {
  it("selects the most recently opened conversation", () => {
    const base = {
      pageId: "page",
      clientRequestId: null,
      userId: "user",
      workspaceId: "workspace",
      spaceId: "space",
      title: null,
      titleSource: null,
      draft: "",
      useSpaceSearch: false,
      includeCurrentDocument: true,
      contextRevision: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    };
    const conversations = [
      {
        ...base,
        id: "older",
        updatedAt: "2026-01-03T00:00:00.000Z",
        lastOpenedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        ...base,
        id: "latest",
        updatedAt: "2026-01-02T00:00:00.000Z",
        lastOpenedAt: "2026-01-04T00:00:00.000Z",
      },
    ] as AiConversation[];

    assert.equal(getLatestAiConversation(conversations)?.id, "latest");
  });
});

describe("AI quick commands", () => {
  it("keeps standard commands, appends custom commands, and deduplicates ids", () => {
    const standard = [
      {
        id: "summarize",
        label: "Summarize",
        prompt: "Summarize.",
        enabled: true,
        position: 0,
      },
    ];
    const custom = [
      {
        id: "legal",
        label: "Legal review",
        prompt: "Review legal risks.",
        enabled: true,
        position: 1,
      },
      {
        id: "summarize",
        label: "Executive summary",
        prompt: "Summarize for executives.",
        enabled: true,
        position: 0,
      },
    ];

    assert.deepEqual(mergeAiQuickCommands(standard, custom), [
      custom[1],
      custom[0],
    ]);
  });
});
