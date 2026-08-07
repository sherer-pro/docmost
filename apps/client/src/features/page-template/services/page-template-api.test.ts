// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api-client";
import {
  discoverPageTemplates,
  getPageTemplateDestinations,
  insertPageEmbed,
} from "./page-template-api";

vi.mock("@/lib/api-client", () => ({
  default: { post: vi.fn(), get: vi.fn(), put: vi.fn(), patch: vi.fn() },
}));

const post = vi.mocked(api.post);
const get = vi.mocked(api.get);

describe("page template idempotency", () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    sessionStorage.clear();
  });

  it("reuses the same key after a lost response and clears it after success", async () => {
    post
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ data: { referenceNodeId: "node" } } as any)
      .mockResolvedValueOnce({ data: { referenceNodeId: "node-2" } } as any);
    const request = {
      consumerPageId: "consumer",
      sourcePageId: "source",
      from: 1,
      to: 1,
      baseContentHash: "a".repeat(64),
    };

    await expect(insertPageEmbed(request)).rejects.toThrow("network");
    await expect(insertPageEmbed(request)).resolves.toEqual({
      referenceNodeId: "node",
    });

    const firstKey = post.mock.calls[0][2]?.headers?.["Idempotency-Key"];
    const retryKey = post.mock.calls[1][2]?.headers?.["Idempotency-Key"];
    expect(retryKey).toBe(firstKey);

    await insertPageEmbed(request);
    const nextOperationKey =
      post.mock.calls[2][2]?.headers?.["Idempotency-Key"];
    expect(nextOperationKey).not.toBe(firstKey);
  });

  it("passes the required spaceId to discovery and destinations", async () => {
    get.mockResolvedValue({ data: { items: [], nextCursor: null } } as any);

    await discoverPageTemplates({
      spaceId: "space-1",
      query: "plan",
      cursor: "next",
      limit: 20,
    });
    await getPageTemplateDestinations({
      spaceId: "space-1",
      query: "parent",
      limit: 50,
    });

    expect(get).toHaveBeenNthCalledWith(1, "/pages/templates", {
      params: {
        spaceId: "space-1",
        query: "plan",
        cursor: "next",
        limit: 20,
      },
    });
    expect(get).toHaveBeenNthCalledWith(2, "/pages/templates/destinations", {
      params: { spaceId: "space-1", query: "parent", limit: 50 },
    });
  });
});
