import { describe, expect, it } from "vitest";
import type { RagSyncSpaceConfig } from "@docmost/api-contract";
import { getRagSyncPollingInterval } from "./rag-sync-query.ts";

function config(state: RagSyncSpaceConfig["state"]): RagSyncSpaceConfig {
  return {
    deploymentEnabled: true,
    bindingId: "binding-id",
    state,
    configVersion: 1,
    target: {
      adapter: "open-webui-knowledge-v1",
      baseUrl: "https://open-webui.example.com",
      knowledgeId: "knowledge-id",
      writerApiKeyConfigured: true,
      lastTestedAt: "2026-08-11T12:00:00.000Z",
    },
    cleanupRequired: false,
    status: {
      health:
        state === "enabled"
          ? "healthy"
          : state === "draining"
            ? "syncing"
            : "disabled",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lagMs: null,
      errorCode: null,
    },
  };
}

describe("RAG Sync polling interval", () => {
  it.each(["enabled", "draining"] as const)(
    "polls an active %s binding every ten seconds",
    (state) => {
      expect(getRagSyncPollingInterval(config(state))).toBe(10_000);
    },
  );

  it.each(["disabled", undefined] as const)(
    "polls an inactive binding every minute",
    (state) => {
      expect(
        getRagSyncPollingInterval(
          state === undefined ? undefined : config(state),
        ),
      ).toBe(60_000);
    },
  );
});
