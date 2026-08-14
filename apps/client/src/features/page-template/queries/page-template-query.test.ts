import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePageTemplateCapabilitiesQuery } from "./page-template-query";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("../services/page-template-api", () => ({
  getPageTemplateCapabilities: vi.fn(),
}));

describe("usePageTemplateCapabilitiesQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops stale capabilities after a failed refetch", () => {
    mocks.useQuery.mockReturnValue({
      data: {
        enabled: true,
        createTemplate: true,
        manageTemplate: true,
        useRegular: true,
        useSynced: true,
      },
      isError: true,
      isSuccess: false,
    });

    expect(usePageTemplateCapabilitiesQuery("space-1").data).toBeUndefined();
  });

  it("keeps capabilities after a successful request", () => {
    const capabilities = {
      enabled: true,
      createTemplate: false,
      manageTemplate: false,
      useRegular: true,
      useSynced: false,
    };
    mocks.useQuery.mockReturnValue({
      data: capabilities,
      isError: false,
      isSuccess: true,
    });

    expect(usePageTemplateCapabilitiesQuery("space-1").data).toBe(capabilities);
  });
});
