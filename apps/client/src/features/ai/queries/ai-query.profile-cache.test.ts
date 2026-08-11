import { beforeEach, describe, expect, it, vi } from "vitest";

const queryClient = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
  removeQueries: vi.fn(),
  setQueryData: vi.fn(),
}));
const emit = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useMutation: vi.fn((options) => options),
    useQueryClient: vi.fn(() => queryClient),
  };
});

vi.mock("@/features/websocket/use-query-emit.ts", () => ({
  useQueryEmit: () => emit,
}));

import {
  AI_QUERY_KEYS,
  useCreateAiAssistantProfileMutation,
  useDeleteAiAssistantProfileMutation,
  useUpdateAiAssistantProfileMutation,
  useUpdateAiAssistantProfilePreferencesMutation,
} from "./ai-query.ts";

describe("assistant profile query cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores a created profile in the detail cache without corrupting preferences", async () => {
    const mutation = useCreateAiAssistantProfileMutation("space") as any;
    const profile = { id: "profile", spaceId: "space", name: "Reviewer" };

    await mutation.onSuccess(profile);

    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      AI_QUERY_KEYS.profile("space", "profile"),
      profile,
    );
    expect(queryClient.setQueryData).not.toHaveBeenCalledWith(
      AI_QUERY_KEYS.profilePreferences("space"),
      expect.anything(),
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: AI_QUERY_KEYS.profiles("space"),
    });
    expect(emit).toHaveBeenCalledWith({
      operation: "invalidate",
      spaceId: "space",
      entity: [...AI_QUERY_KEYS.profiles("space")],
    });
  });

  it("evicts deleted profile details and refreshes assignments", async () => {
    const mutation = useDeleteAiAssistantProfileMutation("space") as any;

    await mutation.onSuccess(undefined, "profile");

    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: AI_QUERY_KEYS.profile("space", "profile"),
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: AI_QUERY_KEYS.profiles("space"),
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: AI_QUERY_KEYS.profilePreferences("space"),
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: AI_QUERY_KEYS.config("space"),
    });
    expect(emit).toHaveBeenCalledWith({
      operation: "invalidate",
      spaceId: "space",
      entity: [...AI_QUERY_KEYS.profile("space", "profile")],
    });
    expect(emit).toHaveBeenCalledWith({
      operation: "invalidate",
      spaceId: "space",
      entity: [...AI_QUERY_KEYS.profilePreferences("space")],
    });
  });

  it("broadcasts updated profile list and detail invalidations", async () => {
    const mutation = useUpdateAiAssistantProfileMutation("space") as any;
    const profile = { id: "profile", spaceId: "space", name: "Updated" };

    await mutation.onSuccess(profile);

    expect(emit).toHaveBeenCalledWith({
      operation: "invalidate",
      spaceId: "space",
      entity: [...AI_QUERY_KEYS.profile("space", "profile")],
    });
    expect(emit).toHaveBeenCalledWith({
      operation: "invalidate",
      spaceId: "space",
      entity: [...AI_QUERY_KEYS.profiles("space")],
    });
  });

  it("stores updated preferences and refreshes profile selection", async () => {
    const mutation = useUpdateAiAssistantProfilePreferencesMutation(
      "space",
    ) as any;
    const preferences = {
      spaceId: "space",
      preferredProfileId: "profile",
      hiddenProfileIds: [],
    };

    await mutation.onSuccess(preferences);

    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      AI_QUERY_KEYS.profilePreferences("space"),
      preferences,
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: AI_QUERY_KEYS.profiles("space"),
    });
    expect(emit).toHaveBeenCalledWith({
      operation: "invalidate",
      spaceId: "space",
      entity: [...AI_QUERY_KEYS.profilePreferences("space")],
    });
  });
});
