import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api-client";
import { getPageReferences } from "./page-service";

vi.mock("@/lib/api-client", () => ({
  default: {
    get: vi.fn(),
  },
  unwrapApiResponse: vi.fn(),
}));

const get = vi.mocked(api.get);

describe("getPageReferences", () => {
  beforeEach(() => get.mockReset());

  it("deduplicates ten mentions into one batch request", async () => {
    get.mockResolvedValue({ data: [] } as any);
    const ids = Array.from({ length: 10 }, (_, index) => `page-${index % 5}`);

    await getPageReferences(ids);

    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("/pages/references", {
      params: { ids: "page-0,page-1,page-2,page-3,page-4" },
    });
  });

  it("splits requests at the server limit of 50 IDs", async () => {
    get.mockResolvedValue({ data: [] } as any);

    await getPageReferences(
      Array.from({ length: 51 }, (_, index) => `page-${index}`),
    );

    expect(get).toHaveBeenCalledTimes(2);
  });
});
