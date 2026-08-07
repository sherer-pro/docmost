import { describe, expect, it } from "vitest";
import {
  AI_LEGACY_SPACE_PROFILE_VALUE,
  resolveAiComposerProfileLabel,
} from "./ai-profile-display";

const options = [
  { value: AI_LEGACY_SPACE_PROFILE_VALUE, label: "Space assistant" },
  { value: "profile-1", label: "Current profile · v4" },
];

describe("resolveAiComposerProfileLabel", () => {
  it("shows the frozen conversation version instead of the live profile version", () => {
    expect(
      resolveAiComposerProfileLabel({
        activeProfile: {
          id: "profile-1",
          name: "Snapshot profile",
          version: 3,
          availability: "available",
        },
        assistantProfileId: "profile-1",
        options,
        spaceAssistantLabel: "Space assistant",
        unavailableLabel: "Unavailable",
      }),
    ).toBe("Snapshot profile · v3");
  });

  it("keeps the frozen version visible when the live profile is unavailable", () => {
    expect(
      resolveAiComposerProfileLabel({
        activeProfile: {
          id: "profile-1",
          name: "Snapshot profile",
          version: 3,
          availability: "unavailable",
        },
        assistantProfileId: "profile-1",
        options,
        spaceAssistantLabel: "Space assistant",
        unavailableLabel: "Unavailable",
      }),
    ).toBe("Snapshot profile · v3 · Unavailable");
  });

  it("uses the live option for a local draft without a conversation snapshot", () => {
    expect(
      resolveAiComposerProfileLabel({
        assistantProfileId: "profile-1",
        options,
        spaceAssistantLabel: "Space assistant",
        unavailableLabel: "Unavailable",
      }),
    ).toBe("Current profile · v4");
  });

  it("uses the space assistant label for a legacy conversation snapshot", () => {
    expect(
      resolveAiComposerProfileLabel({
        activeProfile: {
          id: null,
          name: null,
          version: null,
          availability: "available",
        },
        assistantProfileId: null,
        options,
        spaceAssistantLabel: "Space assistant",
        unavailableLabel: "Unavailable",
      }),
    ).toBe("Space assistant");
  });
});
