import { describe, expect, it } from "vitest";
import {
  AI_LEGACY_SPACE_PROFILE_VALUE,
  resolveActiveAiComposerProfileOptionLabel,
  resolveAiComposerProfileLabel,
  shouldShowHiddenActiveAiComposerProfileOption,
  shouldShowUnavailableAiComposerProfileOption,
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

describe("resolveActiveAiComposerProfileOptionLabel", () => {
  it("uses the frozen conversation identity instead of the newer live version", () => {
    expect(
      resolveActiveAiComposerProfileOptionLabel(
        { name: "Reviewer", version: 9 },
        { name: "Reviewer renamed", version: 11 },
      ),
    ).toBe("Reviewer · v9");
  });
});

describe("shouldShowUnavailableAiComposerProfileOption", () => {
  it("does not call a live profile unavailable only because the user hid it", () => {
    expect(
      shouldShowUnavailableAiComposerProfileOption("profile-1", ["profile-1"]),
    ).toBe(false);
  });

  it("keeps a frozen identity visible when its live profile is unavailable", () => {
    expect(shouldShowUnavailableAiComposerProfileOption("profile-1", [])).toBe(
      true,
    );
  });
});

describe("shouldShowHiddenActiveAiComposerProfileOption", () => {
  it("keeps a hidden live profile visible for its active conversation", () => {
    expect(
      shouldShowHiddenActiveAiComposerProfileOption(
        "profile-1",
        ["profile-1"],
        [],
      ),
    ).toBe(true);
  });

  it("does not duplicate a normally visible profile", () => {
    expect(
      shouldShowHiddenActiveAiComposerProfileOption(
        "profile-1",
        ["profile-1"],
        ["profile-1"],
      ),
    ).toBe(false);
  });
});
