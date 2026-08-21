import { describe, expect, it } from "vitest";
import type { RagSyncSpaceConfig } from "@docmost/api-contract";
import {
  canEnableRagSync,
  getRagSyncWorkflowStep,
} from "./rag-sync-settings.utils.ts";

const config: RagSyncSpaceConfig = {
  deploymentEnabled: true,
  bindingId: "binding-id",
  state: "disabled",
  configVersion: 3,
  target: {
    adapter: "open-webui-knowledge-v1",
    baseUrl: "https://open-webui.example.com",
    knowledgeId: "knowledge-id",
    writerApiKeyConfigured: true,
    lastTestedAt: "2026-08-11T12:00:00.000Z",
  },
  cleanupRequired: false,
  status: {
    health: "disabled",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lagMs: null,
    errorCode: null,
  },
};

const ready = {
  isBusy: false,
  hasSavedTarget: true,
  hasUnsavedChanges: false,
};

describe("RAG Sync enablement", () => {
  it("requires a successful target test", () => {
    expect(
      canEnableRagSync(
        {
          ...config,
          target: { ...config.target, lastTestedAt: null },
        },
        ready,
      ),
    ).toBe(false);
    expect(canEnableRagSync(config, ready)).toBe(true);
  });

  it("also keeps the existing deployment, lifecycle and dirty-form gates", () => {
    expect(
      canEnableRagSync({ ...config, deploymentEnabled: false }, ready),
    ).toBe(false);
    expect(
      canEnableRagSync(config, { ...ready, hasUnsavedChanges: true }),
    ).toBe(false);
    expect(canEnableRagSync({ ...config, cleanupRequired: true }, ready)).toBe(
      false,
    );
  });
});

describe("RAG Sync workflow", () => {
  it("advances from target setup through verification and enablement", () => {
    expect(
      getRagSyncWorkflowStep(
        {
          ...config,
          target: {
            ...config.target,
            baseUrl: null,
            knowledgeId: null,
            writerApiKeyConfigured: false,
            lastTestedAt: null,
          },
        },
        false,
      ),
    ).toBe(0);
    expect(
      getRagSyncWorkflowStep(
        {
          ...config,
          target: { ...config.target, lastTestedAt: null },
        },
        true,
      ),
    ).toBe(1);
    expect(getRagSyncWorkflowStep(config, true)).toBe(2);
    expect(getRagSyncWorkflowStep({ ...config, state: "enabled" }, true)).toBe(
      3,
    );
  });
});
