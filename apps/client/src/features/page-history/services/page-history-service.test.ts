import { describe, expect, it, vi } from "vitest";

const apiDelete = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  default: { delete: apiDelete },
}));

import { deletePageHistory } from "./page-history-service";

describe("deletePageHistory", () => {
  it("calls the history deletion endpoint", async () => {
    apiDelete.mockResolvedValue(undefined);

    await expect(deletePageHistory("history-1")).resolves.toBeUndefined();

    expect(apiDelete).toHaveBeenCalledWith("/pages/history/history-1");
  });
});
