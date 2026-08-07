// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api-client";
import {
  discoverPageTemplates,
  getPageTemplateDestinations,
  createPageFromTemplate,
  hashProseMirrorJson,
  preflightPageTemplatePublish,
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
      .mockResolvedValueOnce({ data: { page: { id: "page" } } } as any)
      .mockResolvedValueOnce({ data: { page: { id: "page-2" } } } as any);
    const request = {
      templatePageId: "source",
      spaceId: "space",
      parentPageId: "parent",
    };

    await expect(createPageFromTemplate(request)).rejects.toThrow("network");
    await expect(createPageFromTemplate(request)).resolves.toEqual({
      page: { id: "page" },
    });

    const firstKey = post.mock.calls[0][2]?.headers?.["Idempotency-Key"];
    const retryKey = post.mock.calls[1][2]?.headers?.["Idempotency-Key"];
    expect(retryKey).toBe(firstKey);

    await createPageFromTemplate(request);
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

  it("requests a publication preflight from the live collaboration draft", async () => {
    post.mockResolvedValue({ data: { draftHash: "hash" } } as any);

    await preflightPageTemplatePublish("page-1");

    expect(post).toHaveBeenCalledWith(
      "/pages/templates/page-1/actions/preflight-publish",
    );
  });

  it("uses the same binary key order as the server content hash", async () => {
    await expect(
      hashProseMirrorJson({ type: "doc", a: 3, _meta: 2, A: 1 }),
    ).resolves.toBe(
      "6c58be2700954cd9d08e3601c25b522fede504bfb50a88dbed6d76024bf18a29",
    );
  });
});
