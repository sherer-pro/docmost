import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRagSyncSpaceConfig,
  runRagSyncAction,
  testRagSyncTarget,
  updateRagSyncSpaceConfig,
} from "./rag-sync-service.ts";

const { getMock, patchMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("@/lib/api-client.ts", () => ({
  default: {
    get: getMock,
    patch: patchMock,
    post: postMock,
  },
  unwrapApiResponse: (value: unknown) => value,
}));

describe("rag-sync service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the per-space configuration routes", async () => {
    const config = { bindingId: "binding-id" };
    getMock.mockResolvedValue(config);
    patchMock.mockResolvedValue(config);

    await expect(getRagSyncSpaceConfig("space-id")).resolves.toBe(config);
    await expect(
      updateRagSyncSpaceConfig("space-id", {
        expectedVersion: 4,
        target: { knowledgeId: "knowledge-id" },
      }),
    ).resolves.toBe(config);

    expect(getMock).toHaveBeenCalledWith("/spaces/space-id/ai/rag-sync");
    expect(patchMock).toHaveBeenCalledWith("/spaces/space-id/ai/rag-sync", {
      expectedVersion: 4,
      target: { knowledgeId: "knowledge-id" },
    });
  });

  it("tests the saved writer target without sending credentials", async () => {
    const result = { ok: true, latencyMs: 12 };
    postMock.mockResolvedValue(result);

    await expect(testRagSyncTarget("space-id")).resolves.toBe(result);
    expect(postMock).toHaveBeenCalledWith(
      "/spaces/space-id/ai/rag-sync/actions/test",
    );
  });

  it("sends the expected version to regular lifecycle actions", async () => {
    postMock.mockResolvedValue({ state: "enabled" });

    await runRagSyncAction("space-id", "enable", 7);

    expect(postMock).toHaveBeenCalledWith(
      "/spaces/space-id/ai/rag-sync/actions/enable",
      { expectedVersion: 7 },
    );
  });

  it.each(["force-disable", "abandon-cleanup"] as const)(
    "requires explicit confirmation for %s",
    async (action) => {
      postMock.mockResolvedValue({ state: "disabled" });

      await runRagSyncAction("space-id", action, 9);

      expect(postMock).toHaveBeenCalledWith(
        `/spaces/space-id/ai/rag-sync/actions/${action}`,
        { expectedVersion: 9, confirm: true },
      );
    },
  );
});
