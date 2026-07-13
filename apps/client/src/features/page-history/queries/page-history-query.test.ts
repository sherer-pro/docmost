import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  removeQueries: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/main", () => ({
  queryClient: mocks,
}));

import { invalidateDeletedPageHistory } from "./page-history-query";

describe("invalidateDeletedPageHistory", () => {
  beforeEach(() => {
    mocks.removeQueries.mockClear();
    mocks.invalidateQueries.mockClear();
  });

  it("removes the deleted version and refreshes its history list", async () => {
    await invalidateDeletedPageHistory("page-1", "history-1");

    expect(mocks.removeQueries).toHaveBeenCalledWith({
      queryKey: ["page-history", "history-1"],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["page-history-list", "page-1"],
    });
  });
});
